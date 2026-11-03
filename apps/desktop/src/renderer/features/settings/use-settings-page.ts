import type {
  CommitOutcomeDto,
  FeedbackDto,
  ModelEventDto,
  SettingsPageDto,
  XaiAccountViewDto,
} from '@vozella/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';

/** How long the saved-feedback bar stays (spec 2.5: one non-repeating 4 second timer). */
export const FEEDBACK_MS = 4000;

type CliProvider = 'claude' | 'codex' | 'xai';

export interface SettingsPageModel {
  /** Null until the first answer. */
  readonly page: SettingsPageDto | null;
  readonly loading: boolean;
  /** Why the page could not load, or null. */
  readonly loadError: string | null;
  /** The last thing that went wrong with an action, already in words. */
  readonly problem: string | null;
  readonly clearProblem: () => void;
  readonly feedback: string | null;
  readonly clearFeedback: () => void;
  /** Percent by model file while a download runs. */
  readonly progress: Readonly<Record<string, number>>;
  readonly xaiBusy: boolean;
  readonly load: () => Promise<void>;
  /** True when the language was saved (and a restart can be offered). */
  readonly setUiLanguage: (tag: string) => Promise<boolean>;
  readonly setProvider: (kind: string) => Promise<void>;
  readonly setCliOption: (provider: CliProvider, field: 'model' | 'effort', value: string) => void;
  readonly setMeetingLanguage: (kind: 'transcription' | 'summary', code: string) => void;
  readonly checkCliAgain: () => Promise<void>;
  readonly downloadModel: (fileName: string) => Promise<void>;
  readonly cancelModel: (fileName: string) => void;
  readonly selectModel: (fileName: string) => void;
  readonly deleteModel: (fileName: string) => Promise<void>;
  readonly dismissNotice: (id: string) => void;
  readonly refreshXai: () => Promise<void>;
  readonly saveXaiApiKey: (key: string) => Promise<boolean>;
  readonly signOutXai: () => Promise<void>;
  readonly signInXai: () => Promise<void>;
}

/**
 * The last snapshot, kept so a revisit paints it at once and refreshes without the skeleton
 * (spec 8.4). Only the first visit shows the loading state.
 */
let lastPage: SettingsPageDto | null = null;

/** Forgets the kept snapshot (tests, and a data folder change). */
export function resetSettingsPageCache(): void {
  lastPage = null;
}

const without = (map: Readonly<Record<string, number>>, key: string): Record<string, number> =>
  Object.fromEntries(Object.entries(map).filter(([name]) => name !== key));

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The Settings page's state: one snapshot from `settings.getPage`, the checked commands that change
 * it, and the few things that arrive on their own (download progress). Every command ends by
 * reading the snapshot again, so a control that was refused or failed goes back to what is saved.
 */
