import type { SummaryTabStateDto } from '@vozella/contracts';
import { act } from '@testing-library/react';

type Listener = (payload: unknown) => void;
type Handler = (input: Record<string, unknown>) => unknown;

export const tabState = (extra: Partial<SummaryTabStateDto> = {}): SummaryTabStateDto => ({
  meetingId: 'm1',
  hasMeeting: true,
  title: 'Weekly sync',
  notes: '',
  summary: '',
  actionItems: [],
  noteTemplateId: 'auto',
  templates: [],
  related: [],
  flags: {
    hasSummary: false,
    canGenerate: false,
    canRegenerate: false,
    showEnhancedChrome: true,
    showNoteTemplate: false,
    showSummaryActionBar: false,
    showDraftActions: false,
    isEmpty: true,
    canExecuteGenerate: false,
    canExecuteRegenerate: false,
  },
  hasTranscript: false,
  ...extra,
});

/** A state with a summary, as the main process derives it. */
export const withSummary = (
  summary: string,
  extra: Partial<SummaryTabStateDto> = {},
): SummaryTabStateDto => {
  const base = tabState();
  return tabState({
    summary,
    flags: { ...base.flags, hasSummary: true, isEmpty: false },
    ...extra,
  });
};

/** A `window.vozella` for the Summary tab: scripted answers, recorded calls, pushable events. */
export function installSummariesApi(handlers: Record<string, Handler> = {}) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const listeners = new Map<string, Set<Listener>>();
  const table: Record<string, Handler> = {
    'summaries.loadTab': () => ({ status: 'loaded', state: tabState(), generating: false }),
    'summaries.saveNotes': () => ({ status: 'saved' }),
    'workspace.dispatch': () => ({}),
    ...handlers,
  };
  const invoke = (name: string, input: Record<string, unknown>): Promise<unknown> => {
    calls.push({ name, input });
    const handler = table[name];
    return handler ? Promise.resolve(handler(input)) : Promise.resolve({});
  };
  const on = (name: string, listener: Listener) => {
    const set = listeners.get(name) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(name, set);
    return () => {
      set.delete(listener);
    };
  };
  Object.defineProperty(window, 'vozella', {
    value: { invoke, on },
    configurable: true,
    writable: true,
  });
  const emit = (name: string, payload: unknown): void => {
    act(() => {
      for (const listener of listeners.get(name) ?? []) listener(payload);
    });
  };
  return { calls, emit, table };
}
