import type { SettingsPageDto } from '@vozella/contracts';
import { CLI_STATUS_KEYS } from '@vozella/core';
import { useT } from '../../i18n/I18nProvider';
import { Button, Notice, RadioGroup, SectionHeader, Select, SettingRow } from '../../ui';
import { LocalModels } from './LocalModels';
import { ProviderMark } from './ProviderMark';
import type { SettingsPageModel } from './use-settings-page';
import { XaiAccount } from './XaiAccount';

interface OptionKeys {
  header: 'Settings_ClaudeOptions.Header' | 'Settings_CodexOptions.Header';
  description: 'Settings_ClaudeOptions.Description' | 'Settings_CodexOptions.Description';
  model: 'Settings_ClaudeModel.Header' | 'Settings_CodexModel.Header';
  effort: 'Settings_ClaudeEffort.Header' | 'Settings_CodexEffort.Header';
  effortHelp: 'Settings_ClaudeEffort.Description' | 'Settings_CodexEffort.Description';
}

const CLAUDE_KEYS: OptionKeys = {
  header: 'Settings_ClaudeOptions.Header',
  description: 'Settings_ClaudeOptions.Description',
  model: 'Settings_ClaudeModel.Header',
  effort: 'Settings_ClaudeEffort.Header',
  effortHelp: 'Settings_ClaudeEffort.Description',
};

const CODEX_KEYS: OptionKeys = {
  header: 'Settings_CodexOptions.Header',
  description: 'Settings_CodexOptions.Description',
  model: 'Settings_CodexModel.Header',
  effort: 'Settings_CodexEffort.Header',
  effortHelp: 'Settings_CodexEffort.Description',
};

function CliOptions({
  keys,
  mark,
  options,
  onModel,
  onEffort,
}: {
  keys: OptionKeys;
  mark: 'ClaudeCode' | 'Codex';
  options: SettingsPageDto['claude'];
  onModel: (value: string) => void;
  onEffort: (value: string) => void;
}) {
  const t = useT();
  const items = (list: readonly string[]) => list.map((value) => ({ value, label: value }));
  return (
    <div className="flex flex-col pt-5">
      <SectionHeader
        level={3}
        icon={<ProviderMark kind={mark} />}
        title={t(keys.header)}
        description={t(keys.description)}
      />
      <div className="pt-1">
        <SettingRow title={t(keys.model)}>
          <Select
            label={t(keys.model)}
            value={options.model}
            options={items(options.modelOptions)}
            onValueChange={(value) => {
              if (value !== options.model) onModel(value);
            }}
          />
        </SettingRow>
        <SettingRow title={t(keys.effort)} description={t(keys.effortHelp)}>
          <Select
            label={t(keys.effort)}
            value={options.effort}
            options={items(options.effortOptions)}
            onValueChange={(value) => {
              if (value !== options.effort) onEffort(value);
            }}
          />
        </SettingRow>
      </div>
    </div>
  );
}

/**
 * Where summaries are made, and the options of whichever provider is chosen. The blocks sit below
 * the choice so the choice never moves (spec 2.2 to 2.5). Controls whose module is not present
 * (`capabilities`) are not drawn.
 */
