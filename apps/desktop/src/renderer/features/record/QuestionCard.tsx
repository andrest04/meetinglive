import { useId } from 'react';
import { chordLabel } from '../../app/shortcuts';
import { Button, cn } from '../../ui';

export interface QuestionCardLabels {
  readonly title: string;
  readonly checking: string;
  readonly answer: string;
  readonly dismiss: string;
}

export interface QuestionCardProps {
  readonly body: string;
  /** The optional engine check is still running. */
  readonly checking: boolean;
  readonly labels: QuestionCardLabels;
  readonly onAnswer: () => void;
  readonly onDismiss: () => void;
  /** Extra classes from the holder (the pill marks its controls as not draggable). */
  readonly className?: string;
}

/**
 * A question spoken in the meeting, offered for an answer (presentational). It never answers on
 * its own: Answer (or Ctrl+Enter outside a text box) asks it, Dismiss puts it away for the take.
 */
export function QuestionCard({
  body,
  checking,
  labels,
  onAnswer,
  onDismiss,
  className,
}: QuestionCardProps) {
  const titleId = useId();
  const chord = chordLabel('liveAsk');
  return (
    <section
      aria-labelledby={titleId}
      data-testid="LiveQuestionCard"
      data-confirmed={!checking}
      className={cn(
        'flex flex-col gap-2 rounded-control border border-hairline bg-paper p-3 text-ink animate-fade-in motion-reduce:animate-none forced-colors:border-[CanvasText]',
        className,
      )}
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h3 id={titleId} className="text-ui font-medium text-ink-muted">
          {labels.title}
        </h3>
        {checking ? (
          <span data-testid="LiveQuestionChecking" className="text-ui text-ink-faint">
            {labels.checking}
          </span>
        ) : null}
      </div>
      <blockquote
        data-testid="LiveQuestionBody"
        className="border-s-2 border-hairline ps-2 text-ui-lg select-text forced-colors:border-[CanvasText]"
      >
        {body}
      </blockquote>
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="BtnLiveQuestionAnswer"
          variant="primary"
          size="sm"
          aria-keyshortcuts="Control+Enter"
          title={chord}
          onClick={onAnswer}
        >
          {labels.answer}
        </Button>
        <Button data-testid="BtnLiveQuestionDismiss" size="sm" onClick={onDismiss}>
          {labels.dismiss}
        </Button>
      </div>
    </section>
  );
}
