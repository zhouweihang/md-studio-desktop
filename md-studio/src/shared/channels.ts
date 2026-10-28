/**
 * IPC 通道名与两端共享的结果类型（预加载只依赖本文件，保持零 node 依赖）。
 */
import type { Settings, SettingsPatch } from './settings';
import type { KeyConflict, KeymapOverrides } from './keymap';
import type { ThemeMeta } from './theme-meta';

export const Channels = {
  fileOpenDialog: 'file:open-dialog',
  fileOpenPath: 'file:open-path',
  fileRead: 'file:read',
  fileSave: 'file:save',
  fileSaveAs: 'file:save-as',
  fileConflictDialog: 'file:conflict-dialog',
  fileWatch: 'file:watch',
  fileChanged: 'file:changed',

  wsOpenFolderDialog: 'ws:open-folder-dialog',
  wsSetRoot: 'ws:set-root',
  wsReadDir: 'ws:read-dir',
  wsCreate: 'ws:create',
  wsRename: 'ws:rename',
  wsDelete: 'ws:delete',
  wsMove: 'ws:move',
  wsReveal: 'ws:reveal',
  wsChanged: 'ws:changed',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChanged: 'settings:changed',

  keymapGet: 'keymap:get',
  keymapUpdate: 'keymap:update',
  keymapChanged: 'keymap:changed',

  themesList: 'themes:list',
  themesRead: 'themes:read',
  themesChanged: 'themes:changed',

  draftSave: 'draft:save',
  draftClear: 'draft:clear',
  draftList: 'draft:list',
  draftRead: 'draft:read',
  draftDiscard: 'draft:discard',

  assetSave: 'asset:save',
  assetCopy: 'asset:copy',
  assetPick: 'asset:pick',

  searchStart: 'search:start',
  searchCancel: 'search:cancel',
  searchBatch: 'search:batch',
  searchDone: 'search:done',

  exportHtml: 'export:html',
  exportPdf: 'export:pdf',
  exportText: 'export:text',
  exportImage: 'export:image',

  viewSetZoom: 'view:set-zoom',
  viewSetFullScreen: 'view:set-full-screen',
  viewSetAlwaysOnTop: 'view:set-always-on-top',
  filePrint: 'file:print',
  contextMenu: 'context:menu',
  contextReplaceMisspelling: 'context:replace-misspelling',
  editAction: 'edit:action',

  clipboardWrite: 'clipboard:write',
  clipboardRead: 'clipboard:read',

  fileRename: 'file:rename',
  fileDelete: 'file:delete',

  historyList: 'history:list',
  historyRead: 'history:read',
  historySnapshot: 'history:snapshot',

  pandocStatus: 'pandoc:status',
  pandocExport: 'pandoc:export',
  pandocImport: 'pandoc:import',

  commandRun: 'command:run',
  appStartup: 'app:startup',
  appNewWindow: 'app:new-window',
  appCloseWindow: 'app:close-window',
  appAbout: 'app:about',
  appSetDirty: 'app:set-dirty',
  appCloseConfirm: 'app:close-confirm',
  appLog: 'app:log',
  shellOpenExternal: 'shell:open-external'
} as const;

export type ChannelName = (typeof Channels)[keyof typeof Channels];

// ---- 文件 ----

export interface OpenFileResult {
  canceled: boolean;
  path?: string;
  content?: string;
  mtimeMs?: number;
  error?: string;
}

export interface ReadFileResult {
  path: string;
  content: string;
  mtimeMs: number;
}

export type SaveFileResult =
  | { ok: true; mtimeMs: number }
  | { ok: false; conflict: true; diskMtimeMs: number }
  | { ok: false; conflict: false; error: string };

export interface SaveFileAsResult {
  canceled: boolean;
  path?: string;
  mtimeMs?: number;
  error?: string;
}

export type ConflictChoice = 'reload' | 'save-as' | 'overwrite' | 'cancel';

export interface ConflictDialogResult {
  choice: ConflictChoice;
}

// ---- 工作区 ----

export type EntryKind = 'file' | 'dir';

export interface DirEntry {
  name: string;
  path: string;
  kind: EntryKind;
  size: number;
  mtimeMs: number;
}

export interface ReadDirResult {
  dir: string;
  entries: DirEntry[];
  truncated: boolean;
}

export interface WorkspaceChangedEvent {
  event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
}

export interface WorkspaceChangedBatch {
  events: WorkspaceChangedEvent[];
}

