import { describe, expect, it } from 'vitest';
import {
  createClaudeStreamParser,
  createCodexStreamParser,
  type CliStreamEvent,
  type CliStreamParser,
} from './cli-stream-parsers';
import { CLAUDE_STREAM_JSON_LINES } from './fixtures/claude-stream-json';
import { CODEX_EXEC_JSON_LINES } from './fixtures/codex-exec-json';
import { CODEX_EXEC_JSON_ERROR_LINES } from './fixtures/codex-exec-json-error';

const FIXTURES: Record<string, readonly string[]> = {
  'claude-stream-json.jsonl': CLAUDE_STREAM_JSON_LINES,
  'codex-exec-json.jsonl': CODEX_EXEC_JSON_LINES,
  'codex-exec-json-error.jsonl': CODEX_EXEC_JSON_ERROR_LINES,
};
const fixture = (name: string): readonly string[] => FIXTURES[name] ?? [];

function feed(parser: CliStreamParser, lines: readonly string[]): CliStreamEvent[] {
  return lines.flatMap((line) => parser.push(line));
}

const texts = (events: readonly CliStreamEvent[]): string[] =>
  events.flatMap((e) => (e.kind === 'text' ? [e.text] : []));
const finals = (events: readonly CliStreamEvent[]): string[] =>
  events.flatMap((e) => (e.kind === 'final' ? [e.text] : []));
const errors = (events: readonly CliStreamEvent[]): string[] =>
  events.flatMap((e) => (e.kind === 'error' ? [e.message] : []));

describe('Claude stream-json parser (real capture, claude 2.1.318)', () => {
  it('yields the text deltas, several of them, that add up to the final result', () => {
    const parser = createClaudeStreamParser();
    const events = feed(parser, fixture('claude-stream-json.jsonl'));
    const deltas = texts(events);
    expect(deltas.length).toBeGreaterThan(1);
    expect(finals(events)).toEqual(['¡Hola! ¿En qué te ayudo?']);
    expect(deltas.join('')).toBe(finals(events)[0]);
    expect(errors(events)).toEqual([]);
    expect(parser.parsedAny).toBe(true);
  });

  it('ignores thinking, hooks, system, assistant snapshots and rate limit events', () => {
    const parser = createClaudeStreamParser();
    const noise = fixture('claude-stream-json.jsonl').filter(
      (l) => !l.includes('"text_delta"') && !l.includes('"type":"result"'),
    );
    expect(feed(parser, noise)).toEqual([]);
  });

  it('ignores deltas from a sub-agent (parent_tool_use_id set)', () => {
    const parser = createClaudeStreamParser();
    const line = JSON.stringify({
      type: 'stream_event',
      parent_tool_use_id: 'toolu_1',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } },
    });
    expect(parser.push(line)).toEqual([]);
  });

  it('separates the text of two assistant messages (text, tool use, text)', () => {
    const parser = createClaudeStreamParser();
    const delta = (text: string) =>
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      });
    const start = JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } });
    const events = feed(parser, [start, delta('Let me search.'), start, delta('Found it.')]);
    expect(texts(events).join('')).toBe('Let me search.\n\nFound it.');
  });

  it('turns an error result into an error event', () => {
    const parser = createClaudeStreamParser();
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Not logged in · Please run /login',
    });
    expect(parser.push(line)).toEqual([
      { kind: 'error', message: 'Not logged in · Please run /login' },
    ]);
  });

  it('turns a non-success result subtype into an error event', () => {
    const parser = createClaudeStreamParser();
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['boom'],
    });
    expect(errors(parser.push(line))).toEqual(['boom']);
  });

  it('skips lines that are not JSON and unknown event types', () => {
    const parser = createClaudeStreamParser();
    expect(parser.push('plain text')).toEqual([]);
    expect(parser.parsedAny).toBe(false);
    expect(parser.push('{"type":"brand_new_event","x":1}')).toEqual([]);
    expect(parser.push('[1,2]')).toEqual([]);
    expect(parser.parsedAny).toBe(true);
  });
});

describe('Codex exec --json parser', () => {
  it('streams the growing agent message and ends with the full text (codex 0.164 shape)', () => {
    const parser = createCodexStreamParser();
    const events = feed(parser, fixture('codex-exec-json.jsonl'));
    expect(texts(events)).toEqual(['¡Hola! ¿Cómo', ' estás hoy, amigo?']);
    expect(finals(events)).toEqual(['¡Hola! ¿Cómo estás hoy, amigo?']);
    expect(texts(events).join('')).toBe(finals(events)[0]);
    expect(errors(events)).toEqual([]);
  });

  it('emits the completed message alone when there are no updates', () => {
    const parser = createCodexStreamParser();
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_3', type: 'agent_message', text: 'Done.' },
    });
    expect(parser.push(line)).toEqual([
      { kind: 'text', text: 'Done.' },
      { kind: 'final', text: 'Done.' },
    ]);
  });

  it('ignores reasoning, warning items and unknown events', () => {
    const parser = createCodexStreamParser();
    const noise = fixture('codex-exec-json.jsonl').filter((l) => !l.includes('agent_message'));
    expect(feed(parser, noise)).toEqual([]);
    expect(parser.push('{"type":"item.completed","item":{"type":"command_execution"}}')).toEqual(
      [],
    );
  });

  it('reports a failed turn with the API message (real capture)', () => {
    const parser = createCodexStreamParser();
    const events = feed(parser, fixture('codex-exec-json-error.jsonl'));
    expect(texts(events)).toEqual([]);
    expect(errors(events)).toEqual([
      "The 'gpt-5.6' model is not supported when using Codex with a ChatGPT account.",
    ]);
  });

  it('separates two agent messages', () => {
    const parser = createCodexStreamParser();
    const done = (id: string, text: string) =>
      JSON.stringify({ type: 'item.completed', item: { id, type: 'agent_message', text } });
    const events = feed(parser, [done('a', 'One.'), done('b', 'Two.')]);
    expect(texts(events).join('')).toBe('One.\n\nTwo.');
    expect(finals(events)).toEqual(['One.', 'Two.']);
  });
});
