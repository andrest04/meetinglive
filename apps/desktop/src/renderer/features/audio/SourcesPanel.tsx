import type { MicrophoneChoiceDto, MicrophoneOptionDto, SourceCardDto } from '@vozella/contracts';
import { AppWindow, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import type { Translate } from '../../i18n/translate';
import { Badge, Button, Field, Icon, Meter, Notice, RadioGroup, Select, Tooltip } from '../../ui';
import type { RadioOption } from '../../ui';
import { sourcesSummaryArgs } from './recording-status';
import { useMicrophonePreview } from './use-microphone-preview';
import { useMicrophones } from './use-microphones';
import { useSourcePicker } from './use-source-picker';

/** What the Record page needs to build the capture request when Record is pressed. */
export interface SourcesSelection {
  /** Null until the microphone list has answered. */
  readonly microphone: MicrophoneChoiceDto | null;
  /** Null means all system audio. */
  readonly processId: number | null;
  readonly appName: string | null;
}

const SYSTEM_VALUE = 'system';

const micValue = (choice: MicrophoneChoiceDto): string =>
  choice.kind === 'Device' ? `device:${choice.deviceId ?? ''}` : choice.kind;

function micChoiceOf(option: MicrophoneOptionDto): MicrophoneChoiceDto {
  return { kind: option.kind, deviceId: option.deviceId };
}

export interface SourcesPanelProps {
  /** True while the page is visible and neither recording nor processing. */
  readonly active: boolean;
  /** A take is running: the choices are shown but cannot change. */
  readonly locked?: boolean;
  readonly onSelectionChange?: (selection: SourcesSelection) => void;
}

/**
 * The Record page "Sources" block (spec 2.1 and 2.4): the microphone, the meeting audio cards,
 * the summary line, and the two bars that offer a change. Main owns the picker and the remembered
 * choices; this container shows the state and sends the user's picks.
 */
export function SourcesPanel({ active, locked = false, onSelectionChange }: SourcesPanelProps) {
  const t = useT();
  const microphones = useMicrophones();
  const picker = useSourcePicker(active);
  const { state } = picker;

  const selectedMic = microphones.selected;
  const micKind = selectedMic?.kind ?? 'SystemDefault';
  const level = useMicrophonePreview(
    selectedMic?.kind === 'Device' ? selectedMic.deviceId : null,
    active && selectedMic !== null && micKind !== 'None',
  );

  const micOptions = useMemo(
    () =>
      microphones.options.map((option) => ({
        value: micValue(micChoiceOf(option)),
        label:
          option.kind === 'None'
            ? t('RecordPage_MicrophoneNone')
            : option.kind === 'SystemDefault'
              ? t('Microphone_SystemDefault')
              : (option.name ?? ''),
        choice: micChoiceOf(option),
      })),
    [microphones.options, t],
  );
  const selectedMicLabel =
    micOptions.find((option) => selectedMic !== null && option.value === micValue(selectedMic))
      ?.label ?? null;

  const selectedProcessId = state?.selectedProcessId ?? null;
  const selectedCard = state?.cards.find(
    (card) => card.processId !== null && card.processId === selectedProcessId,
  );
  const appName = selectedCard?.app?.friendlyName ?? null;

  useEffect(() => {
    onSelectionChange?.({ microphone: selectedMic, processId: selectedProcessId, appName });
  }, [onSelectionChange, selectedMic, selectedProcessId, appName]);

  const summary = t(
    'RecordPage_SourcesSummary',
    ...sourcesSummaryArgs(selectedMicLabel, appName, {
      systemDefault: t('Microphone_SystemDefault'),
      allSystem: t('RecordPage_AllSystemAudio.Text'),
    }),
  );

  const cards = state?.cards ?? [];
  const options: RadioOption[] = cards.map((card) => cardOption(card, t));
  if (options.length === 0) options.push(cardOption(systemCard, t));

  return (
    <section
      aria-labelledby="record-sources-heading"
      className={locked ? 'flex flex-col gap-5 opacity-60' : 'flex flex-col gap-5'}
      data-testid="sources-panel"
      inert={locked}
    >
      <div className="flex flex-col gap-1">
        <h2 id="record-sources-heading" className="text-read-lg font-semibold text-ink">
          {t('RecordPage_SourcesHeading.Text')}
        </h2>
        <p className="text-ui text-ink-muted" data-testid="sources-summary">
          {summary}
        </p>
      </div>

      <Field label={t('ComboRecordMicrophone.Header')}>
        <div className="flex items-center gap-4">
          <Select
            label={t('ComboRecordMicrophone.AutomationProperties.Name')}
            value={selectedMic ? micValue(selectedMic) : null}
            options={micOptions}
            onOpenChange={(open) => {
              if (open) microphones.reload();
            }}
            onValueChange={(value) => {
              const picked = micOptions.find((option) => option.value === value);
              if (picked && (!selectedMic || micValue(selectedMic) !== value)) {
                microphones.choose(picked.choice);
              }
            }}
            className="w-64 max-w-full"
          />
          {locked ? null : (
            <Meter
              value={micKind === 'None' ? 0 : level}
              label={t('RecordPage_MicLevelBar.AutomationProperties.Name')}
              className="w-32"
            />
          )}
        </div>
      </Field>

      <div className="flex flex-col gap-2">
        <h3 className="text-ui font-medium text-ink">{t('RecordPage_MeetingAudioHeading.Text')}</h3>

        {state?.fallbackAppName ? (
          <Notice tone="warning" onDismiss={picker.closeFallback} dismissLabel={t('Ui_Close')}>
            <p className="font-medium">{t('RecordPage_SourceFallback.Title')}</p>
            <p className="text-ui text-ink-muted">
              {t('RecordPage_SourceFallbackMessage', state.fallbackAppName)}
            </p>
          </Notice>
        ) : null}

        {state?.suggestion ? (
          <Notice
            onDismiss={() => {
              if (state.suggestion) picker.dismissSuggestion(state.suggestion.processId);
            }}
            dismissLabel={t('Ui_Close')}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="font-medium">
                {t('RecordPage_SuggestionTitle', state.suggestion.friendlyName)}
              </p>
              <Button
                size="sm"
                onClick={() => {
                  if (state.suggestion) picker.select(state.suggestion.processId);
                }}
              >
                {t('RecordPage_SuggestionAction', state.suggestion.friendlyName)}
              </Button>
            </div>
          </Notice>
        ) : null}

        <RadioGroup
          label={t('ListRecordAudioSource.AutomationProperties.Name')}
          layout="rows"
          value={selectedProcessId === null ? SYSTEM_VALUE : String(selectedProcessId)}
          options={options}
          onValueChange={(value) => {
            picker.select(value === SYSTEM_VALUE ? null : Number(value));
          }}
          className="border-y border-hairline"
        />

        {state?.noAppsPlaying ? (
          <p className="text-ui text-ink-muted">{t('RecordPage_NoAppsPlaying.Text')}</p>
        ) : null}
      </div>
    </section>
  );
}

const systemCard: SourceCardDto = { processId: null, app: null, isAvailable: true, level: 0 };

function cardOption(card: SourceCardDto, tr: Translate): RadioOption {
  if (card.app === null) {
    return {
      value: SYSTEM_VALUE,
      label: (
        <Tooltip content={tr('RecordPage_SystemCardTooltip')} side="top">
          <span className="inline-flex min-h-5 items-center gap-2">
            <Icon icon={Volume2} className="text-ink-muted" />
            {tr('RecordPage_AllSystemAudio.Text')}
          </span>
        </Tooltip>
      ),
    };
  }
  const app = card.app;
  return {
    value: String(card.processId),
    label: (
      <span
        className={
          card.isAvailable
            ? 'inline-flex flex-wrap items-center gap-2'
            : 'inline-flex flex-wrap items-center gap-2 opacity-60'
        }
      >
        <Tooltip content={tr('RecordPage_AppCardTooltip')} side="top">
          <span className="inline-flex min-h-5 items-center gap-2">
            <AppGlyph exePath={app.exePath} />
            {app.friendlyName}
          </span>
        </Tooltip>
        {!card.isAvailable ? (
          <Badge tone="outline">{tr('RecordPage_AppNotPlaying.Text')}</Badge>
        ) : app.isKnownMeetingApp ? (
          <Badge>{tr('RecordPage_AppDetectedTag.Text')}</Badge>
        ) : app.isBrowser ? (
          <Badge tone="outline">{tr('RecordPage_BrowserHint.Text')}</Badge>
        ) : null}
      </span>
    ),
    trailing: (
      <Meter value={card.isAvailable ? card.level : 0} label={app.friendlyName} className="w-24" />
    ),
  };
}

/**
 * The executable's own icon (spec 131). Main reads and caches it; the generic glyph shows while it
 * loads and when the app has none.
 */
function AppGlyph({ exePath }: { readonly exePath: string }) {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    window.vozella.invoke('audio.apps.icon', { exePath }).then(
      (answer) => {
        if (alive) setIcon(answer.dataUrl);
      },
      () => {
        // The glyph stays.
      },
    );
    return () => {
      alive = false;
    };
  }, [exePath]);
  return icon ? (
    <img src={icon} alt="" aria-hidden="true" className="size-4 shrink-0" draggable={false} />
  ) : (
    <Icon icon={AppWindow} className="text-ink-muted" />
  );
}
