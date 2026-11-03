import { useI18n } from '../../i18n/I18nProvider';
import { isLocale } from '../../i18n/translate';
import { useTheme, isThemePreference } from '../../app/theme';
import { RadioGroup, SectionHeader, Select, SettingRow } from '../../ui';

/** Appearance and language. The rest of the settings arrive with their modules. */
export function SettingsRoute() {
  const { t, locale, setLocale } = useI18n();
  const { preference, setPreference } = useTheme();

  return (
    <section className="flex flex-col gap-8">
      <SectionHeader level={1} title={t('SettingsPage_Title.Text')} />
      <div>
        <SectionHeader level={2} title={t('Ui_Appearance')} className="pb-2" />
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
        <SettingRow
          title={t('Settings_LanguagePicker.Header')}
          description={t('Settings_LanguagePicker.Description')}
        >
          <Select
            label={t('Settings_LanguagePicker.Header')}
            value={locale}
            onValueChange={(next) => {
              if (isLocale(next)) setLocale(next);
            }}
            options={[
              { value: 'en', label: t('Settings_LanguageEnglish') },
              { value: 'es', label: t('Settings_LanguageSpanish') },
            ]}
          />
        </SettingRow>
      </div>
    </section>
  );
}
