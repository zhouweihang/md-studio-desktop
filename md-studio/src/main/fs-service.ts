import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { BrowserWindow, dialog } from 'electron';

type OpenDialogOptions = Parameters<typeof dialog.showOpenDialog>[0];
type OpenDialogResult = Awaited<ReturnType<typeof dialog.showOpenDialog>>;
type SaveDialogOptions = Parameters<typeof dialog.showSaveDialog>[0];
type SaveDialogResult = Awaited<ReturnType<typeof dialog.showSaveDialog>>;
type MessageBoxOptions = Electron.MessageBoxOptions;
type MessageBoxResult = Awaited<ReturnType<typeof dialog.showMessageBox>>;

/** 无父窗口时不能传 undefined，按有无 parent 分支调用。 */
export async function showOpenDialog(parent: BrowserWindow | null, options: OpenDialogOptions): Promise<OpenDialogResult> {
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
}

export async function showSaveDialog(parent: BrowserWindow | null, options: SaveDialogOptions): Promise<SaveDialogResult> {
  return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options);
}

export async function showMessageBox(parent: BrowserWindow | null, options: MessageBoxOptions): Promise<MessageBoxResult> {
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}
import type {
  ConflictChoice,
  OpenFileResult,
  OpenFolderResult,
  SaveFileAsResult,
  SaveFileResult
} from '../shared/channels';
import { t } from '../shared/i18n';
import type { SaveFileAsRequest, SaveFileRequest } from '../shared/ipc';
import { invalidateContentCachePath } from './content-cache';
import { settingsStore } from './settings';

const MTIME_TOLERANCE_MS = 2;

export interface FileInfo {
  content: string;
  mtimeMs: number;
}

export async function readTextFile(path: string): Promise<FileInfo> {
  const [content, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
  return { content, mtimeMs: info.mtimeMs };
}

/** 临时文件 + rename 覆盖，避免半写状态（RFC §4.4）。 */
export async function writeTextAtomic(path: string, content: string): Promise<number> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.mdstudio-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
  // 监听事件要等 awaitWriteFinish（~300 ms）才到，保存后立刻搜索不能读到旧正文
  invalidateContentCachePath(path);
  const info = await stat(path);
  return info.mtimeMs;
}

/** 写入前比对 mtime；发现外部修改且未强制覆盖时返回冲突。 */
export async function saveFileChecked(request: SaveFileRequest): Promise<SaveFileResult> {
  try {
    if (!request.force && request.mtimeMs !== undefined) {
      try {
        const info = await stat(request.path);
        if (Math.abs(info.mtimeMs - request.mtimeMs) > MTIME_TOLERANCE_MS) {
          return { ok: false, conflict: true, diskMtimeMs: info.mtimeMs };
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const mtimeMs = await writeTextAtomic(request.path, request.content);
    return { ok: true, mtimeMs };
  } catch (error) {
    return { ok: false, conflict: false, error: (error as Error).message };
  }
}

export async function openFileDialog(parent: BrowserWindow | null): Promise<OpenFileResult> {
  const result = await showOpenDialog(parent, {
    title: '打开 Markdown 文件',
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] },
      { name: '全部文件', extensions: ['*'] }
    ]
  });
  const path = result.filePaths[0];
  if (result.canceled || !path) return { canceled: true };
  return openPath(path);
}

export async function openPath(path: string): Promise<OpenFileResult> {
  try {
    const info = await readTextFile(path);
    return { canceled: false, path, content: info.content, mtimeMs: info.mtimeMs };
  } catch (error) {
    return { canceled: false, error: `无法打开文件：${(error as Error).message}` };
  }
}

export async function openFolderDialog(parent: BrowserWindow | null): Promise<OpenFolderResult> {
  const result = await showOpenDialog(parent, {
    title: '打开文件夹',
    properties: ['openDirectory']
  });
  const root = result.filePaths[0];
  if (result.canceled || !root) return { canceled: true };
  return { canceled: false, root };
}

export async function saveAsDialog(parent: BrowserWindow | null, request: SaveFileAsRequest): Promise<SaveFileAsResult> {
  let target = request.targetPath;
  if (!target) {
    const result = await showSaveDialog(parent, {
      title: '另存为',
      defaultPath: request.suggestedName || '未命名.md',
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    target = result.filePath;
  }
  try {
    const mtimeMs = await writeTextAtomic(target, request.content);
    return { canceled: false, path: target, mtimeMs };
  } catch (error) {
    return { canceled: false, error: `保存失败：${(error as Error).message}` };
  }
}

/** 保存冲突三选一（重载 / 另存为 / 强制覆盖）——RFC §5。 */
export async function askConflictChoice(
  parent: BrowserWindow | null,
  request: { path: string; suggestedName?: string }
): Promise<ConflictChoice> {
  const locale = settingsStore.get().language;
  const { response } = await showMessageBox(parent, {
    type: 'warning',
    title: t('dialog.conflict.title', undefined, locale),
    message: `${request.path}`,
    detail:
      locale === 'en'
        ? 'Overwriting discards the external changes; you can also reload from disk or save as a new file.'
        : '直接覆盖会丢失外部改动；也可以重新载入磁盘内容，或另存为新文件。',
    buttons: [
      t('dialog.conflict.reload', undefined, locale),
      t('dialog.conflict.saveAs', undefined, locale),
      t('dialog.conflict.overwrite', undefined, locale),
      t('dialog.cancel', undefined, locale)
    ],
    defaultId: 0,
    cancelId: 3,
    noLink: true
  });
  if (response === 0) return 'reload';
  if (response === 1) return 'save-as';
  if (response === 2) return 'overwrite';
  return 'cancel';
}
