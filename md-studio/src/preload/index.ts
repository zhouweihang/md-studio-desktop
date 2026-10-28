import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { Channels } from '../shared/channels';
import type { MdStudioApi, Unsubscribe } from '../shared/api';

function subscribe<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.off(channel, listener);
  };
}

const api: MdStudioApi = {
  openFileDialog: () => ipcRenderer.invoke(Channels.fileOpenDialog),
  openPath: (path) => ipcRenderer.invoke(Channels.fileOpenPath, { path }),
  readFile: (path) => ipcRenderer.invoke(Channels.fileRead, { path }),
  saveFile: (request) => ipcRenderer.invoke(Channels.fileSave, request),
  saveFileAs: (request) => ipcRenderer.invoke(Channels.fileSaveAs, request),
  conflictDialog: (request) => ipcRenderer.invoke(Channels.fileConflictDialog, request),
  watchFile: (path) => ipcRenderer.invoke(Channels.fileWatch, { path }),
  onFileChanged: (callback) => subscribe(Channels.fileChanged, callback),

  saveAsset: (request) => ipcRenderer.invoke(Channels.assetSave, request),
  copyAsset: (request) => ipcRenderer.invoke(Channels.assetCopy, request),
  pickAsset: (docDir) => ipcRenderer.invoke(Channels.assetPick, { docDir }),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  openFolderDialog: () => ipcRenderer.invoke(Channels.wsOpenFolderDialog),
  setWorkspaceRoot: (root) => ipcRenderer.invoke(Channels.wsSetRoot, { root }),
  readDir: (dir) => ipcRenderer.invoke(Channels.wsReadDir, { dir }),
  createEntry: (request) => ipcRenderer.invoke(Channels.wsCreate, request),
  renameEntry: (request) => ipcRenderer.invoke(Channels.wsRename, request),
  deleteEntry: (path) => ipcRenderer.invoke(Channels.wsDelete, { path }),
  moveEntry: (request) => ipcRenderer.invoke(Channels.wsMove, request),
  reveal: (path) => ipcRenderer.invoke(Channels.wsReveal, { path }),
  onWorkspaceChanged: (callback) => subscribe(Channels.wsChanged, callback),

  getSettings: () => ipcRenderer.invoke(Channels.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(Channels.settingsUpdate, { patch }),
  onSettingsChanged: (callback) => subscribe(Channels.settingsChanged, callback),
  getKeymap: () => ipcRenderer.invoke(Channels.keymapGet),
  updateKeymap: (bindings) => ipcRenderer.invoke(Channels.keymapUpdate, { bindings }),
  onKeymapChanged: (callback) => subscribe(Channels.keymapChanged, callback),
  listThemes: () => ipcRenderer.invoke(Channels.themesList),
  readTheme: (fileName) => ipcRenderer.invoke(Channels.themesRead, { fileName }),
  onThemesChanged: (callback) => subscribe(Channels.themesChanged, callback),

  saveDraft: (request) => ipcRenderer.invoke(Channels.draftSave, request),
  clearDraft: (id) => ipcRenderer.invoke(Channels.draftClear, { id }),
  listDrafts: () => ipcRenderer.invoke(Channels.draftList),
  readDraft: (id) => ipcRenderer.invoke(Channels.draftRead, { id }),
  discardDrafts: (id) => ipcRenderer.invoke(Channels.draftDiscard, id ? { id } : {}),

  startSearch: (request) => ipcRenderer.invoke(Channels.searchStart, request),
  cancelSearch: () => ipcRenderer.invoke(Channels.searchCancel),
  onSearchBatch: (callback) => subscribe(Channels.searchBatch, callback),
  onSearchDone: (callback) => subscribe(Channels.searchDone, callback),

  exportHtml: (request) => ipcRenderer.invoke(Channels.exportHtml, request),
  exportPdf: (request) => ipcRenderer.invoke(Channels.exportPdf, request),
  exportText: (request) => ipcRenderer.invoke(Channels.exportText, request),
  exportImage: (request) => ipcRenderer.invoke(Channels.exportImage, request),

  setZoom: (level) => ipcRenderer.invoke(Channels.viewSetZoom, { level }),
  setFullScreen: (on) => ipcRenderer.invoke(Channels.viewSetFullScreen, { on }),
  setAlwaysOnTop: (on) => ipcRenderer.invoke(Channels.viewSetAlwaysOnTop, { on }),
  print: (request) => ipcRenderer.invoke(Channels.filePrint, request),
  onContextMenu: (callback) => subscribe(Channels.contextMenu, callback),
  replaceMisspelling: (word) => ipcRenderer.invoke(Channels.contextReplaceMisspelling, { word }),
  editAction: (action) => ipcRenderer.invoke(Channels.editAction, { action }),

  writeClipboard: (request) => ipcRenderer.invoke(Channels.clipboardWrite, request),
  readClipboard: () => ipcRenderer.invoke(Channels.clipboardRead),

  renameFile: (request) => ipcRenderer.invoke(Channels.fileRename, request),
  deleteFile: (path) => ipcRenderer.invoke(Channels.fileDelete, { path }),

  listHistory: (path) => ipcRenderer.invoke(Channels.historyList, { path }),
  readHistory: (request) => ipcRenderer.invoke(Channels.historyRead, request),
  snapshot: (request) => ipcRenderer.invoke(Channels.historySnapshot, request),

  pandocStatus: () => ipcRenderer.invoke(Channels.pandocStatus),
  pandocExport: (request) => ipcRenderer.invoke(Channels.pandocExport, request),
  pandocImport: (request) => ipcRenderer.invoke(Channels.pandocImport, request),

  startupInfo: () => ipcRenderer.invoke(Channels.appStartup),
  onCommand: (callback) => subscribe(Channels.commandRun, callback),
  newWindow: () => ipcRenderer.invoke(Channels.appNewWindow),
  closeWindow: () => ipcRenderer.invoke(Channels.appCloseWindow),
  showAbout: () => ipcRenderer.invoke(Channels.appAbout),
  setDirty: (dirty) => ipcRenderer.invoke(Channels.appSetDirty, { dirty }),
  confirmClose: (ok) => ipcRenderer.invoke(Channels.appCloseConfirm, { ok }),
  log: (level, message) => ipcRenderer.invoke(Channels.appLog, { level, message }),
  openExternal: (url) => ipcRenderer.invoke(Channels.shellOpenExternal, { url })
};

contextBridge.exposeInMainWorld('mdstudio', api);