export function ProviderSection({
  page,
  model,
}: {
  page: SettingsPageDto;
  model: SettingsPageModel;
}) {
  const t = useT();
  const { provider, capabilities } = page;

  const label = (text: string, kind: 'ClaudeCode' | 'Codex' | 'Xai' | 'Local') => (
    <span className="inline-flex items-center gap-2">
      <ProviderMark kind={kind} />
      {text}
    </span>
  );

  return (
    <div>
      <SectionHeader
        level={2}
        compact
        title={t('Settings_SummaryProvider.Text')}
        className="pb-2"
      />
      <div className="flex flex-col gap-3 border-b border-hairline py-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-ui-lg font-medium text-ink">
            {t('Settings_SummaryProviderCard.Header')}
          </span>
          <span className="max-w-prose text-ui text-ink-muted">
            {t('Settings_SummaryProviderCard.Description')}
          </span>
        </div>
        <RadioGroup
          label={t('Settings_SummaryProviderCard.Header')}
          value={provider}
          onValueChange={(kind) => {
            void model.setProvider(kind);
          }}
          options={[
            { value: 'Local', label: label(t('Settings_ProviderLocal.Text'), 'Local') },
            { value: 'ClaudeCode', label: label(t('Settings_ProviderClaude.Text'), 'ClaudeCode') },
            { value: 'Codex', label: label(t('Settings_ProviderCodex.Text'), 'Codex') },
            ...(capabilities.xaiAccount || provider === 'Xai'
              ? [{ value: 'Xai' as const, label: label(t('Settings_ProviderXai.Text'), 'Xai') }]
              : []),
          ]}
        />
      </div>

      {page.cliStatus ? (
        <div className="flex items-center gap-3 pt-3 text-ui-lg text-ink-muted">
          <span role="status">
            {t(page.cliStatus === 'detected' ? CLI_STATUS_KEYS.found : CLI_STATUS_KEYS.missing)}
          </span>
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              void model.checkCliAgain();
            }}
          >
            {t('Ui_CliCheckAgain')}
          </Button>
        </div>
      ) : null}

      {provider === 'ClaudeCode' ? (
        <CliOptions
          keys={CLAUDE_KEYS}
          mark="ClaudeCode"
          options={page.claude}
          onModel={(value) => {
            model.setCliOption('claude', 'model', value);
          }}
          onEffort={(value) => {
            model.setCliOption('claude', 'effort', value);
          }}
        />
      ) : null}

      {provider === 'Codex' ? (
        <CliOptions
          keys={CODEX_KEYS}
          mark="Codex"
          options={page.codex}
          onModel={(value) => {
            model.setCliOption('codex', 'model', value);
          }}
          onEffort={(value) => {
            model.setCliOption('codex', 'effort', value);
          }}
        />
      ) : null}

      {provider === 'Local' && capabilities.localModels ? (
        <div className="flex flex-col pt-5">
          <SectionHeader
            level={3}
            title={t('Settings_SummaryModels.Header')}
            description={t('Settings_SummaryModels.Description')}
          />
          <div className="pt-1">
            <LocalModels
              rows={page.models.rows}
              missingActiveId={page.models.missingActiveId}
              progress={model.progress}
              onSelect={model.selectModel}
              onDownload={(fileName) => {
                void model.downloadModel(fileName);
              }}
              onCancel={model.cancelModel}
              onDelete={(fileName) => {
                void model.deleteModel(fileName);
              }}
            />
          </div>
        </div>
      ) : null}

      {provider === 'Xai' && capabilities.xaiAccount ? (
        <div className="flex flex-col pt-5">
          <SectionHeader
            level={3}
            title={t('Settings_XaiAccount.Header')}
            description={
              capabilities.xaiSignIn
                ? t('Settings_XaiAccount.Description')
                : t('Ui_XaiAccountApiKeyOnly')
            }
          />
          <div className="pt-1">
            <XaiAccount
              view={page.xai}
              effort={page.xaiEffort}
              effortOptions={page.xaiEffortOptions}
              busy={model.xaiBusy}
              canSignIn={capabilities.xaiSignIn}
              onSignIn={() => {
                void model.signInXai();
              }}
              onSignOut={() => {
                void model.signOutXai();
              }}
              onRetry={() => {
                void model.refreshXai();
              }}
              onSaveKey={model.saveXaiApiKey}
              onModel={(id) => {
                model.setCliOption('xai', 'model', id);
              }}
              onEffort={(value) => {
                model.setCliOption('xai', 'effort', value);
              }}
            />
          </div>
        </div>
      ) : null}

      {model.feedback ? (
        <Notice className="mt-4" onDismiss={model.clearFeedback} dismissLabel={t('Ui_Close')}>
          {model.feedback}
        </Notice>
      ) : null}
    </div>
  );
}
