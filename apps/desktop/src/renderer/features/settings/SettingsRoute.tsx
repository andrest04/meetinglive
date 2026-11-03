import { SETTINGS_SECTIONS, type SettingsSectionId } from '@vozella/core';
import { Fragment, useRef, type ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { useTheme, isThemePreference } from '../../app/theme';
import { Button, Notice, RadioGroup, SectionHeader, SettingRow, SkeletonText } from '../../ui';
import { MicrophoneSection } from '../audio/MicrophoneSection';
import { CallDetectionSection } from './CallDetectionSection';
import { DataSection } from './DataSection';
import { LanguageSection } from './LanguageSection';
import { MeetingLanguageSection } from './MeetingLanguageSection';
import { ProviderSection } from './ProviderSection';
import { TranscriptionSection } from '../transcription/TranscriptionSection';
import { useSettingsPage } from './use-settings-page';

function AppearanceSection() {
  const t = useT();
  const { preference, setPreference } = useTheme();
  return (
    <div>
      <SectionHeader level={2} compact title={t('Ui_Appearance')} className="pb-2" />
      <SettingRow title={t('Ui_Theme')} description={t('Ui_ThemeDescription')}>
        <RadioGroup
          label={t('Ui_Theme')}
          orientation="horizontal"
          value={preference}
          onValueChange={(next) => {
            if (isThemePreference(next)) setPreference(next);
          }}
          options={[
            { value: 'system', label: t('Ui_ThemeSystem') },
            { value: 'light', label: t('Ui_ThemeLight') },
            { value: 'dark', label: t('Ui_ThemeDark') },
          ]}
        />
      </SettingRow>
    </div>
  );
}

/**
 * The Settings page. The blocks follow `SETTINGS_SECTIONS` (spec 2.0); a block whose module has not
 * landed is not drawn, and nothing stands in for it. Data and About come from library-storage.
 */
export function SettingsRoute() {
  const t = useT();
  const model = useSettingsPage();
  const { page } = model;
  // The fade belongs to the first reveal; a revisit paints the kept snapshot silently (spec 8.5).
  const revealed = useRef(model.page === null).current;
  const built = new Set(
    SETTINGS_SECTIONS.filter((section) => section.status === 'built').map((section) => section.id),
  );

  const renderBlock = (id: SettingsSectionId): ReactNode => {
    if (!page) return null;
    switch (id) {
      case 'language':
        return <LanguageSection current={page.uiLanguage} onChange={model.setUiLanguage} />;
      case 'summaryProvider':
        return <ProviderSection page={page} model={model} />;
      case 'microphone':
        return <MicrophoneSection />;
      case 'meetingLanguage':
        return (
          <MeetingLanguageSection
            transcription={page.transcriptionLanguage}
            summary={page.summaryLanguage}
            onChange={model.setMeetingLanguage}
          />
        );
      case 'transcription':
        return <TranscriptionSection />;
      case 'calendar':
        return <CallDetectionSection />;
      case 'data':
      case 'about':
        // The Data block draws the About rows too.
        return id === 'data' ? <DataSection /> : null;
      default:
        return null;
    }
  };

  return (
    <section className="flex flex-col gap-8" aria-busy={model.loading}>
      <SectionHeader level={1} quiet title={t('SettingsPage_Title.Text')} />

      {model.problem ? (
        <Notice tone="warning" onDismiss={model.clearProblem} dismissLabel={t('Ui_Close')}>
          {model.problem}
        </Notice>
      ) : null}

      {built.has('appearance') ? <AppearanceSection /> : null}

      {page === null && model.loading ? (
        <SkeletonText lines={6} className="py-3" label={t('Ui_SettingsLoading')} />
      ) : null}

      {model.loadError !== null ? (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="warning" className="self-stretch">
            {t('Ui_SettingsLoadFailed', model.loadError)}
          </Notice>
          <Button
            onClick={() => {
              void model.load();
            }}
          >
            {t('Ui_XaiRetry')}
          </Button>
        </div>
      ) : null}

      {page ? (
        <div
          className={`flex flex-col gap-8${revealed ? ' animate-fade-in' : ''}`}
          data-testid="settings-content"
        >
          {page.notices.map((notice) => (
            <Notice
              key={notice.id}
              tone="warning"
              onDismiss={() => {
                model.dismissNotice(notice.id);
              }}
              dismissLabel={t('Ui_Close')}
            >
              {t('Ui_SettingsRecovered', notice.keptAs)}
            </Notice>
          ))}
          {SETTINGS_SECTIONS.map((section) =>
            section.status === 'built' && section.id !== 'appearance' ? (
              <Fragment key={section.id}>{renderBlock(section.id)}</Fragment>
            ) : null,
          )}
        </div>
      ) : null}
    </section>
  );
}
