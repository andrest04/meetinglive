/**
 * Pure parsers for the line-delimited JSON the CLI engines print in streaming mode. One parser per
 * process run: feed it each stdout line, it answers with what the line means. Lines that are not
 * JSON objects, and event types it does not know, mean nothing; a CLI may add events at any time.
 */

export type CliStreamEvent =
  /** A piece of the answer, in order. All pieces together are the streamed answer. */
  | { readonly kind: 'text'; readonly text: string }
  /** The CLI's own full answer for a message, used when no pieces arrived. */
  | { readonly kind: 'final'; readonly text: string }
  /** The CLI reported a failure; `message` is the CLI's text, for classification. */
  | { readonly kind: 'error'; readonly message: string };

export interface CliStreamParser {
  push(line: string): CliStreamEvent[];
  /** True once any line parsed as JSON, so the output was the stream format at all. */
  readonly parsedAny: boolean;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Text from separate messages is kept apart by a blank line, like the CLI's plain output. */
const MESSAGE_GAP = '\n\n';

/** The shared part: JSON decoding, `parsedAny`, and the gap between messages. */
abstract class JsonLineParser implements CliStreamParser {
  parsedAny = false;
  private emitted = false;
  private gapPending = false;

  push(line: string): CliStreamEvent[] {
    const trimmed = line.trim();
    if (trimmed === '') return [];
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return [];
    }
    this.parsedAny = true;
    return isObject(value) ? this.event(value) : [];
  }

  protected abstract event(event: Json): CliStreamEvent[];

  /** The next text starts a new message. */
  protected newMessage(): void {
    if (this.emitted) this.gapPending = true;
  }

  protected text(text: string): CliStreamEvent[] {
    if (text === '') return [];
    const gap = this.gapPending ? MESSAGE_GAP : '';
    this.gapPending = false;
    this.emitted = true;
    return [{ kind: 'text', text: gap + text }];
  }
}

/**
 * `claude -p --output-format stream-json --verbose --include-partial-messages`. Text comes from
 * `stream_event` / `content_block_delta` / `text_delta` of the main agent; the closing `result`
 * event carries the final answer or the error.
 */
class ClaudeStreamParser extends JsonLineParser {
  protected event(event: Json): CliStreamEvent[] {
    if (event.type === 'stream_event') return this.streamEvent(event);
    if (event.type === 'result') return [resultEvent(event)];
    return [];
  }

  private streamEvent(event: Json): CliStreamEvent[] {
    // A sub-agent's output is not the answer.
    if (event.parent_tool_use_id !== null && event.parent_tool_use_id !== undefined) return [];
    const inner = event.event;
    if (!isObject(inner)) return [];
    if (inner.type === 'message_start') {
      this.newMessage();
      return [];
    }
    if (inner.type !== 'content_block_delta' || !isObject(inner.delta)) return [];
    if (inner.delta.type !== 'text_delta') return [];
    return this.text(str(inner.delta.text) ?? '');
  }
}

function resultEvent(event: Json): CliStreamEvent {
  const result = str(event.result);
  if (event.is_error === true || (event.subtype !== undefined && event.subtype !== 'success')) {
    const listed = Array.isArray(event.errors) ? event.errors.filter((e) => str(e) !== null) : [];
    const message = result ?? (listed.length > 0 ? listed.join('; ') : String(event.subtype));
    return { kind: 'error', message };
  }
  return { kind: 'final', text: result ?? '' };
}

/**
 * `codex exec --json`. The answer is the `agent_message` item; `item.updated` may carry it as it
 * grows, `item.completed` carries it whole. Only the new tail of a growing text is emitted.
 * `turn.failed` is the failure; a top-level `error` may be a retry notice, so it only supplies the
 * message when the turn fails without one.
 */
class CodexStreamParser extends JsonLineParser {
  private readonly sent = new Map<string, string>();
  private lastError: string | null = null;

  protected event(event: Json): CliStreamEvent[] {
    if (event.type === 'error') {
      this.lastError = str(event.message);
      return [];
    }
    if (event.type === 'turn.failed') {
      const error = isObject(event.error) ? str(event.error.message) : null;
      const message = error ?? this.lastError ?? 'turn failed';
      return [{ kind: 'error', message: apiMessage(message) }];
    }
    if (event.type !== 'item.updated' && event.type !== 'item.completed') return [];
    const item = event.item;
    if (!isObject(item) || item.type !== 'agent_message') return [];
    const text = str(item.text) ?? '';
    const id = str(item.id) ?? '';
    const before = this.sent.get(id);
    if (before === undefined) this.newMessage();
    const events: CliStreamEvent[] = [];
    // A text that is not a continuation of what was sent cannot be streamed; `final` still has it.
    if (before === undefined || text.startsWith(before)) {
      events.push(...this.text(text.slice(before?.length ?? 0)));
      this.sent.set(id, text);
    }
    if (event.type === 'item.completed') events.push({ kind: 'final', text });
    return events;
  }
}

/** Codex wraps the API error as a JSON string; the inner `error.message` is the readable part. */
function apiMessage(message: string): string {
  try {
    const parsed: unknown = JSON.parse(message);
    if (isObject(parsed) && isObject(parsed.error)) {
      return str(parsed.error.message) ?? message;
    }
  } catch {
    // not JSON: the message is already plain text
  }
  return message;
}

export function createClaudeStreamParser(): CliStreamParser {
  return new ClaudeStreamParser();
}

export function createCodexStreamParser(): CliStreamParser {
  return new CodexStreamParser();
}
