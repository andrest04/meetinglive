import {
  appRestart,
  i18nGetLocale,
  i18nLocaleChanged,
  settingsDetectCli,
  settingsDismissNotice,
  settingsGetPage,
  settingsModelEvent,
  settingsModelsCancel,
  settingsModelsDelete,
  settingsModelsDownload,
  settingsModelsSelect,
  settingsSetCliOption,
  settingsSetMeetingLanguage,
  settingsSetSummaryProvider,
  settingsSetUiLanguage,
  settingsXaiRefresh,
  settingsXaiSaveApiKey,
  settingsXaiSignIn,
  settingsXaiSignOut,
  type ModelEventDto,
} from '@vozella/contracts';
import { type XaiAccountView } from '@vozella/core';
import type { SettingsRuntime } from '@vozella/platform';
import type { LocaleState } from '../i18n/locale-state';
import type { Broadcast } from './library-handlers';
import { registerRequest, type IpcServerDeps } from './ipc-server';

/** What the xAI module supplies for the SuperGrok device code sign in. */
export type XaiSignInResult =
  | { readonly status: 'signed-in' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly message: string };

export interface SettingsHandlerDeps {
  readonly server: IpcServerDeps;
  readonly runtime: SettingsRuntime;
  readonly locale: LocaleState;
  readonly broadcast: Broadcast;
  /** Registered by the xAI module. Without it `settings.xai.signIn` answers `unavailable`. */
  readonly xaiSignIn?: () => Promise<XaiSignInResult>;
}

/** Forwards model download progress to every window. Pass it to `SettingsRuntime` as `notifyModel`. */
export function modelEventBridge(broadcast: Broadcast): (event: ModelEventDto) => void {
  return (event) => {
    broadcast(settingsModelEvent, event);
  };
}

/** Wires the Settings page channels. One line per channel; the rules live in core. */
export function registerSettingsHandlers(deps: SettingsHandlerDeps): void {
  const { server, runtime, locale, broadcast } = deps;

  registerRequest(server, settingsGetPage, () => runtime.page.load());

  registerRequest(server, settingsSetUiLanguage, async ({ tag }) => {
    const result = await runtime.commands.setUiLanguage(tag);
    // Save first, then switch: a save that fails leaves both languages as they were (B11).
    if (result.status === 'saved' && (tag === 'en-US' || tag === 'es')) {
      locale.set(tag);
      broadcast(i18nLocaleChanged, { tag: locale.tag, locale: locale.locale });
    }
    return result;
  });

  registerRequest(server, settingsSetSummaryProvider, ({ kind }) =>
    runtime.commands.setSummaryProvider(kind),
  );
  registerRequest(server, settingsSetCliOption, (input) => runtime.commands.setCliOption(input));
  registerRequest(server, settingsSetMeetingLanguage, ({ kind, code }) =>
    runtime.commands.setMeetingLanguage(kind, code),
  );

  registerRequest(server, settingsDetectCli, async ({ kind }) => ({
    status: await runtime.page.detectCli(kind),
  }));
  registerRequest(server, settingsDismissNotice, ({ id }) => {
    runtime.notices.dismiss(id);
    return { dismissed: true as const };
  });

  registerRequest(server, settingsModelsDownload, ({ fileName }) =>
    runtime.models.download(fileName),
  );
  registerRequest(server, settingsModelsCancel, ({ fileName }) => {
    runtime.models.cancel(fileName);
    return { cancelled: true as const };
  });
  registerRequest(server, settingsModelsSelect, ({ fileName }) => runtime.models.select(fileName));
  registerRequest(server, settingsModelsDelete, ({ fileName }) => runtime.models.delete(fileName));

  registerRequest(server, settingsXaiRefresh, () => runtime.xai.refresh());
  registerRequest(server, settingsXaiSaveApiKey, ({ key }) => runtime.xai.saveApiKey(key));
  registerRequest(server, settingsXaiSignOut, () => runtime.xai.signOut());
  registerRequest(server, settingsXaiSignIn, async () => {
    const signIn = deps.xaiSignIn;
    if (!signIn || !runtime.capabilities.xaiSignIn) return { status: 'unavailable' as const };
    const result = await signIn();
    if (result.status !== 'signed-in') return result;
    const view: XaiAccountView = await runtime.xai.refresh();
    return {
      status: 'signed-in' as const,
      feedback: { key: 'Xai_FeedbackSignedIn' as const, args: [] },
      view,
    };
  });

  registerRequest(server, i18nGetLocale, () => ({
    tag: locale.tag,
    locale: locale.locale,
    saved: locale.saved,
  }));

  registerRequest(server, appRestart, () => runtime.restart.restart());
}
