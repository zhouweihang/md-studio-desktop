import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { shell } from 'electron';
import { watch, type FSWatcher } from 'chokidar';
import type { DirEntry, ReadDirResult, WorkspaceChangedEvent } from '../shared/channels';
import { invalidateContentCachePath, setTrustedRoot } from './content-cache';
import { logMain } from './logger';

export const IGNORED_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.cache', 'dist', 'out']);
const MAX_ENTRIES = 5000;
const WATCH_DEBOUNCE_MS = 150;

function sortEntries(entries: DirEntry[]): DirEntry[] {
  return entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
    return left.name.localeCompare(right.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });
}

export async function readDir(dir: string): Promise<ReadDirResult> {
  const dirents = await readdir(dir, { withFileTypes: true });
  const entries: DirEntry[] = [];
  let truncated = false;
  for (const dirent of dirents) {
    if (dirent.isDirectory() && IGNORED_DIRS.has(dirent.name)) continue;
    const path = join(dir, dirent.name);
    let size = 0;
    let mtimeMs = 0;
    try {
      const info = await stat(path);
      size = info.size;
      mtimeMs = info.mtimeMs;
    } catch {
      continue; // 读取瞬间被删除/无权限 → 跳过
    }
    entries.push({
      name: dirent.name,
      path,
      kind: dirent.isDirectory() ? 'dir' : 'file',
      size,
      mtimeMs
    });
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
  }
  return { dir, entries: sortEntries(entries), truncated };
}

function assertSimpleName(name: string): void {
  if (!name.trim() || /[\\/]/.test(name) || name === '.' || name === '..') {
    throw new Error('名称不合法，不能包含路径分隔符');
  }
}

export async function createEntry(parent: string, name: string, kind: 'file' | 'dir'): Promise<string> {
  assertSimpleName(name);
  const path = join(parent, name);
  try {
    await stat(path);
    throw new Error(`已存在同名${kind === 'dir' ? '文件夹' : '文件'}：${name}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (kind === 'dir') await mkdir(path, { recursive: false });
  else await writeFile(path, '', 'utf8');
  return path;
}

export async function renameEntry(path: string, name: string): Promise<string> {
  assertSimpleName(name);
  const target = join(dirname(path), name);
  if (target === path) return path;
  try {
    await stat(target);
    throw new Error(`已存在同名项：${name}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await rename(path, target);
  return target;
}

export async function deleteEntry(path: string): Promise<void> {
  try {
    await shell.trashItem(path);
  } catch {
    await rm(path, { recursive: true, force: true });
  }
}

export async function moveEntry(from: string, toDir: string): Promise<string> {
  const target = join(toDir, basename(from));
  if (target === from) return from;
  if (toDir === from || toDir.startsWith(`${from}/`) || toDir.startsWith(`${from}\\`)) {
    throw new Error('不能把文件夹移动到自身内部');
  }
  try {
    await stat(target);
    throw new Error(`目标位置已存在同名项：${basename(from)}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    await rename(from, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyRecursive(from, target);
    await rm(from, { recursive: true, force: true });
  }
  return target;
}

async function copyRecursive(from: string, to: string): Promise<void> {
  const info = await stat(from);
  if (info.isDirectory()) {
    await mkdir(to, { recursive: true });
    const dirents = await readdir(from, { withFileTypes: true });
    for (const dirent of dirents) {
      await copyRecursive(join(from, dirent.name), join(to, dirent.name));
    }
    return;
  }
  await copyFile(from, to);
}

/** 图片落盘（REQ-006）：写入文档同目录的 assets 子目录，返回 {相对路径, 绝对路径}。 */
export async function saveAsset(
  docDir: string,
  fileName: string,
  data: Buffer
): Promise<{ relativePath: string; absolutePath: string }> {
  const assetsDir = join(docDir, 'assets');
  await mkdir(assetsDir, { recursive: true });
  const safeName = basename(fileName).replace(/[\\/:*?"<>|]/g, '_');
  let target = join(assetsDir, safeName);
  const dot = safeName.lastIndexOf('.');
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const ext = dot > 0 ? safeName.slice(dot) : '';
  let counter = 1;
  for (;;) {
    try {
      await stat(target);
      target = join(assetsDir, `${stem}-${counter}${ext}`);
      counter += 1;
    } catch {
      break;
    }
  }
  await writeFile(target, data);
  return { relativePath: `./assets/${basename(target)}`, absolutePath: target };
}

/** 从磁盘复制图片到 assets（选择图片命令用）。 */
export async function copyAsset(
  docDir: string,
  sourcePath: string
): Promise<{ relativePath: string; absolutePath: string }> {
  const data = await readFile(sourcePath);
  return saveAsset(docDir, basename(sourcePath), data);
}

/** 目录监听（REQ-009）：事件去抖合并后交给回调。 */
export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null;
  private root: string | null = null;
  private buffer: WorkspaceChangedEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onEvents: (events: WorkspaceChangedEvent[]) => void) {}

  setRoot(root: string | null): void {
    if (root === this.root) return;
    void this.close();
    this.root = root;
    // 只有真正挂上监听后才允许搜索跳过 stat 校验（见 content-cache）
    setTrustedRoot(null);
    if (!root) return;
    this.watcher = watch(root, {
      ignoreInitial: true,
      depth: 12,
      ignored: (path: string) => [...IGNORED_DIRS].some((dir) => path.includes(`${dir}`)),
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
    });
    const push = (event: WorkspaceChangedEvent['event']) => (path: string) => this.push({ event, path });
    this.watcher.on('add', push('add'));
    this.watcher.on('change', push('change'));
    this.watcher.on('unlink', push('unlink'));
    this.watcher.on('addDir', push('addDir'));
    this.watcher.on('unlinkDir', push('unlinkDir'));
    this.watcher.on('error', (error) => logMain('warn', `目录监听错误：${String(error)}`));
    this.watcher.on('ready', () => setTrustedRoot(root));
    logMain('info', `开始监听工作区：${root}`);
  }

  getRoot(): string | null {
    return this.root;
  }

  private push(event: WorkspaceChangedEvent): void {
    // 监听是搜索内容缓存的新鲜度来源：任何变化先失效，避免命中过期正文
    invalidateContentCachePath(event.path);
    this.buffer.push(event);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const events = this.buffer;
      this.buffer = [];
      if (events.length > 0) this.onEvents(events);
    }, WATCH_DEBOUNCE_MS);
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = [];
    if (this.watcher) {
      const watcher = this.watcher;
      this.watcher = null;
      setTrustedRoot(null);
      await watcher.close().catch(() => undefined);
    }
  }
}