export function useSettingsPage(): SettingsPageModel {
  const t = useT();
  const [page, setPage] = useState<SettingsPageDto | null>(lastPage);
  const [loading, setLoading] = useState(lastPage === null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [xaiBusy, setXaiBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const clearFeedback = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setFeedback(null);
  }, []);

  const showFeedback = useCallback(
    (item: { key: FeedbackDto['key'] | 'Xai_FeedbackSignedIn'; args: readonly string[] }) => {
      const text = tRef.current(item.key, ...item.args);
      if (timer.current) clearTimeout(timer.current);
      setFeedback(text);
      timer.current = setTimeout(() => {
        timer.current = null;
        setFeedback(null);
      }, FEEDBACK_MS);
    },
    [],
  );

  // Overlapping loads: only the newest request may apply its answer (spec 7.17).
  const loadSeq = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    loadSeq.current += 1;
    const mine = loadSeq.current;
    try {
      const next = await window.vozella.invoke('settings.getPage', {});
      if (!alive.current || mine !== loadSeq.current) return;
      lastPage = next;
      setPage(next);
      setLoadError(null);
    } catch (error) {
      if (alive.current && mine === loadSeq.current) setLoadError(messageOf(error));
    } finally {
      if (alive.current && mine === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A new data folder holds other settings: drop the kept snapshot and read again behind the
  // skeleton, so nothing from the previous folder can be acted on (spec 8.4).
  useEffect(() => {
    return window.vozella.on('library.changed', (event) => {
      if (event.reason !== 'location') return;
      lastPage = null;
      setPage(null);
      setLoading(true);
      void load();
    });
  }, [load]);

  const fail = useCallback((message: string) => {
    if (alive.current) setProblem(tRef.current('Ui_SettingsSaveFailed', message));
  }, []);

  /** Runs a checked command, shows what it says, and puts every control back to what is saved. */
  const commit = useCallback(
    async (request: Promise<CommitOutcomeDto>): Promise<CommitOutcomeDto | null> => {
      try {
        const outcome = await request;
        if (!alive.current) return outcome;
        if (outcome.status === 'saved') {
          setProblem(null);
          if (outcome.feedback) showFeedback(outcome.feedback);
        } else if (outcome.status === 'failed') {
          fail(outcome.message);
        }
        await load();
        return outcome;
      } catch (error) {
        fail(messageOf(error));
        await load();
        return null;
      }
    },
    [fail, load, showFeedback],
  );

  const setXaiView = useCallback((view: XaiAccountViewDto) => {
    setPage((current) => (current ? { ...current, xai: view } : current));
  }, []);

  const refreshXai = useCallback(async (): Promise<void> => {
    setXaiBusy(true);
    try {
      setXaiView(await window.vozella.invoke('settings.xai.refresh', {}));
    } catch (error) {
      fail(messageOf(error));
    } finally {
      if (alive.current) setXaiBusy(false);
    }
  }, [fail, setXaiView]);

  const setProvider = useCallback(
    async (kind: string): Promise<void> => {
      const outcome = await commit(window.vozella.invoke('settings.setSummaryProvider', { kind }));
      if (outcome?.status === 'saved' && kind === 'Xai') await refreshXai();
    },
    [commit, refreshXai],
  );

  // The first load may already have Grok selected: the network phase follows the local one.
  const firstXaiRefresh = useRef(false);
  useEffect(() => {
    if (firstXaiRefresh.current || !page) return;
    firstXaiRefresh.current = true;
    if (page.provider === 'Xai' && page.capabilities.xaiAccount && page.xai.signedIn) {
      void refreshXai();
    }
  }, [page, refreshXai]);

  const setUiLanguage = useCallback(
    async (tag: string): Promise<boolean> => {
      const outcome = await commit(window.vozella.invoke('settings.setUiLanguage', { tag }));
      return outcome?.status === 'saved';
    },
    [commit],
  );

  const setCliOption = useCallback(
    (provider: CliProvider, field: 'model' | 'effort', value: string) => {
      void commit(window.vozella.invoke('settings.setCliOption', { provider, field, value }));
    },
    [commit],
  );

  const setMeetingLanguage = useCallback(
    (kind: 'transcription' | 'summary', code: string) => {
      void commit(window.vozella.invoke('settings.setMeetingLanguage', { kind, code }));
    },
    [commit],
  );

  const checkCliAgain = useCallback(async (): Promise<void> => {
    if (!page) return;
    try {
      const result = await window.vozella.invoke('settings.detectCli', { kind: page.provider });
      if (alive.current)
        setPage((current) => (current ? { ...current, cliStatus: result.status } : current));
    } catch (error) {
      fail(messageOf(error));
    }
  }, [fail, page]);

  // ------------------------------------------------------------ local models

  const nameOf = useCallback(
    (fileName: string): string =>
      page?.models.rows.find((row) => row.fileName === fileName)?.displayName ?? fileName,
    [page],
  );

  useEffect(() => {
    return window.vozella.on('settings.modelEvent', (event: ModelEventDto) => {
      if (event.type === 'progress') {
        setProgress((current) => ({ ...current, [event.fileName]: event.percent }));
        return;
      }
      setProgress((current) => {
        return without(current, event.fileName);
      });
      void load();
    });
  }, [load]);

  const downloadModel = useCallback(
    async (fileName: string): Promise<void> => {
      setProblem(null);
      setProgress((current) => ({ ...current, [fileName]: 0 }));
      // Show the row as downloading right away; the event stream carries the percent.
      setPage((current) =>
        current
          ? {
              ...current,
              models: {
                ...current.models,
                rows: current.models.rows.map((row) =>
                  row.fileName === fileName ? { ...row, downloading: true, percent: 0 } : row,
                ),
              },
            }
          : current,
      );
      try {
        const result = await window.vozella.invoke('settings.models.download', { fileName });
        if (result.status === 'failed' && alive.current) {
          setProblem(tRef.current('Ui_ModelDownloadFailed', nameOf(fileName), result.message));
        }
      } catch (error) {
        if (alive.current)
          setProblem(tRef.current('Ui_ModelDownloadFailed', nameOf(fileName), messageOf(error)));
      } finally {
        if (alive.current) {
          setProgress((current) => {
            return without(current, fileName);
          });
          await load();
        }
      }
    },
    [load, nameOf],
  );

  const cancelModel = useCallback((fileName: string) => {
    void window.vozella.invoke('settings.models.cancel', { fileName });
  }, []);

  const selectModel = useCallback(
    (fileName: string) => {
      void commit(window.vozella.invoke('settings.models.select', { fileName }));
    },
    [commit],
  );

  const deleteModel = useCallback(
    async (fileName: string): Promise<void> => {
      try {
        const result = await window.vozella.invoke('settings.models.delete', { fileName });
        if (!alive.current) return;
        if (result.status === 'busy') {
          setProblem(tRef.current('Ui_ModelDeleteBusy', nameOf(fileName)));
        } else if (result.status === 'failed') {
          setProblem(tRef.current('Ui_ModelDeleteFailed', nameOf(fileName), result.message));
        } else {
          setProblem(null);
        }
      } catch (error) {
        if (alive.current)
          setProblem(tRef.current('Ui_ModelDeleteFailed', nameOf(fileName), messageOf(error)));
      }
      await load();
    },
    [load, nameOf],
  );

  const dismissNotice = useCallback(
    (id: string) => {
      void window.vozella.invoke('settings.dismissNotice', { id }).then(load);
    },
    [load],
  );

  // --------------------------------------------------------------------- xAI

  const saveXaiApiKey = useCallback(
    async (key: string): Promise<boolean> => {
      setXaiBusy(true);
      try {
        const result = await window.vozella.invoke('settings.xai.saveApiKey', { key });
        if (!alive.current) return false;
        if (result.status === 'failed') {
          fail(result.message);
          return false;
        }
        if (result.status === 'ignored') return false;
        setXaiView(result.view);
        showFeedback(result.feedback);
        await load();
        return true;
      } catch (error) {
        fail(messageOf(error));
        return false;
      } finally {
        if (alive.current) setXaiBusy(false);
      }
    },
    [fail, load, setXaiView, showFeedback],
  );

  const signOutXai = useCallback(async (): Promise<void> => {
    setXaiBusy(true);
    try {
      const result = await window.vozella.invoke('settings.xai.signOut', {});
      if (!alive.current) return;
      if (result.status === 'failed') fail(result.message);
      else if (result.status !== 'ignored') {
        setXaiView(result.view);
        showFeedback(result.feedback);
      }
      await load();
    } catch (error) {
      fail(messageOf(error));
    } finally {
      if (alive.current) setXaiBusy(false);
    }
  }, [fail, load, setXaiView, showFeedback]);

  const signInXai = useCallback(async (): Promise<void> => {
    setXaiBusy(true);
    try {
      const result = await window.vozella.invoke('settings.xai.signIn', {});
      if (!alive.current) return;
      if (result.status === 'failed') {
        setProblem(tRef.current('Ui_XaiSignInFailed', result.message));
      } else if (result.status === 'signed-in') {
        setXaiView(result.view);
        showFeedback(result.feedback);
        await load();
      }
    } catch (error) {
      setProblem(tRef.current('Ui_XaiSignInFailed', messageOf(error)));
    } finally {
      if (alive.current) setXaiBusy(false);
    }
  }, [load, setXaiView, showFeedback]);

  const clearProblem = useCallback(() => {
    setProblem(null);
  }, []);

  return useMemo(
    () => ({
      page,
      loading,
      loadError,
      problem,
      clearProblem,
      feedback,
      clearFeedback,
      progress,
      xaiBusy,
      load,
      setProvider,
      setUiLanguage,
      setCliOption,
      setMeetingLanguage,
      checkCliAgain,
      downloadModel,
      cancelModel,
      selectModel,
      deleteModel,
      dismissNotice,
      refreshXai,
      saveXaiApiKey,
      signOutXai,
      signInXai,
    }),
    [
      page,
      loading,
      loadError,
      problem,
      clearProblem,
      feedback,
      clearFeedback,
      progress,
      xaiBusy,
      load,
      setProvider,
      setUiLanguage,
      setCliOption,
      setMeetingLanguage,
      checkCliAgain,
      downloadModel,
      cancelModel,
      selectModel,
      deleteModel,
      dismissNotice,
      refreshXai,
      saveXaiApiKey,
      signOutXai,
      signInXai,
    ],
  );
}
