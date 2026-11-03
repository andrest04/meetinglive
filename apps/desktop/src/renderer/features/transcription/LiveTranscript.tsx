import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { cn } from '../../ui';
import { liveLines } from './live-lines';

/**
 * The live transcript pane on the Record page (spec 2.3): committed lines in ink, the interim
 * suffix quieter because the engine may still rewrite it. Text arrives from the main process; the
 * pane follows the bottom unless the reader has scrolled up. Captions are not announced: a screen
 * reader would repeat every rewrite.
 */
export function LiveTranscript({ loading }: { loading: boolean }) {
  const t = useT();
  const [text, setText] = useState({ displayText: '', committedText: '' });
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(
    () =>
      window.vozella.on('transcription.liveUpdate', (update) => {
        setText(update);
      }),
    [],
  );

  const lines = useMemo(() => liveLines(text.displayText, text.committedText), [text]);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="flex flex-col gap-2">
      <h2 id="live-transcript-title" className="text-ui-lg font-semibold text-ink">
        {t('RecordPage_LiveTranscript.Text')}
      </h2>
      <div
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-labelledby="live-transcript-title"
        data-testid="live-transcript"
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className={cn(
          'max-h-64 min-h-24 overflow-y-auto rounded-control border border-hairline px-3 py-2.5',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
        )}
      >
        {lines.length === 0 ? (
          <p className="text-read text-ink-muted">
            {loading ? t('Status_LoadingModel') : t('Ui_LiveWaiting')}
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {lines.map((line, index) =>
              line.kind === 'header' ? (
                <li key={index} className="font-mono text-ui text-ink-faint">
                  {line.text}
                </li>
              ) : (
                <li
                  key={index}
                  className={cn(
                    'grid grid-cols-[4.75rem_1fr] gap-x-3 text-read',
                    line.kind === 'interim' ? 'text-ink-muted' : 'text-ink',
                  )}
                >
                  <span className="pt-0.5 font-mono text-ui text-ink-faint">
                    {line.start ?? ''}
                  </span>
                  <span>
                    {line.speaker === null ? null : (
                      <span className="me-2 font-mono text-ui text-ink-muted">
                        {`S${line.speaker}`}
                      </span>
                    )}
                    {line.text}
                  </span>
                </li>
              ),
            )}
          </ol>
        )}
      </div>
      <p className="text-ui text-ink-faint">{t('RecordPage_LiveTranscriptHint.Text')}</p>
    </div>
  );
}
