import type { ChatMessageDto } from '@vozella/contracts';

/** One row of the transcript. `pending` is the assistant row that waits for its first text. */
export interface ChatRow {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly pending: boolean;
}

export interface ChatError {
  readonly message: string;
  /** False for a plain remark such as a cancelled setup, which has no "could not answer" title. */
  readonly titled: boolean;
}

export interface ChatViewState {
  readonly rows: readonly ChatRow[];
  readonly activeRequestId: string | null;
  readonly error: ChatError | null;
}

export const INITIAL_VIEW: ChatViewState = { rows: [], activeRequestId: null, error: null };

export type ChatViewAction =
  | { readonly type: 'hydrate'; readonly messages: readonly ChatMessageDto[] }
  /** The optimistic pair: the user's text and an empty assistant row. Also clears the error. */
  | {
      readonly type: 'sendStarted';
      readonly requestId: string;
      readonly text: string;
      /** The open conversation belongs to another scope, so this send starts a new one. */
      readonly replace: boolean;
    }
  /** The gate finished and the same pair is sent again under a new request id. */
  | { readonly type: 'resend'; readonly requestId: string }
  | { readonly type: 'chunk'; readonly requestId: string; readonly text: string }
  | {
      readonly type: 'answered';
      readonly requestId: string;
      readonly user: ChatMessageDto;
      readonly assistant: ChatMessageDto;
    }
  /** Both optimistic rows go away, whatever the reason (failure, stop, cancelled setup). */
  | { readonly type: 'rolledBack'; readonly requestId: string }
  | { readonly type: 'failed'; readonly error: ChatError | null }
  | { readonly type: 'dismissError' }
  | { readonly type: 'reset' };

const fromMessage = (m: ChatMessageDto): ChatRow => ({
  id: m.id,
  role: m.role,
  text: m.text,
  pending: false,
});

const optimisticId = (requestId: string, role: 'u' | 'a'): string => `${role}:${requestId}`;
const isOptimistic = (row: ChatRow): boolean => /^[ua]:/.test(row.id);

export function chatViewReducer(state: ChatViewState, action: ChatViewAction): ChatViewState {
  switch (action.type) {
    case 'hydrate':
      // A send in flight owns its rows; the server list only fills an idle view.
      if (state.activeRequestId !== null) return state;
      return { ...state, rows: action.messages.map(fromMessage) };
    case 'sendStarted': {
      const base = action.replace ? [] : state.rows;
      return {
        rows: [
          ...base,
          {
            id: optimisticId(action.requestId, 'u'),
            role: 'user',
            text: action.text,
            pending: false,
          },
          { id: optimisticId(action.requestId, 'a'), role: 'assistant', text: '', pending: true },
        ],
        activeRequestId: action.requestId,
        error: null,
      };
    }
    case 'resend':
      if (state.activeRequestId === null) return state;
      return {
        ...state,
        activeRequestId: action.requestId,
        rows: state.rows.map((row) => {
          if (!isOptimistic(row)) return row;
          return { ...row, id: optimisticId(action.requestId, row.role === 'user' ? 'u' : 'a') };
        }),
      };
    case 'chunk':
      if (action.requestId !== state.activeRequestId) return state;
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.id === optimisticId(action.requestId, 'a') ? { ...row, text: action.text } : row,
        ),
      };
    case 'answered': {
      if (action.requestId !== state.activeRequestId) return state;
      const kept = state.rows.filter((row) => !isOptimistic(row));
      return {
        ...state,
        activeRequestId: null,
        rows: [...kept, fromMessage(action.user), fromMessage(action.assistant)],
      };
    }
    case 'rolledBack':
      if (action.requestId !== state.activeRequestId) return state;
      return {
        ...state,
        activeRequestId: null,
        rows: state.rows.filter((row) => !isOptimistic(row)),
      };
    case 'failed':
      return { ...state, error: action.error };
    case 'dismissError':
      return { ...state, error: null };
    case 'reset':
      return INITIAL_VIEW;
  }
}

/** The draft comes back only into an empty composer, so text typed since is never overwritten. */
export function restoreDraft(current: string, original: string): string {
  return current.trim() === '' ? original : current;
}

/** What Enter and Ctrl+Enter do in the composer (spec 2.3, S1). */
export type KeyIntent = 'send' | 'newline' | 'ignore' | 'swallow';

export interface KeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly isComposing: boolean;
  readonly draft: string;
  readonly sending: boolean;
}

/**
 * Enter sends, Shift+Enter inserts a line, Ctrl+Enter sends. Enter on an empty draft or while an
 * answer runs does nothing and inserts no line (`swallow`); Enter during IME composition is left
 * to the IME (`ignore`).
 */
export function keyIntent(input: KeyInput): KeyIntent {
  if (input.key !== 'Enter') return 'ignore';
  if (input.isComposing) return 'ignore';
  if (input.shiftKey && !input.ctrlKey) return 'newline';
  if (input.sending || input.draft.trim() === '') return 'swallow';
  return 'send';
}

/** The text a screen reader reads for a message (parity 126). */
export const accessibleMessageText = (role: string, text: string): string => `${role}: ${text}`;
