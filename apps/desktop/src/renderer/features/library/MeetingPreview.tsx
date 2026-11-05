import { spokenTranscript } from '@vozella/core';
import type { MeetingRecordDto } from '@vozella/contracts';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, Skeleton, Tabs } from '../../ui';
import { MarkdownView } from '../summaries/MarkdownView';
import { formatMeetingSpan } from './format';
import type { MeetingPreviewState } from './use-meeting-preview';

export type MeetingTab = 'Transcript' | 'Summary';

/** The start of a transcript is enough to recognize a meeting, and stays cheap to lay out. */
const TRANSCRIPT_START_CHARS = 6000;
const READING = 'max-w-[62ch]';

const hasText = (text: string | null): text is string => text !== null && text.trim() !== '';

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

function PreviewFact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <h3 className="text-ui font-medium text-ink">{label}</h3>
      <p className="text-ui text-ink-muted [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

function SummaryContent({ record }: { readonly record: MeetingRecordDto }) {
  const { t } = useI18n();
  return (
    <div className={`flex flex-col gap-5 ${READING}`}>
      {hasText(record.summary) ? <MarkdownView source={record.summary} /> : null}
      {record.actionItems.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-ui font-medium text-ink">{t('SummaryPage_ActionItems.Text')}</h3>
          <ul className="flex list-disc flex-col gap-1 ps-5 text-read text-ink">
            {record.actionItems.map((item, index) => (
              <li key={index}>{item.text}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {hasText(record.notes) ? (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-ui font-medium text-ink">{t('RecordPage_SessionNotes.Header')}</h3>
          <MarkdownView source={record.notes} />
        </section>
      ) : null}
    </div>
  );
}

function TranscriptContent({ transcript }: { readonly transcript: string }) {
  const { t } = useI18n();
  const spoken = useMemo(() => spokenTranscript(transcript), [transcript]);
  const cut = spoken.length > TRANSCRIPT_START_CHARS;
  return (
    <div className={`flex flex-col gap-3 ${READING}`}>
      <p className="text-read whitespace-pre-line text-ink">
        {cut ? spoken.slice(0, TRANSCRIPT_START_CHARS) : spoken}
      </p>
      {cut ? <p className="text-ui text-ink-muted">{t('Ui_LibraryPreviewMore')}</p> : null}
    </div>
  );
}

function PreviewBody({
  record,
  preferredTab,
  onOpen,
}: {
  readonly record: MeetingRecordDto;
  /** The tab a search hit points at; otherwise the summary when there is one. */
  readonly preferredTab: MeetingTab | null;
  readonly onOpen: (tab: MeetingTab) => void;
}) {
  const { t, locale } = useI18n();
  const span = formatMeetingSpan(record.recordedAt, record.endedAt, Date.now(), locale);
  const showsSummary =
    hasText(record.summary) || record.actionItems.length > 0 || hasText(record.notes);
  const showsTranscript =
    hasText(record.transcript) && spokenTranscript(record.transcript).trim() !== '';
  const fallback: MeetingTab = showsSummary ? 'Summary' : 'Transcript';
  const [chosen, setChosen] = useState<MeetingTab | null>(null);
  useEffect(() => {
    setChosen(null);
  }, [record.id, preferredTab]);

  const tab: MeetingTab =
    showsSummary && showsTranscript ? (chosen ?? preferredTab ?? fallback) : fallback;
  const facts: { label: string; value: string }[] = [];
  if (record.attendees.length > 0) {
    facts.push({ label: t('Ui_LibraryPreviewAttendees'), value: record.attendees.join(', ') });
  }
  if (record.audioFilePath !== '') {
    facts.push({ label: t('Settings_Recording.Text'), value: fileName(record.audioFilePath) });
  }

  return (
    <div className="flex flex-col gap-4 px-8 py-6">
      <header className="flex flex-col gap-2">
        <h2 className="line-clamp-3 text-title font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] text-ink">
          {record.title}
        </h2>
        {span ? (
          <p className="text-ui text-ink-muted">
            {span.end === null
              ? t('Ui_LibraryPreviewAt', span.day, span.start)
              : t('Ui_LibraryPreviewSpan', span.day, span.start, span.end)}
          </p>
        ) : null}
      </header>
      <div>
        <Button
          size="sm"
          onClick={() => {
            onOpen(tab);
          }}
        >
          {t('Ui_LibraryOpenMeeting')}
        </Button>
      </div>
      {showsSummary && showsTranscript ? (
        <Tabs
          label={t('Ui_LibraryPreviewTabs')}
          value={tab}
          onValueChange={(value) => {
            setChosen(value === 'Transcript' ? 'Transcript' : 'Summary');
          }}
          tabs={[
            {
              value: 'Summary',
              label: t('SessionPage_TabSummary.Text'),
              content: <SummaryContent record={record} />,
            },
            {
              value: 'Transcript',
              label: t('SessionPage_TabTranscript.Text'),
              content: <TranscriptContent transcript={record.transcript ?? ''} />,
            },
          ]}
        />
      ) : showsSummary ? (
        <SummaryContent record={record} />
      ) : showsTranscript ? (
        <TranscriptContent transcript={record.transcript ?? ''} />
      ) : (
        <p className="text-ui text-ink-muted">{t('History_NoContent')}</p>
      )}
      {facts.length > 0 ? (
        <div className={`flex flex-col gap-3 border-t border-hairline pt-4 ${READING}`}>
          {facts.map((fact) => (
            <PreviewFact key={fact.label} label={fact.label} value={fact.value} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The meeting beside the list, read like a document. It changes nothing and opens on request. */
export function MeetingPreview({
  state,
  preferredTab,
  onOpen,
}: {
  readonly state: MeetingPreviewState;
  readonly preferredTab: MeetingTab | null;
  readonly onOpen: (meetingId: string, tab: MeetingTab) => void;
}) {
  const { t } = useI18n();
  const { record, phase } = state;
  if (phase === 'idle') return null;
  if (phase === 'unreadable') {
    return <p className="px-8 py-6 text-ui text-ink-muted">{t('Ui_LibraryPreviewUnreadable')}</p>;
  }
  if (phase === 'skeleton') {
    return (
      <div role="status" aria-label={t('Ui_Loading')} className="flex flex-col gap-4 px-8 py-6">
        <Skeleton className="h-9 w-3/5" />
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="mt-4 h-3.5 w-full max-w-[62ch]" />
        <Skeleton className="h-3.5 w-full max-w-[62ch]" />
        <Skeleton className="h-3.5 w-4/5 max-w-[62ch]" />
      </div>
    );
  }
  if (!record) return null;
  return (
    // The key puts each meeting back at its top.
    <div key={record.id} className="min-h-0 flex-1 overflow-y-auto">
      <PreviewBody
        record={record}
        preferredTab={preferredTab}
        onOpen={(tab) => {
          onOpen(record.id, tab);
        }}
      />
    </div>
  );
}
