import type { EventChannel, InputOf, OutputOf, PayloadOf, RequestChannel } from './channel';
import {
  eventChannels,
  requestChannels,
  type EventChannels,
  type EventName,
  type RequestChannels,
  type RequestName,
} from './channels';
import { callRequest, receiveEvent } from './wire';

/** The typed surface the preload script exposes as `window.vozella`. */
export interface VozellaApi {
  invoke<N extends RequestName>(
    name: N,
    input: InputOf<RequestChannels[N]>,
  ): Promise<OutputOf<RequestChannels[N]>>;
  on<N extends EventName>(
    name: N,
    listener: (payload: PayloadOf<EventChannels[N]>) => void,
  ): () => void;
}

/** Raw, untyped movement of values. Implemented over ipcRenderer in the preload. */
export interface ClientTransport {
  send(name: string, input: unknown): Promise<unknown>;
  subscribe(name: string, listener: (raw: unknown) => void): () => void;
}

// Names arrive from the page at runtime, so look them up as plain strings.
const requestsByName: Readonly<Partial<Record<string, RequestChannel>>> = requestChannels;
const eventsByName: Readonly<Partial<Record<string, EventChannel>>> = eventChannels;

export function createApi(
  transport: ClientTransport,
  onInvalidEvent?: (error: Error) => void,
): VozellaApi {
  return {
    invoke(name, input) {
      const channel = requestsByName[name];
      if (!channel) {
        return Promise.reject(new Error(`unknown request channel: ${name}`));
      }
      return callRequest(channel, input, (n, i) => transport.send(n, i)) as never;
    },
    on(name, listener) {
      const channel = eventsByName[name];
      if (!channel) {
        throw new Error(`unknown event channel: ${name}`);
      }
      return transport.subscribe(channel.name, (raw) => {
        receiveEvent(channel, raw, listener as (payload: unknown) => void, onInvalidEvent);
      });
    },
  };
}
