import type { ChatScopeDto, ChatSendOutcomeDto, ChatStateDto } from '@vozella/contracts';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import type { ProviderGate } from '../summaries/use-provider-gate';
import { INITIAL_VIEW, chatViewReducer, restoreDraft, type ChatViewState } from './chat-view-model';

export interface ChatController {
  readonly view: ChatViewState;
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly isSending: boolean;
  readonly showScopeMismatch: boolean;
  /** Sends `text` (the composer draft or a chip prompt). Resolves when the answer is settled. */
  readonly send: (text: string) => Promise<void>;
  readonly stop: () => void;
  readonly copy: (text: string) => Promise<boolean>;
  readonly dismissError: () => void;
  /** Puts a plain line in the error notice (a failed link, for example). */
  readonly reportError: (message: string) => void;
}

const newRequestId = (): string => `req-${crypto.randomUUID()}`;

/**
 * The conversation as the page sees it: optimistic rows, the stream, the provider gate and the
 * rollbacks. Main owns the real conversation; this hook mirrors it and answers for one send.
 */
export function useChat(scope: ChatScopeDto, gate: ProviderGate): ChatController {
  const t = useT();
  const [view, dispatch] = useReducer(chatViewReducer, INITIAL_VIEW);
  const [draft, setDraftState] = useState('');
  const [server, setServer] = useState({ isSending: false, showScopeMismatch: false });
  const draftRef = useRef('');
  const mismatchRef = useRef(false);
  const sendingRef = useRef(false);
  const latest = useRef({ t, gate, scope });
  latest.current = { t, gate, scope };
  const alive = useRef(true);

  const setDraft = useCallback((value: string): void => {
    draftRef.current = value;
    setDraftState(value);
  }, []);

  useEffect(() => {
    alive.current = true;
    const apply = (state: ChatStateDto): void => {
      mismatchRef.current = state.showScopeMismatch;
      setServer({ isSending: state.isSending, showScopeMismatch: state.showScopeMismatch });
      if (!sendingRef.current) dispatch({ type: 'hydrate', messages: state.messages });
    };
    void window.vozella
      .invoke('chat.state', {})
      .then((state) => {
        if (alive.current) apply(state);
      })
      .catch(() => undefined);
    const offState = window.vozella.on('chat.stateChanged', ({ state }) => {
      apply(state);
    });
    const offChunk = window.vozella.on('chat.chunk', ({ requestId, text }) => {
      dispatch({ type: 'chunk', requestId, text });
    });
    return () => {
      alive.current = false;
      offState();
      offChunk();
    };
  }, []);

  const send = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim();
      if (text === '' || sendingRef.current || !latest.current.scope.isVisible) return;
      sendingRef.current = true;
      let requestId = newRequestId();
      dispatch({ type: 'sendStarted', requestId, text, replace: mismatchRef.current });
      setDraft('');

      const rollBack = (): void => {
        dispatch({ type: 'rolledBack', requestId });
        setDraft(restoreDraft(draftRef.current, raw));
      };
      const request = async (): Promise<ChatSendOutcomeDto> => {
        // B5: the live transcript is read once, when the user presses send.
        const workspace = await window.vozella.invoke('workspace.getState', {});
        return window.vozella.invoke('chat.send', {
          requestId,
          draft: raw,
          scope: latest.current.scope,
          liveTranscript: workspace.liveTranscript === '' ? null : workspace.liveTranscript,
        });
      };

      try {
        let outcome = await request();
        if (outcome.status === 'setup-required') {
          const result = await latest.current.gate.runSetup({
            kind: outcome.kind,
            reason: outcome.kind === 'Local' ? 'model-missing' : 'cli-missing',
          });
          if (result === 'completed') {
            requestId = newRequestId();
            dispatch({ type: 'resend', requestId });
            outcome = await request();
          }
          if (result !== 'completed' || outcome.status === 'setup-required') {
            rollBack();
            dispatch({
              type: 'failed',
              error: { message: latest.current.t('Status_SetupCancelled'), titled: false },
            });
            return;
          }
        }
        switch (outcome.status) {
          case 'answered':
            dispatch({
              type: 'answered',
              requestId,
              user: outcome.user,
              assistant: outcome.assistant,
            });
            break;
          case 'failed':
            rollBack();
            dispatch({
              type: 'failed',
              error: { message: outcome.message, titled: outcome.kind !== 'setup-cancelled' },
            });
            break;
          case 'cancelled':
          case 'empty':
            rollBack();
            break;
        }
      } catch (error) {
        rollBack();
        const detail = error instanceof Error ? error.message : String(error);
        dispatch({
          type: 'failed',
          error: { message: latest.current.t('Chat_SendFailed', detail), titled: true },
        });
      } finally {
        sendingRef.current = false;
      }
    },
    [setDraft],
  );

  const stop = useCallback((): void => {
    void window.vozella.invoke('chat.cancel', {}).catch(() => undefined);
  }, []);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    try {
      const result = await window.vozella.invoke('chat.copyText', { text });
      if (result.status === 'failed') {
        dispatch({
          type: 'failed',
          error: { message: latest.current.t('Chat_CopyFailed', result.detail), titled: false },
        });
      }
      return result.status === 'written';
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      dispatch({
        type: 'failed',
        error: { message: latest.current.t('Chat_CopyFailed', detail), titled: false },
      });
      return false;
    }
  }, []);

  const dismissError = useCallback((): void => {
    dispatch({ type: 'dismissError' });
  }, []);

  const reportError = useCallback((message: string): void => {
    dispatch({ type: 'failed', error: { message, titled: false } });
  }, []);

  return {
    view,
    draft,
    setDraft,
    isSending: view.activeRequestId !== null || server.isSending,
    showScopeMismatch: server.showScopeMismatch,
    send,
    stop,
    copy,
    dismissError,
    reportError,
  };
}
