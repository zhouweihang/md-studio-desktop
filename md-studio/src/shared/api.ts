/**
 * 预加载暴露给渲染层的 API 类型（window.mdstudio）。
 * 仅类型声明：预加载负责实现，渲染层负责消费，两端类型强制一致。
 */
import type { Settings, SettingsPatch } from './settings';
import type { KeyConflict, KeymapOverrides } from './keymap';
import type { ThemeMeta } from './theme-meta';
import type {
  AssetPickResult,
  AssetSaveResult,
  ClipboardReadResult,
  ClipboardWriteRequest,
  CommandRunEvent,
  ContextMenuEvent,
  EditActionName,
  ExportImageOptions,
  ExportImageResult,
  ExportTextOptions,
  HistoryListResult,
  HistoryReadResult,
  PandocExportRequest,
  PandocImportResult,
  PandocStatusResult,
  PrintResult,
  ZoomResult,
  ConflictDialogResult,
  DirEntry,
  DraftMeta,
  DraftRecord,
  ExportResult,
  ExportPdfOptions,
  FileChangedEvent,
  KeymapResult,
  LogLevel,
  OpenFileResult,
  OpenFolderResult,
  ReadDirResult,
  ReadFileResult,
  SaveFileAsResult,
  SaveFileResult,
  SearchBatchEvent,
  SearchDoneEvent,
  SearchMode,
  SettingsResult,
  StartupInfo,
  ThemeListResult,
  ThemeReadResult,
  WorkspaceChangedBatch
} from './channels';

export type Unsubscribe = () => void;

export interface MdStudioApi {
  // ---- 文件 ----
  openFileDialog(): Promise<OpenFileResult>;
  openPath(path: string): Promise<OpenFileResult>;
  readFile(path: string): Promise<ReadFileResult>;
  saveFile(request: {
    path: string;
    content: string;
    mtimeMs?: number;
    force?: boolean;
  }): Promise<SaveFileResult>;
  saveFileAs(request: { content: string; suggestedName?: string; targetPath?: string }): Promise<SaveFileAsResult>;
  conflictDialog(request: { path: string; suggestedName?: string }): Promise<ConflictDialogResult>;
  watchFile(path: string | null): Promise<{ ok: boolean }>;
  onFileChanged(callback: (event: FileChangedEvent) => void): Unsubscribe;

  // ---- 资源 ----
  saveAsset(request: { docDir: string; name: string; dataBase64: string }): Promise<AssetSaveResult>;
  copyAsset(request: { docDir: string; sourcePath: string }): Promise<AssetSaveResult>;
  pickAsset(docDir: string): Promise<AssetPickResult>;
  /** 拖拽文件 → 绝对路径（Electron webUtils） */
  getPathForFile(file: File): string;

  // ---- 工作区 ----
  openFolderDialog(): Promise<OpenFolderResult>;
  setWorkspaceRoot(root: string | null): Promise<SettingsResult>;
  readDir(dir: string): Promise<ReadDirResult>;
  createEntry(request: { parent: string; name: string; kind: 'file' | 'dir' }): Promise<{ path: string }>;
  renameEntry(request: { path: string; name: string }): Promise<{ path: string }>;
  deleteEntry(path: string): Promise<{ ok: boolean }>;
  moveEntry(request: { from: string; toDir: string }): Promise<{ path: string }>;
  reveal(path: string): Promise<{ ok: boolean }>;
  onWorkspaceChanged(callback: (batch: WorkspaceChangedBatch) => void): Unsubscribe;

  // ---- 设置 / 键位 / 主题 ----
  getSettings(): Promise<SettingsResult>;
  updateSettings(patch: SettingsPatch): Promise<SettingsResult>;
  onSettingsChanged(callback: (result: SettingsResult) => void): Unsubscribe;
  getKeymap(): Promise<KeymapResult>;
  updateKeymap(bindings: Record<string, string[]>): Promise<KeymapResult>;
  onKeymapChanged(callback: (result: KeymapResult) => void): Unsubscribe;
  listThemes(): Promise<ThemeListResult>;
  readTheme(fileName: string): Promise<ThemeReadResult>;
  onThemesChanged(callback: (result: ThemeListResult) => void): Unsubscribe;

