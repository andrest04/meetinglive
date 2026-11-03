import type { ModelRowDto } from '@vozella/contracts';
import { FIT_LABEL_KEYS } from '@vozella/core';
import { useI18n } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { Badge, Button, Progress, RadioGroup, type RadioOption } from '../../ui';

/**
 * The local summary models, in catalog order: which one is active, and download, cancel and delete
 * (spec 2.4). A model can be chosen only once its file is on this PC. Deleting asks nothing, as in
 * the WinUI page; a running download can be cancelled.
 */
export function LocalModels({
  rows,
  missingActiveId,
  progress,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
}: {
  rows: readonly ModelRowDto[];
  missingActiveId: string | null;
  progress: Readonly<Record<string, number>>;
  onSelect: (fileName: string) => void;
  onDownload: (fileName: string) => void;
  onCancel: (fileName: string) => void;
  onDelete: (fileName: string) => void;
}) {
  const { t } = useI18n();
  const active = rows.find((row) => row.active)?.fileName ?? '';

  const options: RadioOption[] = rows.map((row) => {
    const percent = row.downloading ? (progress[row.fileName] ?? row.percent ?? 0) : null;
    const speedQuality = t(
      'Model_SpeedQuality',
      t(row.speedKey as StringKey),
      t(row.qualityKey as StringKey),
      row.fileSizeGb,
    );
    return {
      value: row.fileName,
      disabled: !row.downloaded,
      label: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{row.displayName}</span>
          {row.fit ? <Badge tone="outline">{t(FIT_LABEL_KEYS[row.fit] as StringKey)}</Badge> : null}
          {row.active ? <Badge tone="neutral">{t('Settings_Active.Content')}</Badge> : null}
        </span>
      ),
      description: (
        <span className="flex flex-col gap-1.5">
          <span>{speedQuality}</span>
          {percent !== null ? (
            <Progress
              className="w-56"
              label={t('Ui_ModelDownloading')}
              value={Math.round(percent)}
              showValue
            />
          ) : null}
        </span>
      ),
      trailing: row.downloading ? (
        <Button
          onClick={() => {
            onCancel(row.fileName);
          }}
        >
          {t('Ui_ModelCancelDownload')}
        </Button>
      ) : row.downloaded ? (
        <Button
          onClick={() => {
            onDelete(row.fileName);
          }}
        >
          {t('Settings_Delete.Content')}
        </Button>
      ) : (
        <Button
          onClick={() => {
            onDownload(row.fileName);
          }}
        >
          {t('Settings_Download.Content')}
        </Button>
      ),
    };
  });

  return (
    <div className="flex flex-col">
      {missingActiveId ? (
        <p className="pb-2 text-ui-lg text-ink-muted">{t('Ui_ModelMissing', missingActiveId)}</p>
      ) : null}
      <RadioGroup
        label={t('Settings_SummaryModels.Header')}
        layout="rows"
        value={active}
        options={options}
        onValueChange={(fileName) => {
          if (fileName !== active) onSelect(fileName);
        }}
      />
    </div>
  );
}
