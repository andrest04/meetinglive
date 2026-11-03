import type { EngineStatusDto } from '@vozella/contracts';
import { INSTALL_STAGE_LABEL_KEYS, LIVE_DROP_WARNING_PERCENT } from '@vozella/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { Badge, Button, Notice, Progress, SectionHeader, SettingRow, Switch } from '../../ui';
import { overallPercent } from './live-lines';
import { useEngineInstall } from './use-engine-install';
import { useEngineStatus } from './use-engine-status';

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Settings, Transcription (spec 2.6): the engine (download, delete, which processor it runs on),
 * the live preview, speaker labels and their model. The language is chosen in the meeting language
 * block above. Everything shown comes from the status the main process keeps.
 */
export function TranscriptionSection() {
  const { t, locale } = useI18n();
  const { status, refresh } = useEngineStatus();
  const install = useEngineInstall();
  const [engineNote, setEngineNote] = useState<string | null>(null);
  const [speakerNote, setSpeakerNote] = useState<string | null>(null);
  const [speakerBusy, setSpeakerBusy] = useState<'download' | 'delete' | null>(null);
  const [speakerPercent, setSpeakerPercent] = useState(0);
  const speakerRunning = useRef(false);
  // The recognizer snapshot only counts while it still matches the current settings.
  const speakerModelMissing =
    status !== null &&
    status.usage?.diarization === 'model-missing' &&
    status.speakerLabelsEnabled &&
    !status.speakerModelInstalled;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const off = window.vozella.on('transcription.installProgress', (progress) => {
      if (alive.current && progress.stage === 'speaker-model' && speakerRunning.current) {
        setSpeakerPercent(Math.round(progress.percent));
      }
    });
    return () => {
      alive.current = false;
      off();
    };
  }, []);

  const { start } = install;
  const downloadEngine = useCallback(async () => {
    setEngineNote(null);
    const outcome = await start();
    if (outcome.status === 'failed') {
      setEngineNote(t('Error_DownloadFailedCaption', outcome.message));
    }
    await refresh();
  }, [start, refresh, t]);

  const deleteEngine = useCallback(async () => {
    setEngineNote(null);
    try {
      const { outcome } = await window.vozella.invoke('transcription.deleteEngine', {});
      if (outcome === 'RuntimeInUse') setEngineNote(t('Error_EngineDeleteInUse'));
      else if (outcome === 'Incomplete') setEngineNote(t('Error_EngineDeleteIncomplete'));
    } catch (error) {
      setEngineNote(t('Error_DownloadFailedCaption', errorText(error)));
    }
    await refresh();
  }, [refresh, t]);

  /** Runs one speaker model action; `action` answers the failure message or null. */
  const runSpeakerAction = useCallback(
    async (action: () => Promise<string | null>, kind: 'download' | 'delete' = 'download') => {
      if (speakerRunning.current) return;
      speakerRunning.current = true;
      setSpeakerBusy(kind);
      setSpeakerPercent(0);
      setSpeakerNote(null);
      let failure: string | null;
      try {
        failure = await action();
      } catch (error) {
        failure = errorText(error);
      }
      speakerRunning.current = false;
      if (alive.current) {
        setSpeakerBusy(null);
        setSpeakerPercent(0);
        setSpeakerNote(
          failure === null
            ? null
            : kind === 'delete'
              ? t('Ui_SpeakerDeleteFailed', failure)
              : `${t('Error_DownloadFailedCaption', failure)} ${t('Ui_SpeakerModelFailed')}`,
        );
      }
      await refresh();
    },
    [refresh, t],
  );

  const setLive = (enabled: boolean): void => {
    void window.vozella
      .invoke('transcription.setLiveEnabled', { enabled })
      .catch(() => undefined)
      .then(refresh);
  };

  const setSpeakerLabels = (enabled: boolean): void => {
    void runSpeakerAction(
      async () => {
        const result = await window.vozella.invoke('transcription.setSpeakerLabels', { enabled });
        return result.status === 'failed' ? result.message : null;
      },
      enabled ? 'download' : 'delete',
    );
  };

  const downloadSpeakerModel = (): void => {
    void runSpeakerAction(async () => {
      const result = await window.vozella.invoke('transcription.downloadSpeakerModel', {});
      return result.status === 'failed' ? result.message : null;
    });
  };

  const deleteSpeakerModel = (): void => {
    void runSpeakerAction(async () => {
      const result = await window.vozella.invoke('transcription.deleteSpeakerModel', {});
      return result.status === 'failed' ? result.message : null;
    }, 'delete');
  };

  const installing = install.phase === 'running';
  const anyEngineFile =
    status !== null && (status.modelInstalled || status.runtimes.cpu || status.runtimes.cuda);

  return (
    <div data-testid="transcription-section">
      <SectionHeader level={2} compact title={t('Settings_Transcription.Text')} className="pb-2" />
      <SettingRow
        title={t('Settings_NemotronCard.Header')}
        description={t('Settings_NemotronCard.Description')}
      >
        {status ? (
          <Badge tone="outline">
            {status.ready ? t('Ui_EngineInstalled') : t('Ui_EngineNotInstalled')}
          </Badge>
        ) : null}
        <Button
          disabled={status === null || status.ready || installing}
          aria-label={`${t('Settings_DownloadEngine.Content')} ${t('Settings_NemotronCard.Header')}`}
          onClick={() => {
            void downloadEngine();
          }}
        >
          {t('Settings_DownloadEngine.Content')}
        </Button>
        <Button
          disabled={!anyEngineFile || installing || speakerBusy !== null}
          aria-label={`${t('Settings_DeleteEngine.Content')} ${t('Settings_NemotronCard.Header')}`}
          onClick={() => {
            void deleteEngine();
          }}
        >
          {t('Settings_DeleteEngine.Content')}
        </Button>
      </SettingRow>

      {installing ? (
        <div className="border-b border-hairline py-3.5" data-testid="engine-progress">
          <Progress
            className="max-w-sm"
            label={
              install.progress
                ? t(INSTALL_STAGE_LABEL_KEYS[install.progress.stage] as StringKey)
                : t('Status_StartingDownload')
            }
            value={install.progress ? overallPercent(install.progress) : null}
            showValue={install.progress !== null}
          />
        </div>
      ) : null}

      {status ? <EngineCaptions status={status} locale={locale} note={engineNote} /> : null}

      <SettingRow
        title={t('Settings_LiveTranscription.Header')}
        description={t('Settings_LiveTranscription.Description')}
      >
        {({ titleId }) => (
          <Switch
            aria-labelledby={titleId}
            label={status?.liveEnabled ? t('Ui_SwitchOn') : t('Ui_SwitchOff')}
            checked={status?.liveEnabled ?? false}
            disabled={status === null}
            onCheckedChange={setLive}
          />
        )}
      </SettingRow>

      <SettingRow
        title={t('Settings_SpeakerLabels.Header')}
        description={t('Settings_SpeakerLabels.Description')}
      >
        {({ titleId }) => (
          <Switch
            aria-labelledby={titleId}
            label={status?.speakerLabelsEnabled ? t('Ui_SwitchOn') : t('Ui_SwitchOff')}
            checked={status?.speakerLabelsEnabled ?? false}
            disabled={status === null || speakerBusy !== null}
            onCheckedChange={setSpeakerLabels}
          />
        )}
      </SettingRow>

      <SettingRow title={t('Ui_SpeakerModel')}>
        {status ? (
          <Badge tone="outline">
            {status.speakerModelInstalled ? t('Ui_EngineInstalled') : t('Ui_EngineNotInstalled')}
          </Badge>
        ) : null}
        <Button
          disabled={status === null || status.speakerModelInstalled || speakerBusy !== null}
          aria-label={`${t('Settings_DownloadSpeakers.Content')} ${t('Ui_SpeakerModel')}`}
          onClick={downloadSpeakerModel}
        >
          {t('Settings_DownloadSpeakers.Content')}
        </Button>
        <Button
          disabled={status === null || !status.speakerModelInstalled || speakerBusy !== null}
          aria-label={`${t('Settings_DeleteSpeakers.Content')} ${t('Ui_SpeakerModel')}`}
          onClick={deleteSpeakerModel}
        >
          {t('Settings_DeleteSpeakers.Content')}
        </Button>
      </SettingRow>
      {speakerBusy !== null || speakerNote || speakerModelMissing ? (
        <div className="flex flex-col gap-2.5 border-b border-hairline py-3">
          {speakerBusy === 'download' ? (
            <Progress
              className="max-w-sm"
              label={t('Status_DownloadingSpeakerModel')}
              value={speakerPercent}
              showValue
            />
          ) : null}
          {speakerNote ? (
            <p className="text-ui-lg text-ink" role="status">
              {speakerNote}
            </p>
          ) : null}
          {speakerModelMissing ? (
            <Notice tone="warning">{t('Ui_SpeakerModelMissing')}</Notice>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Which processor runs the engine, the CUDA fallback reason and the last live session's drops. */
function EngineCaptions({
  status,
  locale,
  note,
}: {
  status: EngineStatusDto;
  locale: string;
  note: string | null;
}) {
  const { t } = useI18n();
  const usage = status.usage;
  const caption = usage
    ? usage.backend === 'cuda'
      ? t('Settings_AccelerationActiveCuda')
      : t('Settings_AccelerationActiveCpu')
    : status.expectedBackend === 'cuda'
      ? t('Settings_AccelerationExpectedCuda')
      : t('Settings_AccelerationExpectedCpu');
  const dropped = status.liveDroppedPercent;
  const droppedText =
    dropped === null
      ? ''
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(dropped);
  const warnDrops = dropped !== null && dropped > LIVE_DROP_WARNING_PERCENT;

  return (
    <div className="flex flex-col gap-2.5 border-b border-hairline py-3">
      <p className="text-ui-lg text-ink-muted" data-testid="acceleration-caption">
        {note ?? caption}
      </p>
      {usage?.fallbackReason ? (
        <Notice tone="warning">
          <span className="block font-medium">{t('Settings_AsrFallback.Title')}</span>
          <span className="block text-ink-muted">
            {t('Settings_AccelerationFallbackMessage', usage.fallbackReason)}
          </span>
        </Notice>
      ) : null}
      {warnDrops ? (
        <Notice tone="warning">
          <span className="block font-medium">{t('Settings_LiveDropsWarning.Title')}</span>
          <span className="block text-ink-muted">
            {t('Settings_LiveDropsWarningMessage', droppedText)}
          </span>
        </Notice>
      ) : dropped !== null ? (
        <p className="text-ui-lg text-ink-muted" data-testid="live-drops-caption">
          {t('Settings_LiveDropsCaption', droppedText)}
        </p>
      ) : null}
    </div>
  );
}
