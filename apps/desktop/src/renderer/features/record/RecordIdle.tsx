import type { FolderDto } from '@vozella/contracts';
import { useMemo, type ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { Field, Input, Select } from '../../ui';
import { buildDestinations, fromOptionValue, toOptionValue } from './destinations';

/**
 * The top of the page: the title, where the take is saved, and whatever the page puts below
 * (sources, the hero or the setup panel, the status). The title is editable while a take is
 * processed and locked while it records; the destination is locked while it records (spec 2.2).
 */
export function RecordIdle({
  hidden = false,
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
  return (
    <div className="flex max-w-[960px] flex-col gap-6" data-testid="record-idle" hidden={hidden}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
        <Field label={t('RecordPage_MeetingTitle.Header')}>
          <Input
            value={title}
            disabled={titleDisabled}
            data-testid="TxtMeetingTitle"
            onChange={(event) => {
              onTitleChange(event.target.value);
            }}
          />
        </Field>
        <Field label={t('RecordPage_Destination.Header')}>
          <Select
            label={t('RecordPage_Destination.Header')}
            value={toOptionValue(folderId)}
            options={options}
            disabled={destinationDisabled}
            testId="CmbDestination"
            className="w-full"
            onValueChange={(value) => {
              onFolderChange(fromOptionValue(value));
            }}
          />
        </Field>
      </div>
      {children}
    </div>
  );
}
