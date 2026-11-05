import type { EngineStatusDto } from '@vozella/contracts';
import { INSTALL_STAGE_LABEL_KEYS, LIVE_DROP_WARNING_PERCENT } from '@vozella/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { StringKey, Translate } from '../../i18n/translate';
import { Badge, Button, Notice, Progress, SectionHeader, SettingRow, Switch } from '../../ui';
import { ConfirmDialog } from '../library/dialogs';
import { overallPercent } from './live-lines';
import { useEngineInstall } from './use-engine-install';
import { useEngineStatus } from './use-engine-status';

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Settings, Transcription (spec 2.6): the engine (download, delete, which processor it runs on),
 * the live preview, and speaker labels with their model in one row. Labels are plain words; model
 * names stay in descriptions and in the buttons' accessible names. The language is chosen in the meeting language
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
  // Deletes ask first; the outcome is spoken through one polite live region.
  const [confirming, setConfirming] = useState<'engine' | 'speaker' | null>(null);
  const [announcement, setAnnouncement] = useState('');
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
      else if (alive.current) setAnnouncement(t('Ui_EngineDeleted'));
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
      if (result.status === 'failed') return result.message;
      if (alive.current) setAnnouncement(t('Ui_SpeakerDeleted'));
      return null;
    }, 'delete');
  };

  const ask = (what: 'engine' | 'speaker'): void => {
    setAnnouncement('');
    setConfirming(what);
  };

  const installing = install.phase === 'running';
  // Live captions need the engine: without it the switch says why instead of showing On.
  const liveUnavailable = status !== null && !status.ready;
  const liveOn = !liveUnavailable && (status?.liveEnabled ?? false);
  const anyEngineFile =
    status !== null && (status.modelInstalled || status.runtimes.cpu || status.runtimes.cuda);

  return (
    <div data-testid="transcription-section">
      <SectionHeader level={2} compact title={t('Settings_Transcription.Text')} className="pb-2" />
      <SettingRow
        title={t('Ui_EngineTitle')}
        description={
          <>
            <span className="block">{t('Ui_EngineDescription')}</span>
            {status ? (
              <span className="block pt-1" data-testid="acceleration-caption">
                {engineNote ?? backendCaption(status, t)}
              </span>
            ) : null}
          </>
        }
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
          variant="quiet"
          disabled={!anyEngineFile || installing || speakerBusy !== null}
          aria-label={`${t('Settings_DeleteEngine.Content')} ${t('Settings_NemotronCard.Header')}`}
          onClick={() => {
            ask('engine');
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

      {status ? <EngineNotices status={status} locale={locale} /> : null}

      <SettingRow
        title={t('Settings_LiveTranscription.Header')}
        description={
          liveUnavailable ? t('Ui_LiveNeedsEngine') : t('Ui_LiveTranscriptionDescription')
        }
      >
        {({ titleId }) => (
          <Switch
            aria-labelledby={titleId}
            label={liveOn ? t('Ui_SwitchOn') : t('Ui_SwitchOff')}
            checked={liveOn}
            disabled={status === null || liveUnavailable}
            onCheckedChange={setLive}
          />
        )}
      </SettingRow>

      {/* One row: the switch and the model it needs (download and delete). */}
      <SettingRow
        title={t('Settings_SpeakerLabels.Header')}
        description={t('Ui_SpeakerLabelsDescription')}
      >
        {({ titleId }) => (
          <>
            <Button
              disabled={status === null || status.speakerModelInstalled || speakerBusy !== null}
              aria-label={`${t('Settings_DownloadSpeakers.Content')} ${t('Ui_SpeakerModel')}`}
              onClick={downloadSpeakerModel}
            >
              {t('Settings_DownloadSpeakers.Content')}
            </Button>
            <Button
              variant="quiet"
              disabled={status === null || !status.speakerModelInstalled || speakerBusy !== null}
              aria-label={`${t('Settings_DeleteSpeakers.Content')} ${t('Ui_SpeakerModel')}`}
              onClick={() => {
                ask('speaker');
              }}
            >
              {t('Settings_DeleteSpeakers.Content')}
            </Button>
            <Switch
              aria-labelledby={titleId}
              className="pl-2"
              label={status?.speakerLabelsEnabled ? t('Ui_SwitchOn') : t('Ui_SwitchOff')}
              checked={status?.speakerLabelsEnabled ?? false}
              disabled={status === null || speakerBusy !== null}
              onCheckedChange={setSpeakerLabels}
            />
          </>
        )}
      </SettingRow>
      {speakerBusy !== null || speakerNote || speakerModelMissing ? (
        <div className="flex flex-col gap-2.5 border-b border-hairline py-3">
          {speakerBusy === 'download' ? (
            <Progress
              className="max-w-sm"
              label={t('Ui_SpeakerDownloading')}
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
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={t(confirming === 'speaker' ? 'Ui_SpeakerDeleteTitle' : 'Ui_EngineDeleteTitle')}
        description={t(
          confirming === 'speaker' ? 'Ui_SpeakerDeleteContent' : 'Ui_EngineDeleteContent',
        )}
        cancelLabel={t('HistoryDelete_Cancel')}
        closeLabel={t('Ui_Close')}
        primaryLabel={t(
          confirming === 'speaker'
            ? 'Settings_DeleteSpeakers.Content'
            : 'Settings_DeleteEngine.Content',
        )}
        onConfirm={() => {
          if (confirming === 'speaker') deleteSpeakerModel();
          else if (confirming === 'engine') void deleteEngine();
        }}
      />
    </div>
  );
}

/** Which processor runs the engine, or will. Shown under the engine description. */
function backendCaption(status: EngineStatusDto, t: Translate): string {
  const usage = status.usage;
  if (usage) {
    return usage.backend === 'cuda'
      ? t('Ui_AccelerationActiveGpu')
      : t('Settings_AccelerationActiveCpu');
  }
  return status.expectedBackend === 'cuda'
    ? t('Ui_AccelerationExpectedGpu')
    : t('Settings_AccelerationExpectedCpu');
}

/** The GPU fallback reason and the last live session's drops, when there is something to say. */
function EngineNotices({ status, locale }: { status: EngineStatusDto; locale: string }) {
  const { t } = useI18n();
  const usage = status.usage;
  const dropped = status.liveDroppedPercent;
  if (!usage?.fallbackReason && dropped === null) return null;
  const droppedText =
    dropped === null
      ? ''
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(dropped);
  const warnDrops = dropped !== null && dropped > LIVE_DROP_WARNING_PERCENT;

  return (
    <div className="flex flex-col gap-2.5 border-b border-hairline py-3">
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
