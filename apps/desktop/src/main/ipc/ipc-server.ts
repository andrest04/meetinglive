import {
  fail,
  prepareEvent,
  serveRequest,
  type EventChannel,
  type Handler,
  type PayloadInputOf,
  type RequestChannel,
} from '@vozella/contracts';
import type { Logger } from '@vozella/core';
import type { IpcMainInvokeEvent } from 'electron';
import type { IpcEventLike } from '../security/trusted-origin';

/** The slice of ipcMain this module needs. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void;
}

export interface IpcServerDeps {
  readonly ipc: IpcMainLike;
  readonly isTrusted: (event: IpcEventLike) => boolean;
  readonly logger: Logger;
}

/**
 * Registers one request channel. The sender is checked first, then input and output are
 * validated by the shared contract code. Handler errors are logged here and never sent.
 */
export function registerRequest<C extends RequestChannel>(
  deps: IpcServerDeps,
  channel: C,
  handler: Handler<C>,
): void {
  const serve = serveRequest(channel, handler, (error) => {
    deps.logger.error(`ipc handler failed: ${channel.name}`, { error });
  });
  deps.ipc.handle(channel.name, (event, raw) => {
    if (!deps.isTrusted(event)) {
      deps.logger.warn(`ipc rejected untrusted sender: ${channel.name}`, {
        url: event.senderFrame?.url ?? null,
      });
      return fail('untrusted-sender', `${channel.name}: sender is not trusted`);
    }
    return serve(raw);
  });
}

/** Sends an event to one window after validating its payload. */
export function sendEvent<C extends EventChannel>(
  target: { send(channel: string, payload: unknown): void; isDestroyed(): boolean },
  channel: C,
  payload: PayloadInputOf<C>,
): void {
  if (target.isDestroyed()) return;
  target.send(channel.name, prepareEvent(channel, payload));
}
