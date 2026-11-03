import type { ModelRowDto } from '@vozella/contracts';
import { FIT_LABEL_KEYS } from '@vozella/core';
import { CircleAlert, CircleCheck, Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import type { StringKey, Translate } from '../../i18n/translate';
import { Badge, Icon, Notice, RadioGroup, type RadioOption } from '../../ui';
import type { HardwareSummaryDto } from './wizard-state';

type Fit = NonNullable<ModelRowDto['fit']>;

const FIT_ICON = {
  Recommended: CircleCheck,
  MayBeSlow: Clock,
  NotRecommended: CircleAlert,
} as const;

/**
 * Ink-based badge: the icon and the words carry the rating, never a color (item 189). A poor fit
 * gets the full ink border so it stands out without the red that belongs to recording.
 */
function FitBadge({ fit }: { readonly fit: Fit }): ReactNode {
  const t = useT();
  return (
    <Badge
      tone={fit === 'Recommended' ? 'neutral' : 'outline'}
      className={fit === 'NotRecommended' ? 'border-ink text-ink' : 'text-ink'}
    >
      <Icon icon={FIT_ICON[fit]} size={12} />
      {t(FIT_LABEL_KEYS[fit] as StringKey)}
    </Badge>
  );
}

/** "Detected: 16 GB RAM, GPU X (8 GB VRAM)" or the no-GPU line (item 129). */
export function hardwareLine(hardware: HardwareSummaryDto, t: Translate): string {
  return hardware.gpuVramGb !== null && hardware.gpuVramGb > 0
    ? t('Hardware_WithGpu', hardware.totalRamGb, hardware.gpuName ?? '', hardware.gpuVramGb)
    : t('Hardware_NoGpu', hardware.totalRamGb);
}

/** The model list: name, use case, speed and quality line, size and fit (item 130). */
export function ModelPicker({
  hardware,
  rows,
  selected,
  error,
  disabled,
  onSelect,
}: {
  readonly hardware: HardwareSummaryDto | null;
  readonly rows: readonly ModelRowDto[];
  readonly selected: string | null;
  readonly error: string | null;
  readonly disabled: boolean;
  readonly onSelect: (fileName: string) => void;
}): ReactNode {
  const t = useT();
  const options: RadioOption[] = rows.map((row) => ({
    value: row.fileName,
    disabled,
    label: (
      <span className="font-medium">
        {row.downloaded ? t('Model_Downloaded', row.displayName) : row.displayName}
      </span>
    ),
    description: (
      <span className="flex flex-col">
        <span>{t(row.useCaseKey as StringKey)}</span>
        <span>
          {t(
            'Model_SpeedQuality',
            t(row.speedKey as StringKey),
            t(row.qualityKey as StringKey),
            row.fileSizeGb,
          )}
        </span>
      </span>
    ),
    trailing: row.fit ? <FitBadge fit={row.fit} /> : undefined,
  }));

  return (
    <section className="flex flex-col gap-3" aria-labelledby="wizard-model-heading">
      <div className="flex flex-col gap-0.5">
        <h3 id="wizard-model-heading" className="text-ui-lg font-medium text-ink">
          {t('Setup_ChooseModel.Text')}
        </h3>
        <p className="text-ui text-ink-muted">{t('Setup_ChooseModelHint.Text')}</p>
      </div>
      {hardware ? (
        <p className="text-ui text-ink-muted" data-testid="TxtHardware">
          {hardwareLine(hardware, t)}
        </p>
      ) : null}
      {error ? (
        <Notice tone="warning">
          <span data-testid="TxtModelError">{t('Error_DownloadModel', error)}</span>
        </Notice>
      ) : null}
      <div data-testid="ListModelOptions" className="max-h-70 overflow-y-auto">
        <RadioGroup
          label={t('Setup_ChooseModel.Text')}
          layout="rows"
          value={selected ?? ''}
          options={options}
          onValueChange={onSelect}
        />
      </div>
    </section>
  );
}
