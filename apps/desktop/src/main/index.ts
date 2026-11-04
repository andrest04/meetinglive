// Composition root of the main process. Everything is wired here and nowhere else.
import { hasAudioBytes } from './audio-file';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  libraryChanged,
  recordingCloseRequest,
  recordingStateChanged,
  settingsMeetingPopupChanged,
  type AppInfo,
  type EventChannel,
  type PayloadInputOf,
  type PillStateDto,
  type ThemePreference,
} from '@vozella/contracts';
import {
  ChatService,
  MeetingBusyRegistry,
  PatchQueue,
  resolveTemplateInstructions,
  SummaryService,
  SummaryTabService,
  Workspace,
  type HardwareProbe,
} from '@vozella/core';
import {
  fakeEngineOptionsFromEnv,
  SteppedModelStore,
  SteppedRuntimeStore,
  FakeCliProbe,
  FileFakeCliProbe,
  FakeHardwareProbe,
  FakeSpeechEngine,
  FakeSummaryProvider,
  fakeSummaryOptionsFromEnv,
  FileLocalModelStore,
  PathCliProbe,
  createNativePorts,
  SummaryRuntime,
  ForbiddenDataRootError,
  LibraryChatReader,
  LibraryRuntime,
  readWavDurationSeconds,
  recoverCrashedRecordings,
  RotatingFileLogger,
  SettingsRuntime,
  SystemClock,
  SystemHardwareProbe,
  TranscriptionRuntime,
  type RunMode,
} from '@vozella/platform';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} from 'electron';
import { resolveAppVersion } from './bootstrap/app-version';
import {
  bootstrapDataRoots,
  resolveGuardInput,
  type BootstrappedPaths,
} from './bootstrap/data-roots';
import { isFakeNative, resolveRunMode } from './bootstrap/run-mode';
import {
  acquireSingleInstance,
  RELAUNCH_ARG,
  relaunchApp,
  sleepSync,
} from './bootstrap/single-instance';
import { installGlobalErrorHandling } from './errors/global-errors';
import { LocaleState, resolveStartupLanguage } from './i18n/locale-state';
import { mainCatalogs } from './i18n/main-catalogs';
import { registerHandlers } from './ipc/handlers';
import { createFlagFileScanner, fakeCallFlagPath } from './detection/fake-call-scanner';
import { MeetingDetectionController } from './detection/meeting-detection-controller';
import { createPopupHandle } from './detection/popup-handle';
import { composePill } from './live-copilot/compose-pill';
import type { PillController } from './live-copilot/pill-controller';
import { registerPillHandlers } from './ipc/pill-handlers';
import { registerMeetingPromptHandlers } from './ipc/meeting-prompt-handlers';
import { AudioController } from './audio/audio-controller';
import { registerAudioHandlers } from './ipc/audio-handlers';
import { registerTranscriptionHandlers } from './ipc/transcription-handlers';
import { registerSessionHandlers } from './ipc/session-handlers';
import { registerSummariesHandlers } from './ipc/summaries-handlers';
import { SummariesController } from './summaries/summaries-controller';
import { ChatController, chatProviderSource } from './chat/chat-controller';
import { registerChatHandlers } from './ipc/chat-handlers';
import {
  fakeModelScriptFromEnv,
  ScriptedFakeModelStore,
} from './summaries/scripted-fake-model-store';
import { TranscriptionController } from './transcription/transcription-controller';
import { AsrWorkerHost } from './workers/asr-worker-host';
import { createAppIconProvider } from './audio/app-icon';
import { RecordingTakes } from './audio/recording-take';
import { composeRecording } from './recording/compose-recording';
import { CloseGuard, RendererCloseDialogs } from './recording/close-guard';
import {
  createRecordingEntryPoints,
  registerRecordingBusyProbe,
  startTakeNotesRequests,
} from './recording/entry-points';
import { registerRecordingHandlers } from './ipc/recording-handlers';
import { LiveAsk } from './recording/live-ask-handlers';
import { bridgeWorkspace, registerLibraryHandlers } from './ipc/library-handlers';
import { sendEvent } from './ipc/ipc-server';
import { modelEventBridge, registerSettingsHandlers } from './ipc/settings-handlers';
import { buildCsp } from './security/csp';
import { mimeTypeFor, resolveAppAssetPath } from './security/app-protocol';
import { parseMediaId, serveMeetingAudio } from './security/media-route';
import { hardenSession, hardenWebContents } from './security/harden';
import {
  APP_SCHEME,
  isTrustedIpcSender,
  type IpcEventLike,
  type TrustedOrigins,
} from './security/trusted-origin';
import { createMainWindow } from './windows/main-window';
import { createMeetingPromptWindow } from './windows/meeting-prompt-window';
import {
  titleBarOverlayFor,
  windowBackground,
  type ResolvedTheme,
} from './windows/title-bar-theme';
import { AudioWorkerHost } from './workers/audio-worker-host';
import { forkUtilityWorker } from './workers/electron-worker-process';
import { resolveNativeAddonPath } from './workers/native-addon-path';

