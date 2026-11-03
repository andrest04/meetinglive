import type { XaiAccountViewDto } from '@vozella/contracts';
import { Check, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Icon, IconButton, Input, Progress, Select, SettingRow } from '../../ui';

const TITLE_KEYS = {
  'signed-out': 'Xai_StatusSignedOut',
  'super-grok': 'Xai_StatusSuperGrok',
  'api-key': 'Xai_StatusApiKey',
  error: 'Xai_StatusErrorTitle',
} as const;

/** Grok (xAI): account status, sign in or out, an optional API key, the model and the effort. */
export function XaiAccount({
  view,
  effort,
  effortOptions,
  busy,
  canSignIn,
  onSignIn,
  onSignOut,
  onRetry,
  onSaveKey,
  onModel,
  onEffort,
}: {
  view: XaiAccountViewDto;
  effort: string;
  effortOptions: readonly string[];
  busy: boolean;
  canSignIn: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onRetry: () => void;
  onSaveKey: (key: string) => Promise<boolean>;
  onModel: (id: string) => void;
  onEffort: (value: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const [peek, setPeek] = useState(false);

  const detail = (() => {
    switch (view.detail.kind) {
      case 'signed-out':
        return canSignIn ? t('Xai_StatusSignedOutDetail') : t('Ui_XaiSignedOutApiKeyOnly');
      case 'loading-models':
        return t('Xai_StatusLoadingModels');
      case 'ready':
        return t('Xai_StatusReady', `${view.detail.model} · ${view.detail.effort}`);
      case 'error':
        return view.detail.message;
      case 'none':
        return undefined;
    }
  })();

  return (
    <div className="flex flex-col" aria-busy={busy}>
      {busy ? <Progress value={null} label={t('Ui_Loading')} className="pb-2" /> : null}
      <SettingRow title={t(TITLE_KEYS[view.title])} {...(detail ? { description: detail } : {})}>
        {view.signedIn && view.title !== 'error' ? (
          <Icon icon={Check} className="text-ink-muted" />
        ) : null}
        {view.title === 'error' && view.canRetry ? (
          <Button onClick={onRetry} disabled={busy}>
            {t('Ui_XaiRetry')}
          </Button>
        ) : null}
        {view.signedIn ? (
          <Button onClick={onSignOut} disabled={busy}>
            {t('Settings_XaiSignOut.Content')}
          </Button>
        ) : canSignIn ? (
          <Button variant="primary" onClick={onSignIn} disabled={busy}>
            {t('Settings_XaiSignIn.Content')}
          </Button>
        ) : null}
      </SettingRow>

      <SettingRow
        title={t('Settings_XaiApiKey.Header')}
        description={t('Settings_XaiApiKey.Description')}
      >
        {({ titleId }) => (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.trim() === '') return;
              void onSaveKey(draft).then((saved) => {
                if (saved) setDraft('');
              });
            }}
          >
            <div className="relative">
              <Input
                aria-labelledby={titleId}
                type={peek ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                className="w-60 pe-8"
                placeholder={t('Settings_XaiApiKeyBox.PlaceholderText')}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
              />
              <IconButton
                label={peek ? t('Ui_HideKey') : t('Ui_ShowKey')}
                icon={peek ? EyeOff : Eye}
                size="sm"
                tooltip={false}
                className="absolute end-0.5 top-0.5"
                onClick={() => {
                  setPeek((value) => !value);
                }}
              />
            </div>
            <Button type="submit" disabled={draft.trim() === '' || busy}>
              {t('Settings_XaiSaveApiKey.Content')}
            </Button>
          </form>
        )}
      </SettingRow>

      <SettingRow title={t('Settings_XaiModel.Header')}>
        <Select
          label={t('Settings_XaiModel.Header')}
          value={view.selectedModelId}
          placeholder={t('ComboXaiModel.PlaceholderText')}
          disabled={!view.signedIn}
          options={view.models.map((id) => ({ value: id, label: id }))}
          onValueChange={(id) => {
            if (id !== view.selectedModelId) onModel(id);
          }}
        />
      </SettingRow>

      <SettingRow
        title={t('Settings_XaiEffort.Header')}
        description={t('Settings_XaiEffort.Description')}
      >
        <Select
          label={t('Settings_XaiEffort.Header')}
          value={effort}
          disabled={!view.signedIn}
          options={effortOptions.map((value) => ({ value, label: value }))}
          onValueChange={(value) => {
            if (value !== effort) onEffort(value);
          }}
        />
      </SettingRow>
    </div>
  );
}
