import { z } from 'zod';
import { defineEvent, defineRequest } from './channel';

const empty = z.object({}).strict();
const done = z.object({ done: z.literal(true) });

export const pillEdgeSchema = z.enum(['Left', 'Right', 'Top', 'Bottom']);
export type PillEdgeDto = z.infer<typeof pillEdgeSchema>;

const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

/**
 * Everything the pill page draws from the window. All rectangles are in DIP, relative to the top
 * left of the window content, so the page lays out the capsule and the panel without asking the
 * window anything. The window is the capsule (plus a transparent gutter) or, expanded, the union
 * of the capsule and the panel.
 */
export const pillStateSchema = z.object({
  visible: z.boolean(),
  expanded: z.boolean(),
  edge: pillEdgeSchema,
  /** The orientation the capsule is laid out in. It flips half way through a snap across axes. */
  vertical: z.boolean(),
  /** False when the OS asks for no animations: the page plays no pulse and no panel slide. */
  animationsEnabled: z.boolean(),
  /** Opacity of the whole page: the entrance and exit fade. */
  opacity: z.number(),
  /** Opacity of the capsule while a snap flips orientation. */
  contentOpacity: z.number(),
  window: z.object({ width: z.number(), height: z.number() }),
  capsule: rectSchema,
  /** Null while collapsed. */
  panel: rectSchema.nullable(),
});
export type PillStateDto = z.infer<typeof pillStateSchema>;

/** Main pushes the pill state on every change. */
export const pillStateChanged = defineEvent('pill.state', { payload: pillStateSchema });

/**
 * The "recording started" hint: show the tooltip on the logo tile for `durationMs`, opening away
 * from `edge`, with a pulse of the capsule when animations are on. `show: false` closes it early
 * (hide, drag, close).
 */
export const pillHint = defineEvent('pill.hint', {
  payload: z.object({
    show: z.boolean(),
    durationMs: z.number().int(),
    edge: pillEdgeSchema,
    pulse: z.boolean(),
  }),
});

/** Pause when recording, resume when paused. */
export const pillTogglePause = defineRequest('pill.togglePause', {
  input: empty,
  output: done,
});

/** Stop and save the take. */
export const pillStop = defineRequest('pill.stop', { input: empty, output: done });

/** Bring the main window forward (restore it when minimized). */
export const pillOpenApp = defineRequest('pill.openApp', { input: empty, output: done });

/** Open or close the chat panel. Answers the state in force afterwards. */
export const pillSetExpanded = defineRequest('pill.setExpanded', {
  input: z.object({ expanded: z.boolean() }),
  output: pillStateSchema,
});

/** The pill page finished starting. Main answers the current state so an earlier push is not lost. */
export const pillReady = defineRequest('pill.ready', { input: empty, output: pillStateSchema });