  // ---- 草稿 / 恢复 ----
  saveDraft(request: { id: string; path: string | null; name: string; content: string }): Promise<{ ok: boolean }>;
  clearDraft(id: string): Promise<{ ok: boolean }>;
  listDrafts(): Promise<{ drafts: DraftMeta[] }>;
  readDraft(id: string): Promise<{ draft: DraftRecord | null }>;
  discardDrafts(id?: string): Promise<{ ok: boolean }>;

  // ---- 搜索 ----
  startSearch(request: { root: string; query: string; mode: SearchMode; caseSensitive?: boolean }): Promise<{ id: number }>;
  cancelSearch(): Promise<{ ok: boolean }>;
  onSearchBatch(callback: (event: SearchBatchEvent) => void): Unsubscribe;
  onSearchDone(callback: (event: SearchDoneEvent) => void): Unsubscribe;

  // ---- 导出 ----
  exportHtml(request: { html: string; suggestedName: string; targetPath?: string }): Promise<ExportResult>;
  exportPdf(request: ExportPdfOptions): Promise<ExportResult>;
  exportText(request: ExportTextOptions): Promise<ExportResult>;
  exportImage(request: ExportImageOptions): Promise<ExportImageResult>;

  // ---- 视图控制 / 打印 / 上下文菜单 ----
  setZoom(level: number): Promise<ZoomResult>;
  setFullScreen(on: boolean): Promise<{ ok: boolean; on: boolean }>;
  setAlwaysOnTop(on: boolean): Promise<{ ok: boolean; on: boolean }>;
  print(request: { html: string; suggestedName: string }): Promise<PrintResult>;
  onContextMenu(callback: (event: ContextMenuEvent) => void): Unsubscribe;
  replaceMisspelling(word: string): Promise<{ ok: boolean }>;
  editAction(action: EditActionName): Promise<{ ok: boolean }>;

  // ---- 剪贴板 ----
  writeClipboard(request: ClipboardWriteRequest): Promise<{ ok: boolean }>;
  readClipboard(): Promise<ClipboardReadResult>;

  // ---- 文件操作补全 ----
  renameFile(request: { path: string; name: string }): Promise<{ ok: boolean; path?: string; error?: string }>;
  deleteFile(path: string): Promise<{ ok: boolean; error?: string }>;

  // ---- 版本快照 ----
  listHistory(path: string): Promise<HistoryListResult>;
  readHistory(request: { path: string; id: string }): Promise<HistoryReadResult>;
  snapshot(request: { path: string; content: string }): Promise<{ ok: boolean; created: boolean }>;

  // ---- Pandoc ----
  pandocStatus(): Promise<PandocStatusResult>;
  pandocExport(request: PandocExportRequest): Promise<ExportResult>;
  pandocImport(request: { path?: string }): Promise<PandocImportResult>;

  // ---- 应用控制 ----
  startupInfo(): Promise<StartupInfo>;
  onCommand(callback: (event: CommandRunEvent) => void): Unsubscribe;
  newWindow(): Promise<{ ok: boolean }>;
  closeWindow(): Promise<{ ok: boolean }>;
  showAbout(): Promise<{ ok: boolean }>;
  setDirty(dirty: boolean): Promise<{ ok: boolean }>;
  confirmClose(ok: boolean): Promise<{ ok: boolean }>;
  log(level: LogLevel, message: string): Promise<{ ok: boolean }>;
  openExternal(url: string): Promise<{ ok: boolean }>;
}

export type { DirEntry, Settings, SettingsPatch, KeyConflict, KeymapOverrides, ThemeMeta };