// Must run before ready: the renderer is served from a privileged custom scheme.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function main(): void {
  const mode: RunMode = resolveRunMode(app.isPackaged, process.env);

  let paths: BootstrappedPaths;
  try {
    paths = bootstrapDataRoots(app, mode, process.env);
  } catch (error) {
    // The guard refused the data root, or it cannot be created. Nothing else may run.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Vozella cannot start: ${message}\n`);
    if (mode !== 'test' && !(error instanceof ForbiddenDataRootError && mode === 'development')) {
      dialog.showErrorBox('Vozella cannot start', message);
    }
    app.exit(2);
    return;
  }

  const logger = new RotatingFileLogger({
    dir: paths.logsDir,
    fileName: 'main.log',
    scope: 'main',
    onWriteError: (error) => {
      process.stderr.write(`log write failed: ${String(error)}\n`);
    },
  });

  installGlobalErrorHandling(process, {
    logger,
    showFatal: (title, detail) => {
      if (mode !== 'test') dialog.showErrorBox(title, detail);
    },
    exit: (code) => app.exit(code),
  });

  if (
    !acquireSingleInstance({
      requestLock: () => app.requestSingleInstanceLock(),
      relaunched: process.argv.includes(RELAUNCH_ARG),
      sleep: sleepSync,
    })
  ) {
    logger.info('another instance is running, quitting');
    app.exit(0);
    return;
  }

  const appVersion = resolveAppVersion(__dirname, '1.0.0.0');
  const fakeNative = isFakeNative(process.env);
  const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
  const trusted: TrustedOrigins = {
    devServerOrigin: devServerUrl ? new URL(devServerUrl).origin : undefined,
  };
  const windowIds = new Set<number>();
  let mainWindow: BrowserWindow | undefined;
  /** The live copilot pill; made with the main window and closed with it. */
  let pill: PillController | undefined;

  logger.info('starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    mode,
    packaged: app.isPackaged,
    fakeNative,
    dataRootSource: paths.source,
  });

  const nativeAddonPath = resolveNativeAddonPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    mainDir: __dirname,
    platform: process.platform,
    arch: process.arch,
  });

  const audio = new AudioWorkerHost({
    logger: logger.child('audio'),
    spawn: () =>
      forkUtilityWorker({
        name: 'audio',
        modulePath: path.join(__dirname, 'workers', 'audio.js'),
        env: {
          VOZELLA_FAKE_NATIVE: fakeNative ? '1' : '0',
          VOZELLA_NATIVE_ADDON: nativeAddonPath,
          VOZELLA_MAIN_PID: String(process.pid),
        },
        logger: logger.child('audio'),
      }),
  });

  const asr = new AsrWorkerHost({
    logger: logger.child('asr'),
    spawn: () =>
      forkUtilityWorker({
        name: 'asr',
        modulePath: path.join(__dirname, 'workers', 'asr.js'),
        env: {},
        logger: logger.child('asr'),
      }),
  });

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(
      contents,
      trusted,
      (kind, url) => {
        logger.warn('blocked', { kind, url });
      },
      (url) => {
        // The fake native build records nothing and opens nothing.
        if (!fakeNative) void shell.openExternal(url);
      },
    );
  });

  app.on('render-process-gone', (_event, contents, details) => {
    logger.error('renderer process gone', { reason: details.reason, exitCode: details.exitCode });
    if (details.reason !== 'clean-exit' && !contents.isDestroyed()) contents.reload();
  });
  app.on('child-process-gone', (_event, details) => {
    logger.error('child process gone', { type: details.type, reason: details.reason });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  // Set once the handlers exist; a quit waits for the writes they hold (B16).
  let libraryWrites: { settled: () => Promise<void> } | undefined;
  let quitting = false;
  // Close protection (165): the exit gates (recording first) decide before anything shuts down.
  let mayExit: () => Promise<boolean> = () => Promise.resolve(true);
  let exitApproved = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    if (!exitApproved) {
      event.preventDefault();
      void mayExit().then((ok) => {
        if (!ok) return;
        exitApproved = true;
        app.quit();
      });
      return;
    }
    quitting = true;
    event.preventDefault();
    void Promise.race([
      libraryWrites?.settled() ?? Promise.resolve(),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ])
      .then(() => audio.dispose())
      .then(() => asr.dispose())
      .catch((error: unknown) => {
        logger.error('audio worker dispose failed', { error });
      })
      .finally(() => {
        logger.info('quit');
        app.quit();
      });
  });

  const info = (): AppInfo => ({
    name: app.getName(),
    version: appVersion,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    fakeNative,
    dataRoot: {
      appData: paths.appData,
      meetings: paths.meetings,
      source: paths.source,
    },
  });

  // Library storage: the busy registry is where the recording and re-transcription modules
  // report meetings they hold; the workspace is the app-lifetime hub.
  const busy = new MeetingBusyRegistry();
  const workspace = new Workspace();
  const library = new LibraryRuntime({
    mode,
    roots: paths,
    guard: resolveGuardInput(app, process.env),
    logger: logger.child('library'),
    clock: new SystemClock(),
    newId: () => randomUUID(),
    busy,
    openPath: (target) => shell.openPath(target),
    pickFolder: async (defaultPath) => {
      const options = {
        defaultPath,
        properties: ['openDirectory' as const, 'createDirectory' as const],
      };
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    version: appVersion,
    onChanged: (reason) => {
      broadcast(libraryChanged, { reason });
    },
    onSettingsDamaged: (info) => {
      settings.notices.add({ kind: 'settings-recovered', keptAs: info.keptAs });
    },
  });

  // One hardware read per process, shared by the Settings page and the transcription engine.
  const hardware: HardwareProbe = fakeNative
    ? new FakeHardwareProbe(
        process.env.VOZELLA_FAKE_NO_GPU === '1'
          ? { totalRamGb: 16, gpuName: null, gpuVramGb: null }
          : { totalRamGb: 16, gpuName: 'Fake GPU', gpuVramGb: 8 },
      )
    : new SystemHardwareProbe();

  // The model folder and the CLI probe are shared by the Settings page and the summary module.
  const summaryModels = fakeNative
    ? new ScriptedFakeModelStore(fakeModelScriptFromEnv(process.env))
    : new FileLocalModelStore({ directory: path.join(paths.appData, 'SummaryModels') });
  // A test that sets VOZELLA_FAKE_CLI_FILES decides what is installed by putting files in
  // <app data>/fake-cli, so it can flip the answer while the app runs.
  const summaryCli = !fakeNative
    ? new PathCliProbe()
    : process.env.VOZELLA_FAKE_CLI_FILES === '1'
      ? new FileFakeCliProbe(path.join(paths.appData, 'fake-cli'))
      : new FakeCliProbe(new Set(['claude']));

  // Settings page services. In the fake native build the machine, the CLIs, the model downloads
  // are doubles, so nothing touches the network.
  const settings: SettingsRuntime = new SettingsRuntime({
    store: library.settings,
    appDataDirectory: paths.appData,
    osLanguages: () => app.getPreferredSystemLanguages(),
    // The new process starts as this one exits; it waits for the single instance lock.
    relaunch: () => {
      relaunchApp({
        argv: process.argv,
        relaunch: (options) => {
          app.relaunch(options);
        },
        quit: () => {
          app.quit();
        },
        defer: (run) => {
          setImmediate(run);
        },
      });
    },
    notifyModel: modelEventBridge(broadcast),
    hardware,
    cli: summaryCli,
    modelStore: summaryModels,
  });

  /** The kill-on-close job that leaves no llama-server behind. Without it the sidecar watchdog runs. */
  function loadProcessJob() {
    try {
      return createNativePorts({
        fake: false,
        addonPath: nativeAddonPath,
        // A real require, so the bundler leaves the .node load to runtime.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        load: (file) => require(file) as unknown,
      }).processJob;
    } catch (error) {
      logger.warn('native process job unavailable; using the watchdog', { error: String(error) });
      return undefined;
    }
  }

  function broadcast<C extends EventChannel>(channel: C, payload: PayloadInputOf<C>): void {
    for (const window of BrowserWindow.getAllWindows()) {
      sendEvent(window.webContents, channel, payload);
    }
    // The pill follows the recording: its visibility rule and the start handoff.
    if (channel.name === recordingStateChanged.name) {
      pill?.onRecordingState((payload as PayloadInputOf<typeof recordingStateChanged>).isRecording);
    }
  }

  let detection: MeetingDetectionController | undefined;
  function startMeetingDetection(): MeetingDetectionController | undefined {
    try {
      const ports = fakeNative
        ? createNativePorts({ fake: true })
        : createNativePorts({
            fake: false,
            addonPath: nativeAddonPath,
            // A real require, so rolldown leaves the .node load to runtime.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            load: (addon) => require(addon) as unknown,
            onError: (error) => {
              logger.warn('window scan failed', { error: error.message });
            },
          });
      const callFlag = fakeCallFlagPath(process.env, mode === 'test');
      const controller = new MeetingDetectionController({
        scanner: callFlag ? createFlagFileScanner(callFlag) : ports.windowScan,
        workspace,
        settings: library.settings,
        popup: createPopupHandle(
          createMeetingPromptWindow(
            () => mainWindow ?? null,
            devServerUrl ? new URL('/meeting-prompt.html', devServerUrl).toString() : undefined,
          ),
          (webContentsId) => windowIds.add(webContentsId),
        ),
        getMainWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
        scheduler: {
          setInterval: (callback, ms) => {
            const timer = setInterval(callback, ms);
            return () => {
              clearInterval(timer);
            };
          },
        },
        setTimeout: (callback, ms) => {
          const timer = setTimeout(callback, ms);
          return () => {
            clearTimeout(timer);
          };
        },
        broadcastPopupSetting: (enabled) => {
          broadcast(settingsMeetingPopupChanged, { enabled });
        },
        logger: logger.child('detection'),
      });
      controller.start();
      app.on('before-quit', () => {
        controller.dispose();
      });
      return controller;
    } catch (error) {
      // Detection is a convenience: a missing addon must not stop the app.
      logger.error('meeting detection could not start', { error: String(error) });
      return undefined;
    }
  }

  const resolvedTheme = (): ResolvedTheme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

  /** Applies the user's choice to nativeTheme (so prefers-color-scheme follows) and the chrome. */
  const setThemePreference = (preference: ThemePreference): ResolvedTheme => {
    nativeTheme.themeSource = preference;
    return resolvedTheme();
  };
  nativeTheme.on('updated', () => {
    const theme = resolvedTheme();
    // Only the main window: the frameless call popup has no title bar overlay and is always dark.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitleBarOverlay(titleBarOverlayFor(theme));
      mainWindow.setBackgroundColor(windowBackground(theme));
    }
  });

  void app.whenReady().then(async () => {
    serveRendererFromAppScheme(async (id) => {
      // The audio path comes only from the repository record of the meeting.
      try {
        return (await library.meetings.get(id))?.audioFilePath ?? null;
      } catch {
        return null;
      }
    });
    settings.warmUp();
    hardenSession(session.defaultSession, { devServerOrigin: trusted.devServerOrigin });

    try {
      await library.start();
    } catch (error) {
      logger.error('library failed to start', { error });
      const message = error instanceof Error ? error.message : String(error);
      if (mode !== 'test') dialog.showErrorBox('Vozella cannot open its library', message);
    }
    bridgeWorkspace(workspace, broadcast);

    // A crash or a kill leaves a recording with an unwritten header. Fix those now, in the
    // background, so every later reader (duration, playback, transcription) can open them.
    void recoverCrashedRecordings(paths.meetings)
      .then((report) => {
        if (report.repaired.length > 0 || report.failed.length > 0) {
          logger.info('recovered crashed recordings', {
            repaired: report.repaired.length,
            failed: report.failed.length,
          });
        }
      })
      .catch((error: unknown) => {
        logger.warn('could not scan for crashed recordings', { error: String(error) });
      });

    // The language of the app is applied before any window exists (spec 2.1, 4.5).
    const locale = new LocaleState(
      await resolveStartupLanguage(
        () => library.settings.load(),
        app.getPreferredSystemLanguages(),
        (error) => {
          logger.warn('could not read the saved app language; using the OS language', { error });
        },
      ),
      mainCatalogs,
      (key, requested, fallback) => {
        logger.warn('missing string', { key, locale: requested, fallback });
      },
    );
    logger.info('app language', { tag: locale.tag, saved: locale.saved });

    registerHandlers({
      logger,
      info,
      setThemePreference,
      nativeSelfTest: () => audio.ping(),
      server: {
        ipc: ipcMain,
        logger,
        isTrusted: (event: IpcEventLike) => isTrustedIpcSender(event, windowIds, trusted),
      },
    });
    registerSettingsHandlers({
      server: {
        ipc: ipcMain,
        logger,
        isTrusted: (event: IpcEventLike) => isTrustedIpcSender(event, windowIds, trusted),
      },
      runtime: settings,
      locale,
      broadcast,
      onSummaryProviderSaved: () => liveAsk.refreshWebSupport(),
    });
    libraryWrites = registerLibraryHandlers({
      server: {
        ipc: ipcMain,
        logger,
        isTrusted: (event: IpcEventLike) => isTrustedIpcSender(event, windowIds, trusted),
      },
      runtime: library,
      workspace,
      broadcast,
    });

    // Audio capture: the recording module takes `audioController` to start and stop recordings.
    const audioController = new AudioController({
      host: audio,
      settings: library.settings,
      broadcast,
      logger: logger.child('audio'),
      scheduler: {
        every: (ms, task) => {
          const timer = setInterval(task, ms);
          return () => {
            clearInterval(timer);
          };
        },
      },
    });
    const recordingTakes = new RecordingTakes({
      controller: audioController,
      inboxDirectory: () => library.paths.inboxDirectory,
      nowMs: () => Date.now(),
      wavDurationSeconds: readWavDurationSeconds,
      logger: logger.child('recording'),
      // The call popup stays away while a take runs (spec 2.6, item 106).
      onCaptureActive: (active) => {
        workspace.setCaptureActive(active);
      },
      // The transcription controller is built below; the take only calls it later.
      live: {
        start: (recordedAtMs) => transcriptionController.startLive(recordedAtMs),
        stop: () => transcriptionController.stopLive(),
      },
    });
    registerAudioHandlers({
      server: {
        ipc: ipcMain,
        logger,
        isTrusted: (event: IpcEventLike) => isTrustedIpcSender(event, windowIds, trusted),
      },
      controller: audioController,
      takes: recordingTakes,
      appIcon: createAppIconProvider((exePath) => app.getFileIcon(exePath, { size: 'normal' })),
      pickAudioFile: async (extensions) => {
        const options = {
          defaultPath: app.getPath('downloads'),
          properties: ['openFile' as const],
          filters: [{ name: 'Audio', extensions: extensions.map((e) => e.replace('.', '')) }],
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
    });
    app.on('before-quit', () => {
      audioController.dispose();
    });

    // Summaries: one runtime owns the providers and the single local llama-server. The fake
    // native build answers every engine with a double, so e2e needs no model or CLI.
    const summaryRuntime = new SummaryRuntime({
      settings: library.settings,
      hardware,
      models: summaryModels,
      llamaRoot: path.join(paths.appData, 'LlamaRuntime'),
      cli: summaryCli,
      ...(fakeNative
        ? {
            providerOverride: (kind) =>
              new FakeSummaryProvider(
                kind === 'ClaudeCode' ? 'claude-code' : kind === 'Codex' ? 'codex' : 'local',
                fakeSummaryOptionsFromEnv(process.env),
              ),
          }
        : { processJob: loadProcessJob() }),
    });
    const summaryPatchQueue = new PatchQueue();
    const summaryService = new SummaryService({
      queue: summaryPatchQueue,
      meetings: library.meetings,
      settings: library.settings,
      resolver: summaryRuntime.resolver,
      clock: new SystemClock(),
      notifyMeetingChanged: (id) => {
        workspace.notifyMeetingChanged(id);
      },
      busy,
      placeholderFormats: [mainCatalogs.en, mainCatalogs.es].flatMap((catalog) => {
        const format = catalog.MeetingTitleFormat;
        return format === undefined ? [] : [format];
      }),
    });
    // A meeting being summarized cannot be re-transcribed, deleted or moved from under the run.
    busy.register({ isBusy: (id) => summaryService.isGenerating(id) });
    const summaries = new SummariesController({
      service: summaryService,
      tab: new SummaryTabService({
        queue: summaryPatchQueue,
        meetings: library.meetings,
        translate: (key, ...args) => locale.t(key, ...args),
        getSelectedMeetingId: () => workspace.state.selectedMeetingId,
        selectMeeting: (id) => {
          workspace.selectMeeting(id);
        },
      }),
      resolver: summaryRuntime.resolver,
      models: settings.models,
      hardware,
      cli: summaryCli,
      settings: library.settings,
      runtime: summaryRuntime,
      broadcast,
      logger: logger.child('summaries'),
      t: (key, ...args) => locale.t(key, ...args),
    });
    registerSummariesHandlers({
      server: {
        ipc: ipcMain,
        logger,
        isTrusted: (event: IpcEventLike) => isTrustedIpcSender(event, windowIds, trusted),
      },
      controller: summaries,
      writeClipboard: (text) => {
        return clipboard.writeText(text);
      },
    });
    // No llama-server may outlive the app: kill it now, then let it end cleanly.
    app.on('before-quit', () => {
      void summaries.dispose();
    });
    app.on('will-quit', () => {
      void summaries.dispose();
    });

    // Chat: one in-memory conversation; the engine is whichever one the summaries resolver picks.
    const chatReader = new LibraryChatReader({
      meetings: library.meetings,
      folders: library.folders,
    });
    const chat = new ChatController({
      service: new ChatService({
        meetings: chatReader,
        providers: chatProviderSource(summaryRuntime.resolver),
        clock: new SystemClock(),
        translate: (key, ...args) => locale.t(key, ...args),
        newId: () => randomUUID(),
      }),
      findMeetingId: (id) => chatReader.findMeetingId(id),
      writeClipboard: (text) => {
        return clipboard.writeText(text);
      },
      openExternal: (url) => {
        if (!fakeNative) return shell.openExternal(url);
        // E2E double: nothing opens; the address is appended to a file the spec can read.
        const log = process.env.VOZELLA_FAKE_OPENED_LOG;
        if (log)
          fs.appendFileSync(
            log,
            `${url}
`,
          );
        return Promise.resolve();
      },
      broadcast,
      translate: (key, ...args) => locale.t(key, ...args),
      logger: logger.child('chat'),
    });
    registerChatHandlers({
      server: {
        ipc: ipcMain,
        logger,
        isTrusted: (event: IpcEventLike) => isTrustedIpcSender(event, windowIds, trusted),
      },
      controller: chat,
    });

    // Transcription: the engine runs in its own process; the controller serves the pages and
    // gives the recording module the live pass and the offline pass.
    const transcription = new TranscriptionRuntime({
      transcriptionModelsDirectory: library.paths.transcriptionModelsDirectory,
      nemoSpeechDirectory: library.paths.nemoSpeechDirectory,
      engine: fakeNative
        ? new FakeSpeechEngine(
            Math.max(0, Number(process.env.VOZELLA_FAKE_ASR_OFFLINE_PUSH_MS) || 0),
          )
        : asr,
      hardware: () => hardware.detect(),
      logger: logger.child('transcription'),
      ...(fakeNative
        ? {
            stores: (() => {
              const options = fakeEngineOptionsFromEnv(process.env);
              return {
                models: new SteppedModelStore(options),
                runtimes: new SteppedRuntimeStore(options),
              };
            })(),
          }
        : {}),
    });
    const transcriptionController = new TranscriptionController({
      runtime: transcription,
      settings: library.settings,
      meetings: library.meetings,
      busy,
      broadcast,
      logger: logger.child('transcription'),
      t: (key, ...args) => locale.t(key, ...args),
      onRecordingFrames: (listener) =>
        audio.onPush((event) => {
          if (event.type === 'recording-frame') listener(event.pcm);
        }),
      // Same rule as the session view: a zero-byte or unreadable recording is no audio (B20).
      fileExists: (file) => hasAudioBytes(file),
      queue: summaryPatchQueue,
      isCaptureActive: () => workspace.state.isCaptureActive,
      onMeetingChanged: (id) => {
        workspace.notifyMeetingChanged(id);
      },
      // Re-transcription also regenerates the summary (the recording module reuses the same hook).
      summarize: (request, cancel) => summaries.summarizeForPipeline(request, cancel),
      templateInstructions: (record) =>
        Promise.resolve(resolveTemplateInstructions(record.noteTemplateId)),
      formatFailure: (error) => summaries.formatError(error),
    });
    registerTranscriptionHandlers({
      server: {
        ipc: ipcMain,
        logger,
        isTrusted: (event: IpcEventLike) => isTrustedIpcSender(event, windowIds, trusted),
      },
      controller: transcriptionController,
    });
    registerSessionHandlers({
      server: {
        ipc: ipcMain,
        logger,
        isTrusted: (event: IpcEventLike) => isTrustedIpcSender(event, windowIds, trusted),
      },
      meetings: library.meetings,
      workspace,
      runnerState: () => transcriptionController.retranscription,
      // A zero-byte or unreadable recording counts as no audio (B20).
      fileExists: (file) => hasAudioBytes(file),
      // Explorer selects the file; Finder reveals it.
      reveal: {
        reveal: (file) => {
          shell.showItemInFolder(file);
        },
      },
    });
    app.on('before-quit', () => {
      transcriptionController.dispose();
    });

    // Recording: the service owns a take from Record to the saved summary.
    const liveAsk = new LiveAsk({
      settings: library.settings,
      resolver: summaryRuntime.resolver,
      recording: () => recording.liveAskContext,
      broadcast,
      formatFailure: (error) => summaries.formatError(error),
      nowMs: () => Date.now(),
    });
    const recording = composeRecording({
      liveAsk: liveAsk.hooks,
      library,
      controller: audioController,
      takes: recordingTakes,
      transcription: transcriptionController,
      summaryService,
      resolver: summaryRuntime.resolver,
      summaryModels,
      cli: summaryCli,
      settings: library.settings,
      workspace,
      broadcast,
      logger: logger.child('recording'),
      translate: (key, ...args) => locale.t(key, ...args),
      locale: () => locale.locale,
      titleCatalog: (tag) => ({
        MeetingTitleFormat: mainCatalogs[tag].MeetingTitleFormat ?? '',
        MeetingTitleDateFormat: mainCatalogs[tag].MeetingTitleDateFormat ?? '',
      }),
      formatFailure: (error) => summaries.formatError(error),
      wavDurationSeconds: readWavDurationSeconds,
    });
    // Entry points for the other modules, the busy probe (164), the take-notes request (180) and
    // close protection (165).
    const recordingEntry = createRecordingEntryPoints(recording, workspace);
    registerRecordingBusyProbe(busy, recordingEntry);
    startTakeNotesRequests(workspace, recordingEntry, logger.child('recording'));
    const closeDialogs = new RendererCloseDialogs({
      send: (request) => {
        broadcast(recordingCloseRequest, request);
      },
      windowAvailable: () => mainWindow !== undefined && !mainWindow.isDestroyed(),
      newId: () => randomUUID(),
    });
    const closeGuard = new CloseGuard({
      service: recording,
      dialogs: closeDialogs,
      restoreWindow: () => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isMinimized()) {
          mainWindow.restore();
        }
      },
      logger: logger.child('recording'),
    });
    settings.exitGates.register(() => closeGuard.mayClose());
    mayExit = () => settings.exitGates.mayExit();
    registerRecordingHandlers({
      server: {
        ipc: ipcMain,
        logger,
        isTrusted: (event: IpcEventLike) => isTrustedIpcSender(event, windowIds, trusted),
      },
      service: recording,
      closeDialogs,
      liveAsk,
    });

    // Live copilot pill (spec 2.1): created on first need, driven by the main window's focus and
    // the recording state, closed with the main window.
    pill = composePill({
      settings: library.settings,
      logger: logger.child('pill'),
      title: () => locale.t('LiveCopilot_Title'),
      entryUrl: devServerUrl ? new URL('/pill.html', devServerUrl).toString() : undefined,
      trustSender: (webContentsId) => windowIds.add(webContentsId),
      getMainWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
      dismissMeetingPopup: () => detection?.dismiss(),
    });
    registerPillHandlers(
      {
        ipc: ipcMain,
        logger,
        isTrusted: (event: IpcEventLike) => isTrustedIpcSender(event, windowIds, trusted),
      },
      {
        togglePause: async () => {
          if (recording.getState().isPaused) await recording.resume();
          else await recording.pause();
        },
        stop: async () => {
          await recording.stop();
        },
        openApp: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        },
        setExpanded: (expanded) => pill?.setExpanded(expanded) ?? NO_PILL_STATE,
        state: () => pill?.state ?? NO_PILL_STATE,
        ready: () => {
          liveAsk.republish();
        },
      },
    );

    mainWindow = createMainWindow({
      devServerUrl,
      showOnReady: mode !== 'test' || process.env.VOZELLA_E2E_SHOW === '1',
      theme: resolvedTheme(),
    });
    const id = mainWindow.webContents.id;
    windowIds.add(id);
    mainWindow.on('close', (event) => {
      if (exitApproved) return;
      event.preventDefault();
      void mayExit().then((ok) => {
        if (!ok) return;
        exitApproved = true;
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      });
    });
    // Focus, blur, minimize and restore re-evaluate the pill (mainWindowActive starts true).
    mainWindow.on('focus', () => pill?.setMainWindowActive(true));
    mainWindow.on('blur', () => pill?.setMainWindowActive(false));
    mainWindow.on('minimize', () => pill?.setMainWindowActive(false));
    mainWindow.on('restore', () => pill?.setMainWindowActive(mainWindow?.isFocused() ?? false));
    mainWindow.on('closed', () => {
      windowIds.delete(id);
      mainWindow = undefined;
      pill?.dispose();
      pill = undefined;
    });
    mainWindow.webContents.once('did-finish-load', () => {
      logger.info('window ready');
    });

    // Meeting call detection: polls the open windows and shows the floating popup. Started
    // once the main window exists, stopped on quit.
    registerMeetingPromptHandlers(
      {
        ipc: ipcMain,
        logger,
        isTrusted: (event: IpcEventLike) => isTrustedIpcSender(event, windowIds, trusted),
      },
      {
        startTakingNotes: () => detection?.startTakingNotes(),
        dismiss: () => detection?.dismiss(),
        neverAgain: async () => {
          await detection?.neverAgain();
        },
        hover: (inside) => detection?.hover(inside),
        isShown: () => detection?.isShown ?? false,
      },
    );
    detection = startMeetingDetection();
  });
}

/** What `pill.ready` answers in the moment between the pill closing and the app quitting. */
const NO_PILL_STATE: PillStateDto = {
  visible: false,
  expanded: false,
  edge: 'Right',
  vertical: true,
  animationsEnabled: false,
  opacity: 1,
  contentOpacity: 1,
  window: { width: 80, height: 256 },
  capsule: { x: 8, y: 8, width: 64, height: 240 },
  panel: null,
};

function serveRendererFromAppScheme(
  resolveAudio: (meetingId: string) => Promise<string | null>,
): void {
  const rendererRoot = path.join(__dirname, '..', 'renderer');
  const csp = buildCsp({ dev: false });
  protocol.handle(APP_SCHEME, async (request) => {
    if (parseMediaId(request.url) !== null) return serveMeetingAudio(request, resolveAudio);
    const file = resolveAppAssetPath(rendererRoot, request.url);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return new Response('not found', { status: 404 });
    }
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Type', mimeTypeFor(file));
    headers.set('Content-Security-Policy', csp);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  });
}

main();
