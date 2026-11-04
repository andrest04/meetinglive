import type { FolderDto } from '@vozella/contracts';
import { useMemo, type ChangeEvent, type ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { Field, Input, Select } from '../../ui';
import { buildDestinations, fromOptionValue, toOptionValue } from './destinations';

/**
 * The top of the page: the title, where the take is saved, and whatever the page puts below
 * (sources, the setup panel). The title is editable while a take is processed and locked while it
 * records; the destination is locked while it records (spec 2.2). Before a take the title is the
 * page's heading, as on a blank document; while a take is processed they are two labeled fields.
 */
export function RecordIdle({
  hidden = false,
  asDocument,
  title,
  onTitleChange,
  titleDisabled,
  folders,
  folderId,
  onFolderChange,
  destinationDisabled,
  children,
}: {
  /** A take records: the fields stay mounted (the sources keep their state) but are not drawn. */
  readonly hidden?: boolean;
  /** No take exists: the title reads as the document's heading. */
  readonly asDocument: boolean;
  readonly title: string;
  readonly onTitleChange: (title: string) => void;
  readonly titleDisabled: boolean;
  readonly folders: readonly FolderDto[];
  readonly folderId: string | null;
  readonly onFolderChange: (folderId: string | null) => void;
  readonly destinationDisabled: boolean;
  readonly children?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const inbox = t('Library_Inbox');
  const options = useMemo(
    () =>
      buildDestinations(folders, inbox, locale).map((destination) => ({
        value: toOptionValue(destination.folderId),
        label: destination.path,
      })),
    [folders, inbox, locale],
  );
  const titleLabel = t('RecordPage_MeetingTitle.Header');
  const destinationLabel = t('RecordPage_Destination.Header');
  const onTitleInput = (event: ChangeEvent<HTMLInputElement>): void => {
    onTitleChange(event.target.value);
  };
  const destination = (
    <Select
      label={destinationLabel}
      value={toOptionValue(folderId)}
      options={options}
      disabled={destinationDisabled}
      testId="CmbDestination"
      className={asDocument ? 'w-56 max-w-full min-w-0' : 'w-full'}
      onValueChange={(value) => {
        onFolderChange(fromOptionValue(value));
      }}
    />
  );
  return (
    <div className="flex max-w-[960px] flex-col gap-6" data-testid="record-idle" hidden={hidden}>
      {asDocument ? (
        <div className="flex flex-col gap-2">
          {/* Pulled out by its padding, so the text lines up with the column and the edge does not. */}
          <Input
            appearance="title"
            aria-label={titleLabel}
            className="-mx-2 w-[calc(100%+1rem)]"
            value={title}
            disabled={titleDisabled}
            data-testid="TxtMeetingTitle"
            onChange={onTitleInput}
          />
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-ui text-ink-muted">{destinationLabel}</span>
            {destination}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
          <Field label={titleLabel}>
            <Input
              value={title}
              disabled={titleDisabled}
              data-testid="TxtMeetingTitle"
              onChange={onTitleInput}
            />
          </Field>
          <Field label={destinationLabel}>{destination}</Field>
        </div>
      )}
      {children}
    </div>
  );
}
