import { CircleAlert, Ellipsis, LoaderCircle } from 'lucide-react';
import { Button, Icon, IconButton, Menu, Select, type Option } from '../../ui';
import type { GenerationStatus } from './use-summary-generation';

export interface SummaryActionBarLabels {
  readonly generate: string;
  readonly regenerate: string;
  readonly cancel: string;
  readonly template: string;
  readonly more: string;
  readonly copyActions: string;
}

export interface SummaryActionBarProps {
  readonly labels: SummaryActionBarLabels;
  readonly showBar: boolean;
  readonly canGenerate: boolean;
  readonly canRegenerate: boolean;
  /** The More menu holds only "Copy action items", so it needs a summary to copy from. */
  readonly showMore: boolean;
  readonly generating: boolean;
  readonly templateOptions: readonly Option[];
  readonly templateId: string;
  readonly onTemplateChange: (id: string) => void;
  readonly onGenerate: () => void;
  readonly onRegenerate: () => void;
  readonly onCancel: () => void;
  readonly onCopyActions: () => void;
}

/** The right side of the toolbar. While a run is going every action is off and Cancel shows. */
export function SummaryActionBar(props: SummaryActionBarProps) {
  const { labels, generating } = props;
  if (!props.showBar && !props.showMore) return null;
  return (
    <>
      {props.showBar ? (
        <>
          {generating ? (
            <Button data-testid="BtnCancelSummary" onClick={props.onCancel}>
              {labels.cancel}
            </Button>
          ) : null}
          {props.canGenerate ? (
            <Button
              variant="primary"
              data-testid="BtnGenerateSummary"
              disabled={generating}
              onClick={props.onGenerate}
            >
              {labels.generate}
            </Button>
          ) : null}
          {props.canRegenerate ? (
            <Button
              data-testid="BtnRegenerateSummary"
              disabled={generating}
              onClick={props.onRegenerate}
            >
              {labels.regenerate}
            </Button>
          ) : null}
          <Select
            options={props.templateOptions}
            value={props.templateId}
            onValueChange={props.onTemplateChange}
            label={labels.template}
            disabled={generating}
            className="min-w-36"
          />
        </>
      ) : null}
      {props.showMore ? (
        <Menu
          align="end"
          entries={[
            {
              id: 'copy-actions',
              label: labels.copyActions,
              disabled: generating,
              onSelect: props.onCopyActions,
            },
          ]}
          trigger={<IconButton label={labels.more} icon={Ellipsis} data-testid="BtnMoreSummary" />}
        />
      ) : null}
    </>
  );
}

/**
 * One quiet line under the toolbar: a busy glyph while a run is going, then what happened. It
 * is a polite live region that stays in the page, so a screen reader hears each change. The full text
 * is in the tooltip when it is cut short.
 */
export function SummaryStatusLine({
  status,
  busy,
}: {
  readonly status: GenerationStatus | null;
  readonly busy: boolean;
}) {
  return (
    <div aria-live="polite" data-testid="TxtSummaryStatus" className="empty:hidden">
      {status ? (
        <div className="flex min-w-0 items-center gap-2 text-ui-lg text-ink-muted">
          {busy ? (
            <Icon
              icon={LoaderCircle}
              size={14}
              className="shrink-0 animate-spin motion-reduce:animate-none"
            />
          ) : status.tone === 'error' ? (
            <Icon icon={CircleAlert} size={14} className="shrink-0 text-ink" />
          ) : null}
          <span title={status.text} className="min-w-0 truncate">
            {status.text}
          </span>
        </div>
      ) : null}
    </div>
  );
}