export interface FileChangedEvent {
  path: string;
  mtimeMs: number;
  deleted: boolean;
}

export interface OpenFolderResult {
  canceled: boolean;
  root?: string;
}

// ---- 设置 / 键位 / 主题 ----

export interface SettingsResult {
  settings: Settings;
}

export interface KeymapResult {
  bindings: Record<string, string[]>;
  conflicts: KeyConflict[];
  overrides: KeymapOverrides;
}

export interface ThemeListResult {
  themes: ThemeMeta[];
}

export interface ThemeReadResult {
  meta: ThemeMeta;
  css: string;
}

// ---- 草稿 / 恢复 ----

export interface DraftMeta {
  id: string;
  path: string | null;
  name: string;
  updatedAt: number;
  size: number;
}

export interface DraftRecord extends DraftMeta {
  content: string;
}

// ---- 资源（图片落盘） ----

export type AssetSaveResult =
  | { ok: true; relativePath: string; absolutePath: string }
  | { ok: false; error: string };

export interface AssetPickResult {
  canceled: boolean;
  relativePath?: string;
  absolutePath?: string;
  name?: string;
}

// ---- 搜索 ----

export type SearchMode = 'content' | 'name';

export interface SearchItem {
  path: string;
  name: string;
  kind: 'name' | 'content';
  line?: number;
  column?: number;
  text?: string;
}

export interface SearchBatchEvent {
  id: number;
  items: SearchItem[];
  scannedFiles: number;
  matchCount: number;
}

export interface SearchDoneEvent {
  id: number;
  files: number;
  matches: number;
  elapsedMs: number;
  truncated: boolean;
  canceled: boolean;
}

// ---- 导出 ----

export interface ExportResult {
  canceled: boolean;
  path?: string;
  error?: string;
}

export interface ExportPdfOptions {
  html: string;
  suggestedName: string;
  targetPath?: string;
  margins?: { top: number; bottom: number; left: number; right: number };
  footer?: boolean;
}

export interface ExportTextOptions {
  content: string;
  suggestedName: string;
  targetPath?: string;
}

export interface ExportImageOptions {
  html: string;
  suggestedName: string;
  format: 'png' | 'jpeg';
  /** 视口宽度（默认 900） */
  width?: number;
  targetPath?: string;
}

export type ExportImageResult =
  | { ok: true; paths: string[]; truncated: boolean }
  | { ok: false; canceled?: boolean; error: string };

// ---- 视图控制与打印（REQ-022/025） ----

export interface ZoomResult {
  ok: boolean;
  level: number;
}

export interface PrintResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
}

// ---- 上下文菜单（REQ-021） ----

export interface ContextMenuEvent {
  x: number;
  y: number;
  isEditable: boolean;
  hasSelection: boolean;
  selectionText: string;
  misspelledWord: string;
  suggestions: string[];
  linkURL: string | null;
}

export type EditActionName = 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo';

// ---- 剪贴板（REQ-028） ----

export interface ClipboardWriteRequest {
  text: string;
  html?: string;
}

export interface ClipboardReadResult {
  text: string;
  html: string;
}

// ---- 版本快照（REQ-030） ----

export interface HistoryEntry {
  id: string;
  savedAt: number;
  size: number;
}

export interface HistoryListResult {
  entries: HistoryEntry[];
}

export interface HistoryReadResult {
  content: string | null;
}

// ---- Pandoc 互操作（REQ-031） ----

export interface PandocStatusResult {
  available: boolean;
  version: string | null;
  path: string | null;
  error?: string;
}

export type PandocFormat = 'docx' | 'latex' | 'epub' | 'rtf' | 'odt' | 'html';

export interface PandocExportRequest {
  markdown: string;
  docName: string;
  format: PandocFormat;
  /** 目标路径；缺省时由主进程弹保存对话框 */
  targetPath?: string;
  /** 文档目录（图片相对路径的 resource-path） */
  docDir: string | null;
  /** 导出件标题（写入 front matter） */
  title?: string;
}

export type PandocImportResult =
  | { ok: true; markdown: string; name: string; path: string }
  | { ok: false; canceled?: boolean; error: string };

// ---- 应用 ----

export interface StartupInfo {
  crashed: boolean;
  drafts: DraftMeta[];
}

export interface CommandRunEvent {
  id: string;
  arg?: unknown;
}

export type LogLevel = 'info' | 'warn' | 'error';

export type { Settings, SettingsPatch, ThemeMeta, KeyConflict, KeymapOverrides };
