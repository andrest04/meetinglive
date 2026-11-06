import { useEffect } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { QuestionCard } from './QuestionCard';
import {
  answerQuestion,
  connectLiveQuestions,
  dismissQuestion,
  useLiveQuestionsStore,
} from './use-live-questions';

export interface LiveQuestionSlotProps {
  /** False hides the card (another holder in this window shows it) but keeps nothing else. */
  readonly show?: boolean;
  readonly className?: string;
}

/**
 * Where a detected question appears: the Record dock, the pill and the AI panel in Live scope.
 * The polite live region is always mounted, so a new card is announced once it lands; it stays
 * silent while `show` is false so a window never announces the same card twice.
 */
export function LiveQuestionSlot({ show = true, className }: LiveQuestionSlotProps) {
  const t = useT();
  const question = useLiveQuestionsStore((s) => s.question);
  useEffect(() => connectLiveQuestions(), []);

  const visible = show && question !== null;
  return (
    <>
      <p aria-live="polite" className="sr-only" data-testid="LiveQuestionAnnouncement">
        {visible ? t('Ui_LiveQuestionAnnounce', question.body) : ''}
      </p>
      {visible ? (
        <QuestionCard
          body={question.body}
          checking={!question.confirmed}
          className={className}
          labels={{
            title: t('Ui_LiveQuestionTitle'),
            checking: t('Ui_LiveQuestionChecking'),
            answer: t('Ui_LiveQuestionAnswer'),
            dismiss: t('Ui_LiveQuestionDismiss'),
          }}
          onAnswer={() => void answerQuestion(question)}
          onDismiss={() => {
            dismissQuestion(question);
          }}
        />
      ) : null}
    </>
  );
}
