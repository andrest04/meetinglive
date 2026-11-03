import { memo, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Notice, SkeletonText, cn } from '../../ui';
import { hasTranscriptContent, toLines, type TranscriptLine } from './transcript-lines';
import { useTranscript } from './use-transcript';

/** What a tab gives the Copy button: its text, or null when it has nothing to copy. */
export type CopySource = () => Promise<string | null>;
export type CopySourceRef = RefObject<CopySource | null>;

const partClass = {
  star: 'text-ink-muted',
  stamp: 'font-mono text-[0.8125em] text-ink-muted',
  text: '',
} as const;

/** Off-screen lines skip layout and paint, so a multi-megabyte transcript stays responsive (B20). */
const Line = memo(function Line({ line }: { readonly line: TranscriptLine }) {
  return (
    <p
      className={cn(
        '[content-visibility:auto] [contain-intrinsic-size:auto_2rem] min-h-6 pb-1.5 whitespace-pre-wrap break-words ps-3 -ms-3',
        line.starred && 'border-s-2 border-ink ps-[10px]',
      )}
    >
      {line.blank ? (
        <br />
      ) : (
        line.parts.map((part, index) => (
          <span key={index} className={partClass[part.kind]}>
            {part.text}
          </span>
        ))
      )}
    </p>
  );
});

/**
 * Transcript tab (spec 2.6): the stored text, line by line, as written. Stamps are muted and
 * starred lines get a quiet marker, but every character stays in the DOM, so selecting and
 * copying gives back the stored transcript.
 */
export function TranscriptTab({
  meetingId,
  copySourceRef,
}: {
  readonly meetingId: string;
  readonly copySourceRef: CopySourceRef;
}) {
  const t = useT();
  const model = useTranscript(meetingId);
  const displayed = useRef('');
  displayed.current = model.text;

  useEffect(() => {
    // Copy takes what is displayed now, also while a re-transcription replaces it.
    copySourceRef.current = () =>
      Promise.resolve(hasTranscriptContent(displayed.current) ? displayed.current : null);
    return () => {
      copySourceRef.current = null;
    };
  }, [copySourceRef, meetingId]);

  const lines = useMemo(() => toLines(model.text), [model.text]);

  if (model.phase === 'loading') {
    return (
      <div data-testid="TranscriptLoading">
        <SkeletonText lines={8} label={t('Ui_Loading')} />
      </div>
    );
  }
  if (model.phase === 'error') {
    return (
      <Notice tone="warning">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('Ui_SessionPageLoadFailedText')}</span>
          <Button size="sm" onClick={model.retry} data-testid="BtnTranscriptRetry">
            {t('Ui_SessionPageRetryContent')}
          </Button>
        </div>
      </Notice>
    );
  }
  if (!hasTranscriptContent(model.text)) {
    return (
      <div className="flex flex-col items-start gap-3 py-6" data-testid="TranscriptEmpty">
        <p className="text-ui-lg text-ink-muted">{t('TranscriptPage_Empty.Text')}</p>
        <Button
          variant="primary"
          data-testid="BtnTranscriptEmptyRecord"
          onClick={() => {
            void window.vozella.invoke('workspace.dispatch', {
              action: { type: 'navigateTo', tag: 'Recording' },
            });
          }}
        >
          {t('TranscriptPage_EmptyCta.Content')}
        </Button>
      </div>
    );
  }
  return (
    <div
      id="TxtTranscriptContent"
      data-testid="TxtTranscriptContent"
      role="region"
      aria-label={t('SessionPage_TabTranscript.Text')}
      tabIndex={0}
      className="max-h-[calc(100vh-21rem)] min-h-40 overflow-y-auto overflow-x-hidden rounded-control py-1 ps-3 pe-2 text-ui-lg leading-6 text-ink select-text focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {lines.map((line) => (
        <Line key={line.key} line={line} />
      ))}
    </div>
  );
}
