/** Error codes that cross the IPC boundary. Handlers never leak stack traces. */
export const ipcErrorCodes = [
  'invalid-input',
  'invalid-output',
  'untrusted-sender',
  'unknown-channel',
  'handler-failed',
] as const;

export type IpcErrorCode = (typeof ipcErrorCodes)[number];

export interface IpcFailure {
  readonly code: IpcErrorCode;
  readonly message: string;
}

/** The only shape a request handler ever sends back over the wire. */
export type IpcResult<T = unknown> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: IpcFailure };

export class IpcError extends Error {
  readonly code: IpcErrorCode;

  constructor(code: IpcErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'IpcError';
    this.code = code;
  }
}

export const ok = <T>(value: T): IpcResult<T> => ({ ok: true, value });

export const fail = (code: IpcErrorCode, message: string): IpcResult<never> => ({
  ok: false,
  error: { code, message },
});
