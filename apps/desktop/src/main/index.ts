// Composition root of the main process. Everything is wired here and nowhere else.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  libraryChanged,
  type AppInfo,
  type EventChannel,
  type PayloadInputOf,
  type ThemePreference,
} from '@vozella/contracts';
import { MeetingBusyRegistry, Workspace } from '@vozella/core';
import {
  ForbiddenDataRootError,
  LibraryRuntime,
  RotatingFileLogger,
  SystemClock,
  type RunMode,
} from '@vozella/platform';
import {
  app,
  BrowserWindow,
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
import { installGlobalErrorHandling } from './errors/global-errors';
import { registerHandlers } from './ipc/handlers';
import { bridgeWorkspace, registerLibraryHandlers } from './ipc/library-handlers';
import { sendEvent } from './ipc/ipc-server';
import { buildCsp } from './security/csp';
import { mimeTypeFor, resolveAppAssetPath } from './security/app-protocol';
import { hardenSession, hardenWebContents } from './security/harden';
import {
  APP_SCHEME,
  isTrustedIpcSender,
  type IpcEventLike,
  type TrustedOrigins,
} from './security/trusted-origin';
import { createMainWindow } from './windows/main-window';
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
    privileges: { standard: true, secure: true, supportFetchAPI: true },
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

  if (!app.requestSingleInstanceLock()) {
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
        },
        logger: logger.child('audio'),
      }),
  });

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents, trusted, (kind, url) => {
      logger.warn('blocked', { kind, url });
    });
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
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    void Promise.race([
      libraryWrites?.settled() ?? Promise.resolve(),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ])
      .then(() => audio.dispose())
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
  });

  function broadcast<C extends EventChannel>(channel: C, payload: PayloadInputOf<C>): void {
    for (const window of BrowserWindow.getAllWindows()) {
      sendEvent(window.webContents, channel, payload);
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
    for (const window of BrowserWindow.getAllWindows()) {
      window.setTitleBarOverlay(titleBarOverlayFor(theme));
      window.setBackgroundColor(windowBackground(theme));
    }
  });

  void app.whenReady().then(async () => {
    serveRendererFromAppScheme();
    hardenSession(session.defaultSession, { devServerOrigin: trusted.devServerOrigin });

    try {
      await library.start();
    } catch (error) {
      logger.error('library failed to start', { error });
      const message = error instanceof Error ? error.message : String(error);
      if (mode !== 'test') dialog.showErrorBox('Vozella cannot open its library', message);
    }
    bridgeWorkspace(workspace, broadcast);

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

    mainWindow = createMainWindow({
      devServerUrl,
      showOnReady: mode !== 'test' || process.env.VOZELLA_E2E_SHOW === '1',
      theme: resolvedTheme(),
    });
    const id = mainWindow.webContents.id;
    windowIds.add(id);
    mainWindow.on('closed', () => {
      windowIds.delete(id);
      mainWindow = undefined;
    });
    mainWindow.webContents.once('did-finish-load', () => {
      logger.info('window ready');
    });
  });
}

function serveRendererFromAppScheme(): void {
  const rendererRoot = path.join(__dirname, '..', 'renderer');
  const csp = buildCsp({ dev: false });
  protocol.handle(APP_SCHEME, async (request) => {
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
