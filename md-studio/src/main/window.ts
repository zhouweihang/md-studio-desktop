import { join } from 'node:path';
import { BrowserWindow, dialog, shell, type ContextMenuParams } from 'electron';
import { Channels, type CommandRunEvent, type ContextMenuEvent } from '../shared/channels';
import { t } from '../shared/i18n';
import { settingsStore } from './settings';
import { logMain } from './logger';

/** 拼写检查：语言列表 + 开关（REQ-021 的拼写建议依赖它）。 */
export function applySpellcheck(win: BrowserWindow, enabled: boolean): void {
  try {
    win.webContents.session.setSpellCheckerEnabled(enabled);
    if (enabled) win.webContents.session.setSpellCheckerLanguages(['en-US']);
  } catch (error) {
    logMain('warn', `拼写检查配置失败：${(error as Error).message}`);
  }
}

function toContextMenuEvent(params: ContextMenuParams): ContextMenuEvent {
  return {
    x: Math.round(params.x),
    y: Math.round(params.y),
    isEditable: params.isEditable,
    hasSelection: params.selectionText.trim().length > 0,
    selectionText: params.selectionText,
    misspelledWord: params.misspelledWord ?? '',
    suggestions: params.dictionarySuggestions ?? [],
    linkURL: params.linkURL || null
  };
}

interface WindowState {
  dirty: boolean;
  forceClose: boolean;
  awaitingSave: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null;
}

const states = new Map<number, WindowState>();
let boundsTimer: ReturnType<typeof setTimeout> | null = null;

export function sendCommand(win: BrowserWindow, id: string, arg?: unknown): void {
  if (win.isDestroyed()) return;
  win.webContents.send(Channels.commandRun, { id, arg } satisfies CommandRunEvent);
}

export function getWindowState(win: BrowserWindow): WindowState {
  let state = states.get(win.id);
  if (!state) {
    state = { dirty: false, forceClose: false, awaitingSave: false, saveTimer: null };
    states.set(win.id, state);
  }
  return state;
}

export function setWindowDirty(win: BrowserWindow, dirty: boolean): void {
  getWindowState(win).dirty = dirty;
}

export function resolveCloseConfirmation(win: BrowserWindow, ok: boolean): void {
  const state = states.get(win.id);
  if (!state || !state.awaitingSave) return;
  state.awaitingSave = false;
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }
  if (ok) {
    state.dirty = false;
    state.forceClose = true;
    win.close();
  } else {
    logMain('info', '用户在保存流程中取消，窗口保持打开');
  }
}

function persistBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    boundsTimer = null;
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const bounds = maximized ? win.getNormalBounds() : win.getBounds();
    void settingsStore.update({
      window: {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized
      }
    });
  }, 400);
}

export function createWindow(): BrowserWindow {
  const settings = settingsStore.get();
  const win = new BrowserWindow({
    width: settings.window.width,
    height: settings.window.height,
    x: settings.window.x ?? undefined,
    y: settings.window.y ?? undefined,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'MD-Studio',
    backgroundColor: '#f4f1ea',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  getWindowState(win);
  if (settings.window.maximized) win.maximize();
  win.setAlwaysOnTop(settings.window.alwaysOnTop);
  win.webContents.setZoomLevel(settings.view.zoomLevel);
  applySpellcheck(win, settings.editor.spellcheck);

  // 右键上下文菜单：把 Chromium 的参数交给渲染层组装条目（REQ-021）
  win.webContents.on('context-menu', (_event, params) => {
    if (win.isDestroyed()) return;
    win.webContents.send(Channels.contextMenu, toContextMenuEvent(params));
  });

  win.on('ready-to-show', () => win.show());
  win.on('resize', () => persistBounds(win));
  win.on('move', () => persistBounds(win));
  win.on('maximize', () => persistBounds(win));
  win.on('unmaximize', () => persistBounds(win));

  win.on('close', (event) => {
    const state = getWindowState(win);
    if (!state.dirty || state.forceClose) {
      if (state.saveTimer) clearTimeout(state.saveTimer);
      states.delete(win.id);
      return;
    }
    event.preventDefault();
    if (state.awaitingSave) return;
    const locale = settingsStore.get().language;
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        title: t('dialog.unsaved.title', undefined, locale),
        message: t('dialog.unsaved.message', undefined, locale),
        detail: t('dialog.unsaved.detail', undefined, locale),
        buttons: [
          t('dialog.unsaved.save', undefined, locale),
          t('dialog.unsaved.discard', undefined, locale),
          t('dialog.cancel', undefined, locale)
        ],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      })
      .then(({ response }) => {
        if (win.isDestroyed()) return;
        if (response === 0) {
          state.awaitingSave = true;
          state.saveTimer = setTimeout(() => {
            state.awaitingSave = false;
            state.saveTimer = null;
            logMain('warn', '等待渲染层保存确认超时，已取消关闭');
          }, 8000);
          sendCommand(win, 'file.save-and-close');
        } else if (response === 1) {
          state.forceClose = true;
          win.close();
        }
      })
      .catch((error) => logMain('warn', `关闭确认对话框失败：${(error as Error).message}`));
  });

  win.on('closed', () => {
    const state = states.get(win.id);
    if (state?.saveTimer) clearTimeout(state.saveTimer);
    states.delete(win.id);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
    const allowed = isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL ?? '');
    if (!allowed) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
