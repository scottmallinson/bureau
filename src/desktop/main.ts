import { app, BrowserWindow, ipcMain, Menu, nativeTheme, net, safeStorage, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import type { SecretBox } from '../server/integrations.js';
import { serveBureau } from '../server/node.js';
import type { UpdateState } from '../core/updates.js';
import { isDispatchComposeLink } from '../core/dispatch.js';
import { UPDATE_CHANNELS } from './updates.js';

// electron-updater is CommonJS; this is its documented ESM import.
const { autoUpdater } = electronUpdater;

const here = fileURLToPath(new URL('.', import.meta.url));
const CHECK_EVERY_MS = 6 * 60 * 60_000;
const SEALED = 'safe:';
/** Kept in step with openDispatch in preload.cts. */
const OPEN_DISPATCH = 'bureau:dispatch:open';
/** Kept in step with dispatchInstalled in preload.cts. */
const DISPATCH_INSTALLED = 'bureau:dispatch:installed';

/**
 * Keys saved in Settings are encrypted with the operating system's keychain
 * (Keychain on macOS, DPAPI on Windows) through Electron's safeStorage, so the
 * data folder on its own does not give them away.
 */
const secrets: SecretBox = {
  seal(plain) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('This computer has no keychain Bureau can use to protect API keys');
    }
    return SEALED + safeStorage.encryptString(plain).toString('base64');
  },
  open(sealed) {
    if (!sealed.startsWith(SEALED)) return sealed;
    return safeStorage.decryptString(Buffer.from(sealed.slice(SEALED.length), 'base64'));
  },
};

let window: BrowserWindow | undefined;
let origin = '';

let updateState: UpdateState = { status: 'idle', version: app.getVersion() };

function setUpdateState(next: UpdateState): void {
  updateState = next;
  window?.webContents.send(UPDATE_CHANNELS.changed, next);
}

/**
 * Updates come from the repository's GitHub Releases (the `publish` block in
 * electron-builder.yml, baked into the installed app). A new version
 * downloads in the background and installs on the next quit, or straight away
 * from Settings.
 */
function setUpUpdates(): void {
  const version = app.getVersion();
  if (!app.isPackaged) {
    updateState = {
      status: 'unsupported',
      version,
      reason: 'Updates work in the installed app, not when run from source.',
    };
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', version }));
  autoUpdater.on('update-not-available', () =>
    setUpdateState({ status: 'current', version, checkedAt: new Date().toISOString() }),
  );
  autoUpdater.on('update-available', (info) =>
    setUpdateState({ status: 'downloading', version, next: info.version, percent: 0 }),
  );
  autoUpdater.on('download-progress', (progress) => {
    if (updateState.status === 'downloading') {
      setUpdateState({ ...updateState, percent: Math.round(progress.percent) });
    }
  });
  autoUpdater.on('update-downloaded', (info) =>
    setUpdateState({ status: 'ready', version, next: info.version }),
  );
  autoUpdater.on('error', (error) => {
    // The full error, with the response headers GitHub sends back, is for the log.
    // Settings only gets a plain message.
    console.error('Update check failed:', error);
    setUpdateState({
      status: 'error',
      version,
      message: 'Bureau could not reach its update server. It will try again later.',
    });
  });

  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, CHECK_EVERY_MS).unref();
}

function registerIpc(): void {
  ipcMain.handle(UPDATE_CHANNELS.state, () => updateState);
  ipcMain.handle(UPDATE_CHANNELS.check, async () => {
    if (updateState.status !== 'unsupported' && updateState.status !== 'downloading') {
      await autoUpdater.checkForUpdates().catch(() => undefined);
    }
    return updateState;
  });
  ipcMain.handle(UPDATE_CHANNELS.install, () => {
    if (updateState.status === 'ready') autoUpdater.quitAndInstall();
  });
  // The window cannot open another app itself, so a Dispatch link comes here.
  // Only compose links pass; anything else is refused.
  ipcMain.handle(OPEN_DISPATCH, (_event, link: unknown) => {
    if (typeof link !== 'string' || !isDispatchComposeLink(link)) {
      throw new Error('Only Dispatch compose links can be opened from Bureau.');
    }
    return shell.openExternal(link);
  });
  // Asks the operating system which app handles dispatch:// links. An empty
  // name means none does, so the calendar menu can offer the download instead.
  ipcMain.handle(DISPATCH_INSTALLED, () => {
    try {
      return app.getApplicationNameForProtocol('dispatch://compose') !== '';
    } catch {
      return false;
    }
  });
}

/**
 * Bureau has no menu bar of its own. macOS needs the application menu for Quit
 * and Hide, and the Edit menu for copy, paste and undo, so keep those two there.
 * Windows and Linux handle those keys in the window, so they get no menu.
 */
function installMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: 'Bureau',
    show: false,
    // The design system's page ground, so the window never flashes white
    // before the UI paints. Lamplight gets its own value below.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14120f' : '#f0ece1',
    // macOS hides the title bar and lets the app's own top bar absorb the
    // traffic-light inset; see the design system's app-patterns.md.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Bureau's own pages stay in the window; links to posts and services open in
  // the default browser.
  nativeTheme.on('updated', () => {
    window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#14120f' : '#f0ece1');
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });

  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => {
    window = undefined;
  });
  void window.loadURL(`${origin}/`);
}

async function start(): Promise<void> {
  // The API runs inside the app on a loopback port of its own. There is no
  // sign-in: like `npm start` without one, nothing beyond this machine can
  // reach it.
  const config = loadConfig({
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0',
    BUREAU_DATA_DIR: join(app.getPath('userData'), 'data'),
  });
  delete config.auth;

  const server = await serveBureau(config, {
    webRoot: join(here, '..', 'web'),
    secrets,
    // Node's fetch ignores the system proxy and certificate store, so Ghost and
    // Buffer were unreachable on networks that inspect TLS. Chromium's does not.
    fetch: (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
    loopbackHostOnly: true,
  });
  origin = `http://127.0.0.1:${server.port}`;
  app.on('will-quit', () => void server.close());

  registerIpc();
  setUpUpdates();
  installMenu();
  createWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (!window && origin) createWindow();
  });
  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      console.error(error);
      app.exit(1);
    });
}
