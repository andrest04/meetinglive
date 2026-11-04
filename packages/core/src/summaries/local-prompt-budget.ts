import { SummaryError } from './cli-failure-messages';
import { CONTEXT_TOKENS, SAFETY_MARGIN, type TokenCounter } from './local-map-reduce';

/** Spec 3.5 and the B8/B9 fixes. */
export const PROMPT_MAX_OUTPUT = 2048;
/** A chat or stream answer needs at least this much room, or the prompt is refused. */
export const MIN_PROMPT_REPLY = 64;
export const PROMPT_TEMPERATURE = 0.2;

/** Sampler values other than temperature (item 54). The WinUI app left these to the library. */
export const LOCAL_SAMPLING = {
  topP: 0.9,
  topK: 40,
  minP: 0.05,
  repeatPenalty: 1.1,
} as const;

/** Tokens left for the reply once the prompt and the safety margin are paid. */
export async function replyRoom(counter: TokenCounter, prompt: string): Promise<number> {
  return CONTEXT_TOKENS - SAFETY_MARGIN - (await counter.count(prompt));
}

/**
 * B9: the output cap for a chat or stream prompt is the room left after the prompt, at most
 * `PROMPT_MAX_OUTPUT`. A prompt that leaves less than `MIN_PROMPT_REPLY` is refused (B8).
 */
export async function promptOutputCap(counter: TokenCounter, prompt: string): Promise<number> {
  const room = await replyRoom(counter, prompt);
  if (room < MIN_PROMPT_REPLY) throw new SummaryError('PromptTooLong');
  return Math.min(PROMPT_MAX_OUTPUT, room);
}
