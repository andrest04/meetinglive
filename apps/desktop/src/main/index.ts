// Composition root of the main process. Everything is wired here and nowhere else.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppInfo } from '@vozella/contracts';
import { ForbiddenDataRootError, RotatingFileLogger, type RunMode } from '@vozella/platform';
import { app, dialog, ipcMain, net, protocol, session } from 'electron';
import { bootstrapDataRoots, type BootstrappedPaths } from './bootstrap/data-roots';
import { isFakeNative, resolveRunMode } from './bootstrap/run-mode';
import { installGlobalErrorHandling } from './errors/global-errors';
import { registerHandlers } from './ipc/handlers';
import { buildCsp } from './security/csp';
import { mimeTypeFor, resolveAppAssetPath } from './security/app-protocol';
import { hardenSession, hardenWebContents } from './security/harden';
import {
  APP_SCHEME,
  isTrustedIpcSender,
  type IpcEventLike,
  type TrustedOrigins,
} from './security/trusted-origin';
import type { BrowserWindow } from 'electron';
import { createMainWindow } from './windows/main-window';
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

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    void audio
      .dispose()
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
    version: app.getVersion(),
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

  void app.whenReady().then(() => {
    serveRendererFromAppScheme();
    hardenSession(session.defaultSession, { devServerOrigin: trusted.devServerOrigin });

    registerHandlers({
      logger,
      info,
      nativeSelfTest: () => audio.ping(),
      server: {
        ipc: ipcMain,
        logger,
        isTrusted: (event: IpcEventLike) => isTrustedIpcSender(event, windowIds, trusted),
      },
    });

    mainWindow = createMainWindow({ devServerUrl, showOnReady: mode !== 'test' });
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
