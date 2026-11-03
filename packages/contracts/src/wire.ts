import type {
  EventChannel,
  HandlerResultOf,
  InputOf,
  OutputOf,
  ParsedInputOf,
  PayloadInputOf,
  PayloadOf,
  RequestChannel,
} from './channel';
import { fail, IpcError, ok, type IpcResult } from './result';

/**
 * Transport-agnostic halves of the IPC mechanism. Electron wiring lives in
 * apps/desktop and only moves the values these functions produce and consume.
 */

export type Handler<C extends RequestChannel> = (
  input: ParsedInputOf<C>,
) => HandlerResultOf<C> | Promise<HandlerResultOf<C>>;

/**
 * Server end: validates raw input, runs the handler, validates its output.
 * Never throws; every failure becomes a typed result.
 */
export function serveRequest<C extends RequestChannel>(
  channel: C,
  handler: Handler<C>,
  onUnexpectedError?: (error: unknown) => void,
): (raw: unknown) => Promise<IpcResult<OutputOf<C>>> {
  return async (raw) => {
    const input = channel.input.safeParse(raw);
    if (!input.success) {
      return fail('invalid-input', `${channel.name}: ${input.error.message}`);
    }
    let value: unknown;
    try {
      value = await handler(input.data as ParsedInputOf<C>);
    } catch (error) {
      onUnexpectedError?.(error);
      return fail('handler-failed', `${channel.name} failed`);
    }
    const output = channel.output.safeParse(value);
    if (!output.success) {
      onUnexpectedError?.(output.error);
      return fail('invalid-output', `${channel.name}: handler returned an invalid value`);
    }
    return ok(output.data as OutputOf<C>);
  };
}

/**
 * Client end: validates input before it leaves, unwraps the result, validates
 * the output on arrival. Throws IpcError on any failure.
 */
export async function callRequest<C extends RequestChannel>(
  channel: C,
  input: InputOf<C>,
  send: (name: C['name'], input: unknown) => Promise<unknown>,
): Promise<OutputOf<C>> {
  const parsedInput = channel.input.safeParse(input);
  if (!parsedInput.success) {
    throw new IpcError('invalid-input', `${channel.name}: ${parsedInput.error.message}`);
  }
  const raw = await send(channel.name, parsedInput.data);
  const result = parseResult(raw);
  if (!result.ok) {
    throw new IpcError(result.error.code, result.error.message);
  }
  const output = channel.output.safeParse(result.value);
  if (!output.success) {
    throw new IpcError('invalid-output', `${channel.name}: ${output.error.message}`);
  }
  return output.data as OutputOf<C>;
}

function parseResult(raw: unknown): IpcResult {
  if (typeof raw === 'object' && raw !== null && 'ok' in raw) {
    const candidate = raw as { ok: unknown; value?: unknown; error?: unknown };
    if (candidate.ok === true) {
      return ok(candidate.value);
    }
    if (candidate.ok === false && typeof candidate.error === 'object' && candidate.error) {
      const { code, message } = candidate.error as { code?: unknown; message?: unknown };
      if (typeof code === 'string' && typeof message === 'string') {
        return fail(code as IpcError['code'], message);
      }
    }
  }
  return fail('invalid-output', 'malformed IPC result');
}

/** Sender side of an event: validates before anything is sent. */
export function prepareEvent<C extends EventChannel>(
  channel: C,
  payload: PayloadInputOf<C>,
): PayloadOf<C> {
  const parsed = channel.payload.safeParse(payload);
  if (!parsed.success) {
    throw new IpcError('invalid-input', `${channel.name}: ${parsed.error.message}`);
  }
  return parsed.data as PayloadOf<C>;
}

/** Listener side of an event: drops (and reports) payloads that do not validate. */
export function receiveEvent<C extends EventChannel>(
  channel: C,
  raw: unknown,
  listener: (payload: PayloadOf<C>) => void,
  onInvalid?: (error: IpcError) => void,
): void {
  const parsed = channel.payload.safeParse(raw);
  if (!parsed.success) {
    onInvalid?.(new IpcError('invalid-output', `${channel.name}: ${parsed.error.message}`));
    return;
  }
  listener(parsed.data as PayloadOf<C>);
}
