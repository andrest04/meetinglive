import type { ReactNode } from 'react';
import { Button, Notice, Skeleton, SkeletonText, Textarea } from '../../ui';
import { ActionItemsList } from './ActionItemsList';
import { MarkdownView } from './MarkdownView';
import { ModeSwitch } from './ModeSwitch';
import { RelatedMeetings, type RelatedMeetingView } from './RelatedMeetings';
import type { ActionItemDto, NotesMode } from './summary-tab-model';

export interface SummaryTabLabels {
  readonly modeBar: string;
  readonly myNotes: string;
  readonly enhanced: string;
  readonly notesHeader: string;
  readonly notesPlaceholder: string;
  readonly empty: string;
  readonly emptyCta: string;
  readonly actionItems: string;
  readonly related: string;
  readonly loading: string;
  readonly dismiss: string;
}

export interface SummaryTabViewProps {
  readonly labels: SummaryTabLabels;
  readonly loading: boolean;
  /** A message the page could not load, shown in place of the content. */
  readonly loadError: string | null;
  readonly hasMeeting: boolean;
  readonly mode: NotesMode;
  readonly onModeChange: (mode: NotesMode) => void;
  readonly notes: string;
  readonly onNotesChange: (text: string) => void;
  readonly onNotesBlur: () => void;
  readonly summary: string;
  readonly hasSummary: boolean;
  /** No summary and nothing to generate it from. */
  readonly isEmpty: boolean;
  readonly actionItems: readonly ActionItemDto[];
  readonly onToggleAction: (index: number, done: boolean) => void;
  readonly related: readonly RelatedMeetingView[];
  readonly onOpenRelated: (id: string) => void;
  readonly onRecord: () => void;
  /** A short message under the toolbar (a failed save). */
  readonly status: string | null;
  readonly onDismissStatus: () => void;
  /** The right side of the toolbar: generate, template and more arrive here. */
  readonly toolbarEnd?: ReactNode;
}

/** The layout of spec 2.2: toolbar, related meetings, a message, then the content. */
export function SummaryTabView(props: SummaryTabViewProps) {
  const { labels, mode } = props;
  if (props.loading) return <LoadingLayout label={labels.loading} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-8 items-center justify-between gap-3">
        {props.hasMeeting ? (
          <ModeSwitch
            value={mode}
            onChange={props.onModeChange}
            label={labels.modeBar}
            labels={{ notes: labels.myNotes, enhanced: labels.enhanced }}
          />
        ) : (
          <span />
        )}
        {props.toolbarEnd ? (
          <div className="flex min-w-0 items-center gap-2">{props.toolbarEnd}</div>
        ) : null}
      </div>
      <RelatedMeetings
        items={props.related}
        caption={labels.related}
        onOpen={props.onOpenRelated}
      />
      {props.status ? (
        <Notice tone="warning" onDismiss={props.onDismissStatus} dismissLabel={labels.dismiss}>
          {props.status}
        </Notice>
      ) : null}
      {props.loadError ? (
        <Notice tone="warning">{props.loadError}</Notice>
      ) : mode === 'notes' ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="summary-notes" className="text-ui font-medium text-ink-muted">
            {labels.notesHeader}
          </label>
          <Textarea
            id="summary-notes"
            data-testid="TxtMeetingNotes"
            rows={16}
            value={props.notes}
            placeholder={labels.notesPlaceholder}
            onChange={(event) => {
              props.onNotesChange(event.currentTarget.value);
            }}
            onBlur={props.onNotesBlur}
            className="min-h-72"
          />
        </div>
      ) : props.isEmpty ? (
        <div className="flex flex-col items-start gap-3 py-6">
          <p className="max-w-[44ch] text-read text-ink-muted">{labels.empty}</p>
          <Button variant="primary" onClick={props.onRecord}>
            {labels.emptyCta}
          </Button>
        </div>
      ) : props.hasSummary ? (
        <article className="pb-6">
          <MarkdownView source={props.summary} testId="TxtSummaryContent" />
          <ActionItemsList
            items={props.actionItems}
            heading={labels.actionItems}
            onToggle={props.onToggleAction}
          />
        </article>
      ) : null}
    </div>
  );
}

/** The real layout, drawn quiet: the mode bar, a heading, and lines of text. */
function LoadingLayout({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="flex flex-col gap-5">
      <Skeleton className="h-8 w-40" />
      <div className="flex flex-col gap-6 pt-2">
        <Skeleton className="h-5 w-48" />
        <SkeletonText lines={3} />
        <Skeleton className="h-5 w-36" />
        <SkeletonText lines={4} />
      </div>
    </div>
  );
}
