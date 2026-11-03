import type { CancelSignal } from '../cancel';
import { SummaryError } from './cli-failure-messages';
import { throwIfCancelled } from './provider';
import type { SummarizeRequest } from './provider';
import {
  buildMergePrompt,
  buildPartPrompt,
  buildSummaryPrompt,
  toEnglishLanguageName,
} from './prompt-builders';

/** Spec 3.5 constants. */
export const CONTEXT_TOKENS = 4096;
export const FINAL_MAX_OUTPUT = 1024;
export const NOTES_MAX_OUTPUT = 640;
export const SAFETY_MARGIN = 128;
export const MAX_PARTS = 64;
export const MAX_MERGE_PASSES = 8;
export const SUMMARY_TEMPERATURE = 0.3;

/** Counts the tokens of a string the way the model would (BOS added). S11 supplies the sidecar. */
export interface TokenCounter {
  count(text: string): Promise<number>;
}

/** One chat completion. S11 supplies the sidecar; tests supply a fake. */
export type InferFunction = (
  prompt: string,
  maxTokens: number,
  temperature: number,
  cancel: CancelSignal,
) => Promise<string>;

const isWhitespace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char);
const isLowSurrogate = (char: string | undefined): boolean => {
  if (char === undefined) return false;
  const code = char.charCodeAt(0);
  return code >= 0xdc00 && code <= 0xdfff;
};

/** Tokens left in the context after the prompt, the reply cap and the safety margin. */
async function roomFor(counter: TokenCounter, prompt: string, maxOut: number): Promise<number> {
  return CONTEXT_TOKENS - SAFETY_MARGIN - maxOut - (await counter.count(prompt));
}

/** Largest prefix length from `start` whose token count fits, at least 1. Binary search. */
async function longestPrefixWithin(
  counter: TokenCounter,
  line: string,
  start: number,
  maxTokens: number,
): Promise<number> {
  let low = 1;
  let high = line.length - start;
  let best = 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((await counter.count(line.slice(start, start + mid))) <= maxTokens) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

/** Prefers a whitespace cut in the second half of the piece; never splits a surrogate pair. */
function backOffToBoundary(line: string, start: number, end: number): number {
  const floor = start + Math.floor((end - start) / 2);
  for (let i = end - 1; i > floor; i--) {
    if (isWhitespace(line[i])) return i + 1;
  }
  if (isLowSurrogate(line[end]) && end - 1 > start) return end - 1;
  return end;
}

/** Cuts one over-long line into pieces that each fit `maxTokens`. Always makes progress. */
export async function splitLongLine(
  counter: TokenCounter,
  line: string,
  maxTokens: number,
): Promise<string[]> {
  const pieces: string[] = [];
  let start = 0;
  while (start < line.length) {
    let end = start + (await longestPrefixWithin(counter, line, start, maxTokens));
    if (end < line.length) end = backOffToBoundary(line, start, end);
    pieces.push(line.slice(start, end));
    start = end;
  }
  return pieces;
}

/** Greedy line packing. Each line costs its tokens plus one for the line break put back. */
export async function splitToBudget(
  counter: TokenCounter,
  text: string,
  maxTokens: number,
): Promise<string[]> {
  const chunks: string[] = [];
  let buffer = '';
  let used = 0;
  const flush = (): void => {
    if (buffer.trim() !== '') chunks.push(buffer);
    buffer = '';
    used = 0;
  };
  for (const line of text.split(/\r?\n/)) {
    const cost = (await counter.count(line)) + 1;
    if (cost > maxTokens) {
      flush();
      for (const piece of await splitLongLine(counter, line, maxTokens - 1)) {
        if (piece.trim() !== '') chunks.push(piece);
      }
      continue;
    }
    if (used + cost > maxTokens) flush();
    if (buffer !== '') buffer += '\n';
    buffer += line;
    used += cost;
  }
  flush();
  return chunks;
}

/** Groups consecutive notes under a budget; each note costs its tokens plus 2 for the blank line. */
export async function groupToBudget(
  counter: TokenCounter,
  notes: readonly string[],
  maxTokens: number,
): Promise<string[][]> {
  const groups: string[][] = [];
  let used = 0;
  for (const note of notes) {
    const cost = (await counter.count(note)) + 2;
    const last = groups[groups.length - 1];
    if (last === undefined || used + cost > maxTokens) {
      groups.push([note]);
      used = cost;
    } else {
      last.push(note);
      used += cost;
    }
  }
  return groups;
}

/**
 * Spec 3.5 map-reduce. Returns the raw model text; the caller runs the response splitter.
 * Throws `SummaryError` (`NotesTooLong`, `TranscriptTooLong`, `CannotCondense`) before or between
 * inferences, and `CancelledError` when the signal fires.
 */
export async function summarizeMapReduce(
  request: SummarizeRequest,
  counter: TokenCounter,
  infer: InferFunction,
  cancel: CancelSignal,
): Promise<string> {
  throwIfCancelled(cancel);
  const finalPrompt = (transcript: string): string =>
    buildSummaryPrompt({
      title: request.title,
      recordedAt: request.recordedAt,
      transcript,
      outputLanguage: request.outputLanguage,
      endedAt: request.endedAt,
      enhancement: request.enhancement,
    });

  const direct = finalPrompt(request.transcript);
  if ((await roomFor(counter, direct, FINAL_MAX_OUTPUT)) >= 0) {
    return infer(direct, FINAL_MAX_OUTPUT, SUMMARY_TEMPERATURE, cancel);
  }

  if ((await roomFor(counter, finalPrompt(''), FINAL_MAX_OUTPUT)) < NOTES_MAX_OUTPUT) {
    throw new SummaryError('NotesTooLong');
  }

  const language = toEnglishLanguageName(request.outputLanguage);
  const partBudget = await roomFor(
    counter,
    buildPartPrompt('', 64, 64, language),
    NOTES_MAX_OUTPUT,
  );
  const parts = await splitToBudget(counter, request.transcript, partBudget);
  if (parts.length > MAX_PARTS)
    throw new SummaryError('TranscriptTooLong', [parts.length, MAX_PARTS]);

  let notes: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    throwIfCancelled(cancel);
    const prompt = buildPartPrompt(parts[i] ?? '', i + 1, parts.length, language);
    notes.push(await infer(prompt, NOTES_MAX_OUTPUT, SUMMARY_TEMPERATURE, cancel));
  }

  const mergeRoom = await roomFor(counter, buildMergePrompt('', language), NOTES_MAX_OUTPUT);
  for (let pass = 0; pass <= MAX_MERGE_PASSES; pass++) {
    const prompt = finalPrompt(notes.join('\n\n'));
    if ((await roomFor(counter, prompt, FINAL_MAX_OUTPUT)) >= 0) {
      throwIfCancelled(cancel);
      return infer(prompt, FINAL_MAX_OUTPUT, SUMMARY_TEMPERATURE, cancel);
    }
    const groups = await groupToBudget(counter, notes, mergeRoom);
    if (groups.length === notes.length) break;
    const merged: string[] = [];
    for (const group of groups) {
      throwIfCancelled(cancel);
      const [only] = group;
      if (group.length === 1 && only !== undefined) {
        merged.push(only);
        continue;
      }
      const mergePrompt = buildMergePrompt(group.join('\n\n'), language);
      merged.push(await infer(mergePrompt, NOTES_MAX_OUTPUT, SUMMARY_TEMPERATURE, cancel));
    }
    notes = merged;
  }
  throw new SummaryError('CannotCondense');
}
