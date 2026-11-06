import type { RecordingQuestionDto } from '@vozella/contracts';
import { create } from 'zustand';
import { isAnswerQuestionShortcut } from '../../app/shortcuts';
import { askLive } from './use-live-ask';

/**
 * The detected question card of this window (live question detection). Main sends the newest
 * question through `recording.questionDetected` and takes it back through
 * `recording.questionWithdrawn`; a window shows one card at a time. Answer asks it through the
 * typed live ask; Answer and Dismiss both tell main, which removes it from every window and keeps
 * it from returning in the take. Nothing is answered without the user.
 */

export interface LiveQuestionsStore {
  readonly question: RecordingQuestionDto | null;
  /** The Record dock shows the card; the AI panel then leaves it out to avoid a second copy. */
  readonly docks: number;
}

const initial = (): LiveQuestionsStore => ({ question: null, docks: 0 });

export const useLiveQuestionsStore = create<LiveQuestionsStore>(() => initial());

const set = useLiveQuestionsStore.setState;
const get = useLiveQuestionsStore.getState;

/** Test seam: forget everything, as a fresh window would. */
export function resetLiveQuestionsStore(): void {
  set(initial(), true);
}

export const applyQuestionDetected = (question: RecordingQuestionDto): void => {
  set({ question });
};

export const applyQuestionWithdrawn = ({ id }: { readonly id: string }): void => {
  if (get().question?.id === id) set({ question: null });
};

function forget(id: string): void {
  applyQuestionWithdrawn({ id });
  void window.vozella.invoke('recording.dismissQuestion', { id }).catch(() => undefined);
}

export function dismissQuestion(question: RecordingQuestionDto): void {
  forget(question.id);
}

/** Asks the card's question through the live ask; the card goes once main took it. */
export async function answerQuestion(question: RecordingQuestionDto): Promise<boolean> {
  const accepted = await askLive(question.body);
  if (accepted) forget(question.id);
  return accepted;
}

/** The Record dock registers itself while it is on screen. Returns the unregister. */
export function registerQuestionDock(): () => void {
  set({ docks: get().docks + 1 });
  return () => {
    set({ docks: Math.max(0, get().docks - 1) });
  };
}

const onKeyDown = (event: KeyboardEvent): void => {
  const question = get().question;
  if (question === null || !isAnswerQuestionShortcut(event)) return;
  // A modal dialog owns the keyboard.
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[role="dialog"], [role="alertdialog"]')) return;
  event.preventDefault();
  void answerQuestion(question);
};

let connections = 0;
let disconnect: (() => void) | null = null;

/**
 * Listens to the cards and to Ctrl+Enter while a card holder is mounted. Counted, so the dock, the
 * AI panel and the pill share one subscription and one shortcut handler per window.
 */
export function connectLiveQuestions(): () => void {
  connections += 1;
  if (connections === 1) {
    const offDetected = window.vozella.on('recording.questionDetected', applyQuestionDetected);
    const offWithdrawn = window.vozella.on('recording.questionWithdrawn', applyQuestionWithdrawn);
    window.addEventListener('keydown', onKeyDown);
    disconnect = () => {
      offDetected();
      offWithdrawn();
      window.removeEventListener('keydown', onKeyDown);
    };
  }
  return () => {
    connections -= 1;
    if (connections === 0) {
      disconnect?.();
      disconnect = null;
    }
  };
}
