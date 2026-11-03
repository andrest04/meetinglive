import { SUMMARY_LANGUAGES, TRANSCRIPTION_LANGUAGES } from '@vozella/core';
import { useT } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { SectionHeader, Select, SettingRow } from '../../ui';

/** Transcription language and summary language: two single-field settings (spec 2.6). */
export function MeetingLanguageSection({
  transcription,
  summary,
  onChange,
}: {
  transcription: string;
  summary: string;
  onChange: (kind: 'transcription' | 'summary', code: string) => void;
}) {
  const t = useT();
  const options = (list: typeof TRANSCRIPTION_LANGUAGES) =>
    list.map((entry) => ({ value: entry.code, label: t(entry.labelKey as StringKey) }));
  return (
    <div>
      <SectionHeader
        level={2}
        compact
        title={t('Settings_MeetingLanguage.Text')}
        className="pb-2"
      />
      <SettingRow
        title={t('Settings_TranscriptionLanguage.Header')}
        description={t('Settings_TranscriptionLanguage.Description')}
      >
        <Select
          label={t('Settings_TranscriptionLanguage.Header')}
          value={transcription}
          options={options(TRANSCRIPTION_LANGUAGES)}
          onValueChange={(code) => {
            if (code !== transcription) onChange('transcription', code);
          }}
        />
      </SettingRow>
      <SettingRow
        title={t('Settings_SummaryLanguage.Header')}
        description={t('Settings_SummaryLanguage.Description')}
      >
        <Select
          label={t('Settings_SummaryLanguage.Header')}
          value={summary}
          options={options(SUMMARY_LANGUAGES)}
          onValueChange={(code) => {
            if (code !== summary) onChange('summary', code);
          }}
        />
      </SettingRow>
    </div>
  );
}
