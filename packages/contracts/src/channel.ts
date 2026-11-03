import type { z } from 'zod';

/**
 * A request channel: the renderer asks, main answers once. Both ends validate
 * the input and the output against the same zod schemas.
 */
export interface RequestChannel<
  N extends string = string,
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  readonly kind: 'request';
  readonly name: N;
  readonly input: I;
  readonly output: O;
}

/** An event channel: main pushes, the renderer listens. No reply. */
export interface EventChannel<N extends string = string, P extends z.ZodType = z.ZodType> {
  readonly kind: 'event';
  readonly name: N;
  readonly payload: P;
}

export function defineRequest<const N extends string, I extends z.ZodType, O extends z.ZodType>(
  name: N,
  schemas: { input: I; output: O },
): RequestChannel<N, I, O> {
  return { kind: 'request', name, input: schemas.input, output: schemas.output };
}

export function defineEvent<const N extends string, P extends z.ZodType>(
  name: N,
  schemas: { payload: P },
): EventChannel<N, P> {
  return { kind: 'event', name, payload: schemas.payload };
}

/** What a caller passes. */
export type InputOf<C> = C extends RequestChannel<string, infer I> ? z.input<I> : never;
/** What the handler receives, after validation. */
export type ParsedInputOf<C> = C extends RequestChannel<string, infer I> ? z.output<I> : never;
/** What the handler returns, before output validation. */
export type HandlerResultOf<C> =
  C extends RequestChannel<string, z.ZodType, infer O> ? z.input<O> : never;
/** What the caller receives, after validation. */
export type OutputOf<C> =
  C extends RequestChannel<string, z.ZodType, infer O> ? z.output<O> : never;
export type PayloadOf<C> = C extends EventChannel<string, infer P> ? z.output<P> : never;
export type PayloadInputOf<C> = C extends EventChannel<string, infer P> ? z.input<P> : never;
