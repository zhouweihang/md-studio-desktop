import { rename as renameOnDisk } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { app, BrowserWindow, clipboard, ClipboardItem, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { Channels } from '../shared/channels';
import type {
  AssetPickResult,
  AssetSaveResult,
  ConflictDialogResult,
  DraftMeta,
  DraftRecord,
  ExportResult,
  HistoryEntry,
  KeymapResult,
  PandocStatusResult,
  PrintResult,
  OpenFileResult,
  OpenFolderResult,
  ReadDirResult,
  ReadFileResult,
  SaveFileAsResult,
  SaveFileResult,
  SearchBatchEvent,
  SearchDoneEvent,
  SettingsResult,
  StartupInfo,
  ThemeListResult,
  ThemeReadResult,
  WorkspaceChangedEvent
} from '../shared/channels';
import {
  AssetCopyRequest,
  AssetPickRequest,
  AssetSaveRequest,
  BooleanStateRequest,
  ClipboardWriteRequest,
  CloseConfirmRequest,
  ConflictDialogRequest,
  CreateEntryRequest,
  DraftDiscardRequest,
  DraftIdRequest,
  DraftSaveRequest,
  ExportHtmlRequest,
  ExportImageRequest,
  ExportPdfRequest,
  EditActionRequest,
  ExportTextRequest,
  HistoryReadRequest,
  HistorySnapshotRequest,
  KeymapUpdateRequest,
  PandocExportRequest,
  PandocImportRequest,
  LogRequest,
  MoveEntryRequest,
  OpenExternalRequest,
  PathRequest,
  PrintRequest,
  ReadDirRequest,
  RenameEntryRequest,
  RenameFileRequest,
  ReplaceMisspellingRequest,
  SaveFileAsRequest,
  SaveFileRequest,
  SearchStartRequest,
  SetDirtyRequest,
  SetRootRequest,
  SettingsUpdateRequest,
  ThemeReadRequest,
  WatchFileRequest,
  ZoomRequest,
  parseOrThrow
} from '../shared/ipc';
import { t } from '../shared/i18n';
import { pushRecent } from '../shared/settings';
import { clampZoomLevel } from '../shared/view-controls';
import { draftStore } from './drafts';
import { exportHtml, exportImage, exportPdf, exportText, printDocument } from './exporters';
import { historyStore } from './history';
import { detectPandoc, invalidatePandocCache, pandocExport, pandocImport } from './pandoc';
import {
  askConflictChoice,
  openFileDialog,
  openFolderDialog,
  openPath,
  readTextFile,
  saveAsDialog,
  saveFileChecked,
  showMessageBox,
  showOpenDialog
} from './fs-service';
import { keymapStore } from './keymap-store';
import { logMain } from './logger';
import { searchDirectory } from './search';
import { settingsStore } from './settings';
import { themeStore } from './themes';
import { copyAsset, createEntry, deleteEntry, moveEntry, readDir, renameEntry, saveAsset, WorkspaceWatcher } from './workspace';
import { applySpellcheck, resolveCloseConfirmation, setWindowDirty } from './window';

export interface IpcDeps {
  rebuildMenu(): void;
  broadcast(channel: string, payload: unknown): void;
  userDataDir(): string;
  createWindow(): void;
}

export interface IpcRuntime {
  workspaceWatcher: WorkspaceWatcher;
  stopAll(): Promise<void>;
}

function windowFromEvent(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export function registerIpc(deps: IpcDeps): IpcRuntime {
  const fileWatchers = new Map<number, FSWatcher>();
  const workspaceWatcher = new WorkspaceWatcher((events) => {
    deps.broadcast(Channels.wsChanged, { events } satisfies { events: WorkspaceChangedEvent[] });
  });

  let searchCounter = 0;
  let activeSearch: { id: number; canceled: boolean } | null = null;

  const broadcastSettings = (): void => {
    deps.broadcast(Channels.settingsChanged, { settings: settingsStore.get() } satisfies SettingsResult);
  };

  const noteRecent = (path: string): void => {
    const settings = settingsStore.get();
    void settingsStore
      .update({ files: { recent: pushRecent(settings.files.recent, path), lastOpen: path } })
      .then(() => {
        broadcastSettings();
        deps.rebuildMenu();
      });
  };

  const stopFileWatch = async (windowId: number): Promise<void> => {
    const watcher = fileWatchers.get(windowId);
    if (!watcher) return;
    fileWatchers.delete(windowId);
    await watcher.close().catch(() => undefined);
  };

  // ---- 文件 ----

  ipcMain.handle(Channels.fileOpenDialog, async (event): Promise<OpenFileResult> => {
    const result = await openFileDialog(windowFromEvent(event));
    if (!result.canceled && result.path) noteRecent(result.path);
    return result;
  });

  ipcMain.handle(Channels.fileOpenPath, async (_event, payload): Promise<OpenFileResult> => {
    const request = parseOrThrow(PathRequest, payload, 'file:open-path');
    const result = await openPath(request.path);
    if (!result.canceled && result.path) noteRecent(result.path);
    return result;
  });

  ipcMain.handle(Channels.fileRead, async (_event, payload): Promise<ReadFileResult> => {
    const request = parseOrThrow(PathRequest, payload, 'file:read');
    const info = await readTextFile(request.path);
    return { path: request.path, content: info.content, mtimeMs: info.mtimeMs };
  });

  ipcMain.handle(Channels.fileSave, async (_event, payload): Promise<SaveFileResult> => {
    const request = parseOrThrow(SaveFileRequest, payload, 'file:save');
    const result = await saveFileChecked(request);
    if (result.ok) noteRecent(request.path);
    return result;
  });

  ipcMain.handle(Channels.fileSaveAs, async (event, payload): Promise<SaveFileAsResult> => {
    const request = parseOrThrow(SaveFileAsRequest, payload, 'file:save-as');
    const result = await saveAsDialog(windowFromEvent(event), request);
    if (!result.canceled && result.path) noteRecent(result.path);
    return result;
  });

  ipcMain.handle(Channels.fileConflictDialog, async (event, payload): Promise<ConflictDialogResult> => {
    const request = parseOrThrow(ConflictDialogRequest, payload, 'file:conflict-dialog');
    const choice = await askConflictChoice(windowFromEvent(event), request);
    return { choice };
  });

  ipcMain.handle(Channels.fileWatch, async (event, payload): Promise<{ ok: boolean }> => {
    const request = parseOrThrow(WatchFileRequest, payload, 'file:watch');
    const win = windowFromEvent(event);
    if (!win) return { ok: true };
    await stopFileWatch(win.id);
    if (!request.path) return { ok: true };
    const watcher = watch(request.path, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 }
    });
    watcher.on('change', () => {
      if (!win.isDestroyed()) win.webContents.send(Channels.fileChanged, { path: request.path, mtimeMs: Date.now(), deleted: false });
    });
    watcher.on('unlink', () => {
      if (!win.isDestroyed()) win.webContents.send(Channels.fileChanged, { path: request.path, mtimeMs: 0, deleted: true });
    });
    watcher.on('error', (error) => logMain('warn', `文件监听错误：${String(error)}`));
    fileWatchers.set(win.id, watcher);
    win.once('closed', () => void stopFileWatch(win.id));
    return { ok: true };
  });

  // ---- 资源（图片） ----

  ipcMain.handle(Channels.assetSave, async (_event, payload): Promise<AssetSaveResult> => {
    const request = parseOrThrow(AssetSaveRequest, payload, 'asset:save');
    try {
      const saved = await saveAsset(request.docDir, request.name, Buffer.from(request.dataBase64, 'base64'));
      return { ok: true, relativePath: saved.relativePath, absolutePath: saved.absolutePath };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(Channels.assetCopy, async (_event, payload): Promise<AssetSaveResult> => {
    const request = parseOrThrow(AssetCopyRequest, payload, 'asset:copy');
    try {
      const saved = await copyAsset(request.docDir, request.sourcePath);
      return { ok: true, relativePath: saved.relativePath, absolutePath: saved.absolutePath };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(Channels.assetPick, async (event, payload): Promise<AssetPickResult> => {
    const request = parseOrThrow(AssetPickRequest, payload, 'asset:pick');
    const result = await showOpenDialog(windowFromEvent(event), {
      title: '选择图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }]
    });
    const source = result.filePaths[0];
    if (result.canceled || !source) return { canceled: true };
    try {
      const saved = await copyAsset(request.docDir, source);
      return { canceled: false, relativePath: saved.relativePath, absolutePath: saved.absolutePath, name: basename(source) };
    } catch (error) {
      return { canceled: false };
    }
  });

  // ---- 工作区 ----

  ipcMain.handle(Channels.wsOpenFolderDialog, async (event): Promise<OpenFolderResult> => {
    const result = await openFolderDialog(windowFromEvent(event));
    if (!result.canceled && result.root) {
      await settingsStore.update({ files: { workspaceRoot: result.root } });
      workspaceWatcher.setRoot(result.root);
      broadcastSettings();
      deps.rebuildMenu();
    }
    return result;
  });

  ipcMain.handle(Channels.wsSetRoot, async (_event, payload): Promise<SettingsResult> => {
    const request = parseOrThrow(SetRootRequest, payload, 'ws:set-root');
    const settings = await settingsStore.update({ files: { workspaceRoot: request.root } });
    workspaceWatcher.setRoot(request.root);
    deps.broadcast(Channels.settingsChanged, { settings } satisfies SettingsResult);
    deps.rebuildMenu();
    return { settings };
  });

  ipcMain.handle(Channels.wsReadDir, async (_event, payload): Promise<ReadDirResult> => {
    const request = parseOrThrow(ReadDirRequest, payload, 'ws:read-dir');
    return readDir(request.dir);
  });

  ipcMain.handle(Channels.wsCreate, async (_event, payload): Promise<{ path: string }> => {
    const request = parseOrThrow(CreateEntryRequest, payload, 'ws:create');
    return { path: await createEntry(request.parent, request.name, request.kind) };
  });

  ipcMain.handle(Channels.wsRename, async (_event, payload): Promise<{ path: string }> => {
    const request = parseOrThrow(RenameEntryRequest, payload, 'ws:rename');
    return { path: await renameEntry(request.path, request.name) };
  });

  ipcMain.handle(Channels.wsDelete, async (_event, payload): Promise<{ ok: boolean }> => {
    const request = parseOrThrow(PathRequest, payload, 'ws:delete');
    await deleteEntry(request.path);
    return { ok: true };
  });

  ipcMain.handle(Channels.wsMove, async (_event, payload): Promise<{ path: string }> => {
    const request = parseOrThrow(MoveEntryRequest, payload, 'ws:move');
    return { path: await moveEntry(request.from, request.toDir) };
  });

  ipcMain.handle(Channels.wsReveal, async (_event, payload): Promise<{ ok: boolean }> => {
    const request = parseOrThrow(PathRequest, payload, 'ws:reveal');
    shell.showItemInFolder(request.path);
    return { ok: true };
  });

  // ---- 设置 / 键位 / 主题 ----

  ipcMain.handle(Channels.settingsGet, (): SettingsResult => ({ settings: settingsStore.get() }));

  /** 设置变更的副作用（缩放 / 置顶 / 拼写检查）：所有窗口同步生效。 */
  const applySettingsSideEffects = (): void => {
    const settings = settingsStore.get();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.setZoomLevel(settings.view.zoomLevel);
      win.setAlwaysOnTop(settings.window.alwaysOnTop);
      applySpellcheck(win, settings.editor.spellcheck);
    }
  };

  ipcMain.handle(Channels.settingsUpdate, async (_event, payload): Promise<SettingsResult> => {
    const request = parseOrThrow(SettingsUpdateRequest, payload, 'settings:update');
    const previousPandoc = settingsStore.get().pandoc.path;
    const settings = await settingsStore.update(request.patch);
    applySettingsSideEffects();
    if (settings.pandoc.path !== previousPandoc) invalidatePandocCache();
    deps.broadcast(Channels.settingsChanged, { settings } satisfies SettingsResult);
    deps.rebuildMenu();
    return { settings };
  });

  ipcMain.handle(Channels.keymapGet, (): KeymapResult => {
    const { resolved, overrides } = keymapStore.get();
    return { bindings: resolved.bindings, conflicts: resolved.conflicts, overrides };
  });

  ipcMain.handle(Channels.keymapUpdate, async (_event, payload): Promise<KeymapResult> => {
    const request = parseOrThrow(KeymapUpdateRequest, payload, 'keymap:update');
    const resolved = await keymapStore.update(request.bindings);
    const { overrides } = keymapStore.get();
    const result: KeymapResult = { bindings: resolved.bindings, conflicts: resolved.conflicts, overrides };
    deps.broadcast(Channels.keymapChanged, result);
    deps.rebuildMenu();
    return result;
  });

  ipcMain.handle(Channels.themesList, async (): Promise<ThemeListResult> => ({ themes: await themeStore.list() }));

  ipcMain.handle(Channels.themesRead, async (_event, payload): Promise<ThemeReadResult> => {
    const request = parseOrThrow(ThemeReadRequest, payload, 'themes:read');
    return themeStore.read(request.fileName);
  });

  // ---- 草稿 / 恢复 ----

  ipcMain.handle(Channels.draftSave, async (_event, payload): Promise<{ ok: boolean }> => {
    const request = parseOrThrow(DraftSaveRequest, payload, 'draft:save');
    await draftStore.save(request.id, request.path, request.name, request.content);
    return { ok: true };
  });

  ipcMain.handle(Channels.draftClear, async (_event, payload): Promise<{ ok: boolean }> => {
    const request = parseOrThrow(DraftIdRequest, payload, 'draft:clear');
    await draftStore.clear(request.id);
    return { ok: true };
  });

  ipcMain.handle(Channels.draftList, async (): Promise<{ drafts: DraftMeta[] }> => ({ drafts: await draftStore.list() }));

  ipcMain.handle(Channels.draftRead, async (_event, payload): Promise<{ draft: DraftRecord | null }> => {
    const request = parseOrThrow(DraftIdRequest, payload, 'draft:read');
    return { draft: await draftStore.read(request.id) };
  });

  ipcMain.handle(Channels.draftDiscard, async (_event, payload): Promise<{ ok: boolean }> => {
    const request = parseOrThrow(DraftDiscardRequest, payload, 'draft:discard');
    if (request.id) await draftStore.clear(request.id);
    else await draftStore.discardAll();
    return { ok: true };
  });

  // ---- 搜索 ----

  ipcMain.handle(Channels.searchStart, (event, payload): { id: number } => {
    const request = parseOrThrow(SearchStartRequest, payload, 'search:start');
    if (activeSearch) activeSearch.canceled = true;
    const id = ++searchCounter;
    const state = { id, canceled: false };
    activeSearch = state;
    const sender = event.sender;
    void searchDirectory(
      { root: request.root, query: request.query, mode: request.mode, caseSensitive: request.caseSensitive },
      {
        onBatch: (items, progress) => {
          if (!sender.isDestroyed()) {
            sender.send(Channels.searchBatch, {
              id,
              items,
              scannedFiles: progress.scannedFiles,
              matchCount: progress.matchCount
            } satisfies SearchBatchEvent);
          }
        },
        isCanceled: () => state.canceled
      }
    )
      .then((summary) => {
        if (activeSearch?.id === id) activeSearch = null;
        if (!sender.isDestroyed()) {
          sender.send(Channels.searchDone, { id, ...summary } satisfies SearchDoneEvent);
        }
      })
      .catch((error) => {
        logMain('warn', `搜索失败：${(error as Error).message}`);
        if (!sender.isDestroyed()) {
          sender.send(Channels.searchDone, {
            id,
            files: 0,
            matches: 0,
            elapsedMs: 0,
            truncated: false,
            canceled: true
          } satisfies SearchDoneEvent);
        }
      });
    return { id };
  });

  ipcMain.handle(Channels.searchCancel, (): { ok: boolean } => {
    if (activeSearch) activeSearch.canceled = true;
    return { ok: true };
  });

  // ---- 导出 ----

  ipcMain.handle(Channels.exportHtml, async (event, payload): Promise<ExportResult> => {
    const request = parseOrThrow(ExportHtmlRequest, payload, 'export:html');
    return exportHtml(windowFromEvent(event), request);
  });

  ipcMain.handle(Channels.exportPdf, async (event, payload): Promise<ExportResult> => {
    const request = parseOrThrow(ExportPdfRequest, payload, 'export:pdf');
    return exportPdf(windowFromEvent(event), request, deps.userDataDir());
  });

  ipcMain.handle(Channels.exportText, async (event, payload): Promise<ExportResult> => {
    const request = parseOrThrow(ExportTextRequest, payload, 'export:text');
    return exportText(windowFromEvent(event), request);
  });

  ipcMain.handle(Channels.exportImage, async (event, payload) => {
    const request = parseOrThrow(ExportImageRequest, payload, 'export:image');
    return exportImage(windowFromEvent(event), request, deps.userDataDir());
  });

  // ---- 视图控制 / 打印 / 剪贴板 / 文件操作补全 ----

  const applyZoom = (level: number): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.setZoomLevel(level);
    }
  };

  ipcMain.handle(Channels.viewSetZoom, async (_event, payload): Promise<{ ok: boolean; level: number }> => {
    const request = parseOrThrow(ZoomRequest, payload, 'view:set-zoom');
    const level = clampZoomLevel(request.level);
    applyZoom(level);
    await settingsStore.update({ view: { zoomLevel: level } });
    broadcastSettings();
    return { ok: true, level };
  });

  ipcMain.handle(Channels.viewSetFullScreen, (event, payload): { ok: boolean; on: boolean } => {
    const request = parseOrThrow(BooleanStateRequest, payload, 'view:set-full-screen');
    const win = windowFromEvent(event);
    if (!win) return { ok: false, on: false };
    win.setFullScreen(request.on);
    return { ok: true, on: win.isFullScreen() };
  });

  ipcMain.handle(Channels.viewSetAlwaysOnTop, async (event, payload): Promise<{ ok: boolean; on: boolean }> => {
    const request = parseOrThrow(BooleanStateRequest, payload, 'view:set-always-on-top');
    const win = windowFromEvent(event);
    if (!win) return { ok: false, on: false };
    win.setAlwaysOnTop(request.on);
    await settingsStore.update({ window: { alwaysOnTop: request.on } });
    broadcastSettings();
    return { ok: true, on: win.isAlwaysOnTop() };
  });

  ipcMain.handle(Channels.filePrint, async (event, payload): Promise<PrintResult> => {
    const request = parseOrThrow(PrintRequest, payload, 'file:print');
    return printDocument(windowFromEvent(event), request, deps.userDataDir());
  });

  ipcMain.handle(Channels.editAction, (event, payload): { ok: boolean } => {
    const request = parseOrThrow(EditActionRequest, payload, 'edit:action');
    const contents = event.sender;
    if (request.action === 'cut') contents.cut();
    else if (request.action === 'copy') contents.copy();
    else if (request.action === 'paste') contents.paste();
    else if (request.action === 'selectAll') contents.selectAll();
    else if (request.action === 'undo') contents.undo();
    else contents.redo();
    return { ok: true };
  });

  ipcMain.handle(Channels.contextReplaceMisspelling, (event, payload): { ok: boolean } => {
    const request = parseOrThrow(ReplaceMisspellingRequest, payload, 'context:replace-misspelling');
    event.sender.replaceMisspelling(request.word);
    return { ok: true };
  });

  ipcMain.handle(Channels.clipboardWrite, async (_event, payload): Promise<{ ok: boolean }> => {
    const request = parseOrThrow(ClipboardWriteRequest, payload, 'clipboard:write');
    if (request.html) {
      await clipboard.write([
        new ClipboardItem({ 'text/plain': request.text, 'text/html': request.html })
      ]);
    } else {
      await clipboard.writeText(request.text);
    }
    return { ok: true };
  });

  ipcMain.handle(Channels.clipboardRead, async (): Promise<{ text: string; html: string }> => {
    let text = '';
    let html = '';
    try {
      text = await clipboard.readText();
    } catch (error) {
      logMain('warn', `读取剪贴板文本失败：${(error as Error).message}`);
    }
    try {
      const items = await clipboard.read();
      for (const item of items) {
        if (!item.types.includes('text/html')) continue;
        const payload = await item.getType('text/html');
        html = payload instanceof Blob ? await payload.text() : String(payload);
        break;
      }
    } catch (error) {
      logMain('warn', `读取剪贴板 HTML 失败：${(error as Error).message}`);
    }
    return { text, html };
  });

  ipcMain.handle(Channels.fileRename, async (_event, payload): Promise<{ ok: boolean; path?: string; error?: string }> => {
    const request = parseOrThrow(RenameFileRequest, payload, 'file:rename');
    const target = join(dirname(request.path), request.name);
    if (target === request.path) return { ok: true, path: target };
    try {
      await renameOnDisk(request.path, target);
      const settings = settingsStore.get();
      const recent = settings.files.recent.map((item) => (item === request.path ? target : item));
      await settingsStore.update({ files: { recent, lastOpen: target } });
      broadcastSettings();
      deps.rebuildMenu();
      return { ok: true, path: target };
    } catch (error) {
      return { ok: false, error: `重命名失败：${(error as Error).message}` };
    }
  });

  ipcMain.handle(Channels.fileDelete, async (_event, payload): Promise<{ ok: boolean; error?: string }> => {
    const request = parseOrThrow(PathRequest, payload, 'file:delete');
    try {
      await shell.trashItem(request.path);
      const settings = settingsStore.get();
      await settingsStore.update({
        files: {
          recent: settings.files.recent.filter((item) => item !== request.path),
          lastOpen: settings.files.lastOpen === request.path ? null : settings.files.lastOpen
        }
      });
      broadcastSettings();
      deps.rebuildMenu();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `删除失败：${(error as Error).message}` };
    }
  });

  // ---- 版本快照（REQ-030） ----

  ipcMain.handle(Channels.historyList, async (_event, payload): Promise<{ entries: HistoryEntry[] }> => {
    const request = parseOrThrow(PathRequest, payload, 'history:list');
    return { entries: await historyStore.list(request.path) };
  });

  ipcMain.handle(Channels.historyRead, async (_event, payload): Promise<{ content: string | null }> => {
    const request = parseOrThrow(HistoryReadRequest, payload, 'history:read');
    return { content: await historyStore.read(request.path, request.id) };
  });

  ipcMain.handle(Channels.historySnapshot, async (_event, payload): Promise<{ ok: boolean; created: boolean }> => {
    const request = parseOrThrow(HistorySnapshotRequest, payload, 'history:snapshot');
    return historyStore.snapshot(request.path, request.content);
  });

  // ---- Pandoc（REQ-031） ----

  ipcMain.handle(Channels.pandocStatus, async (): Promise<PandocStatusResult> => detectPandoc());

  ipcMain.handle(Channels.pandocExport, async (event, payload): Promise<ExportResult> => {
    const request = parseOrThrow(PandocExportRequest, payload, 'pandoc:export');
    return pandocExport(windowFromEvent(event), request, deps.userDataDir());
  });

  ipcMain.handle(Channels.pandocImport, async (event, payload) => {
    const request = parseOrThrow(PandocImportRequest, payload, 'pandoc:import');
    return pandocImport(windowFromEvent(event), request, deps.userDataDir());
  });

  // ---- 应用控制 ----

  ipcMain.handle(Channels.appStartup, async (): Promise<StartupInfo> => ({
    crashed: draftStore.previousSessionCrashed(),
    drafts: await draftStore.list()
  }));

  ipcMain.handle(Channels.appNewWindow, (): { ok: boolean } => {
    deps.createWindow();
    return { ok: true };
  });

  ipcMain.handle(Channels.appCloseWindow, (event): { ok: boolean } => {
    windowFromEvent(event)?.close();
    return { ok: true };
  });

  ipcMain.handle(Channels.appAbout, async (event): Promise<{ ok: boolean }> => {
    const locale = settingsStore.get().language;
    await showMessageBox(windowFromEvent(event), {
      type: 'info',
      title: t('dialog.about.title', undefined, locale),
      message: `MD-Studio ${app.getVersion()}`,
      detail: [
        `Electron ${process.versions.electron} / Chromium ${process.versions.chrome} / Node ${process.versions.node}`,
        '',
        locale === 'en'
          ? 'Local-first Markdown editor (RFC-001 implementation).'
          : '本地优先的 Markdown 编辑器（RFC-001 自有实现）。',
        locale === 'en'
          ? 'Settings and drafts live in the app data folder; no telemetry.'
          : '用户设置与草稿位于应用数据目录，未启用任何遥测。'
      ].join('\n'),
      buttons: [t('dialog.confirm', undefined, locale)]
    });
    return { ok: true };
  });

  ipcMain.handle(Channels.appSetDirty, (event, payload): { ok: boolean } => {
    const request = parseOrThrow(SetDirtyRequest, payload, 'app:set-dirty');
    const win = windowFromEvent(event);
    if (win) setWindowDirty(win, request.dirty);
    return { ok: true };
  });

  ipcMain.handle(Channels.appCloseConfirm, (event, payload): { ok: boolean } => {
    const request = parseOrThrow(CloseConfirmRequest, payload, 'app:close-confirm');
    const win = windowFromEvent(event);
    if (win) resolveCloseConfirmation(win, request.ok);
    return { ok: true };
  });

  ipcMain.handle(Channels.appLog, (_event, payload): { ok: boolean } => {
    const request = parseOrThrow(LogRequest, payload, 'app:log');
    logMain(request.level, request.message);
    return { ok: true };
  });

  ipcMain.handle(Channels.shellOpenExternal, async (_event, payload): Promise<{ ok: boolean }> => {
    const request = parseOrThrow(OpenExternalRequest, payload, 'shell:open-external');
    if (!/^(https?:|mailto:)/i.test(request.url)) throw new Error('仅允许打开 http/https/mailto 链接');
    await shell.openExternal(request.url);
    return { ok: true };
  });

  return {
    workspaceWatcher,
    async stopAll(): Promise<void> {
      await workspaceWatcher.close();
      await Promise.all([...fileWatchers.keys()].map((windowId) => stopFileWatch(windowId)));
      await themeStore.close();
    }
  };
}
