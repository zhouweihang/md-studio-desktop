import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { app, BrowserWindow, protocol } from 'electron';
import { Channels } from '../shared/channels';
import type { ThemeMeta } from '../shared/theme-meta';
import { draftStore } from './drafts';
import { historyStore } from './history';
import { registerIpc, type IpcRuntime } from './ipc';
import { keymapStore } from './keymap-store';
import { initLogger, installErrorHandlers, logMain } from './logger';
import { buildApplicationMenu } from './menu';
import { settingsStore } from './settings';
import { themeStore } from './themes';
import { createWindow, sendCommand } from './window';

const ASSET_SCHEME = 'mdstudio-asset';
const ASSET_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon'
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
]);

let ipcRuntime: IpcRuntime | null = null;
let themesCache: ThemeMeta[] = [];
let quitting = false;

function broadcastAll(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function rebuildMenu(): void {
  buildApplicationMenu({
    runCommand: (id, arg) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (win) sendCommand(win, id, arg);
    },
    keymap: () => keymapStore.get().resolved,
    settings: () => settingsStore.get(),
    themes: () => themesCache
  });
}

async function refreshThemes(broadcast: boolean): Promise<void> {
  themesCache = await themeStore.list();
  if (broadcast) broadcastAll(Channels.themesChanged, { themes: themesCache });
  rebuildMenu();
}

/** 从命令行参数里找出要打开的文件（跳过开关与目录占位参数）。 */
async function findFileFromArgv(argv: string[]): Promise<string | null> {
  for (const arg of [...argv].reverse()) {
    if (!arg || arg.startsWith('-') || arg === '.' || arg === '..') continue;
    if (!['.md', '.markdown', '.mdx', '.txt'].includes(extname(arg).toLowerCase())) continue;
    try {
      const info = await stat(arg);
      if (info.isFile()) return arg;
    } catch {
      continue;
    }
  }
  return null;
}

function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const rawPath = decodeURIComponent(url.pathname).replace(/^\//, '');
      const extension = rawPath.split('.').pop()?.toLowerCase() ?? '';
      if (!ASSET_MIME[extension]) return new Response('Unsupported asset type', { status: 415 });
      const data = await readFile(rawPath);
      return new Response(new Uint8Array(data), {
        headers: {
          'content-type': ASSET_MIME[extension] ?? 'application/octet-stream',
          'cache-control': 'no-cache'
        }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

async function bootstrap(): Promise<void> {
  initLogger(app.getPath('userData'));
  installErrorHandlers();
  registerAssetProtocol();

  settingsStore.init(app.getPath('userData'));
  await settingsStore.load();
  keymapStore.init(app.getPath('userData'));
  await keymapStore.load();
  themeStore.init(app.getPath('userData'));
  await themeStore.ensureDir();
  await refreshThemes(false);
  themeStore.startWatching(() => void refreshThemes(true));

  draftStore.init(app.getPath('userData'));
  await draftStore.beginSession();
  historyStore.init(app.getPath('userData'));

  ipcRuntime = registerIpc({
    rebuildMenu,
    broadcast: broadcastAll,
    userDataDir: () => app.getPath('userData'),
    createWindow: () => {
      createWindow();
    }
  });

  const settings = settingsStore.get();
  ipcRuntime.workspaceWatcher.setRoot(settings.files.workspaceRoot);
  rebuildMenu();

  const win = createWindow();
  const initialFile = await findFileFromArgv(process.argv);
  win.webContents.once('did-finish-load', () => {
    if (initialFile) sendCommand(win, 'file.openRecent', initialFile);
  });
  logMain('info', `就绪（userData: ${app.getPath('userData')}）`);
  console.log('[md-studio] ready');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    void findFileFromArgv(argv).then((file) => {
      if (file && win) sendCommand(win, 'file.openRecent', file);
    });
  });

  app.whenReady().then(() => void bootstrap()).catch((error) => {
    logMain('error', `启动失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void (async () => {
    try {
      await draftStore.endSession();
      await settingsStore.flush();
      await ipcRuntime?.stopAll();
      await themeStore.close();
    } catch (error) {
      logMain('warn', `退出清理失败：${(error as Error).message}`);
    }
    app.quit();
  })();
});
