import { readdir, readFile, stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { basename, join } from 'node:path';
import type { SearchItem, SearchMode } from '../shared/channels';
import { IGNORED_DIRS } from './workspace';
import {
  clearContentCache,
  contentCacheStats,
  invalidateContentCachePath,
  isTrustedPath,
  lookupContent,
  lookupContentTrusted,
  setTrustedRoot,
  storeContent
} from './content-cache';
import { logMain } from './logger';

export {
  clearContentCache,
  contentCacheStats,
  invalidateContentCachePath,
  setTrustedRoot
};

export interface SearchOptions {
  root: string;
  query: string;
  mode: SearchMode;
  caseSensitive?: boolean;
}

export interface SearchHooks {
  onBatch(items: SearchItem[], state: { scannedFiles: number; matchCount: number }): void;
  isCanceled(): boolean;
}

export interface SearchSummary {
  files: number;
  matches: number;
  elapsedMs: number;
  truncated: boolean;
  canceled: boolean;
}

const MAX_RESULTS = 2000;
const MAX_PER_FILE = 50;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const BATCH_SIZE = 40;
const BATCH_INTERVAL_MS = 60;
const SNIPPET_MAX = 200;
const MAX_FILES = 200_000;

/** 有界并发度（REQ-034）：文件名模式 8 路上限，低核机器按核心数收缩。 */
export const SEARCH_CONCURRENCY = Math.max(2, Math.min(8, availableParallelism?.() ?? 4));

/** 目录遍历并发度（B5-4）：受核数约束，避免大量 opendir 互相抢带宽。 */
export const DIR_CONCURRENCY = Math.max(2, Math.min(8, availableParallelism?.() ?? 4));
const MAX_DIR_CONCURRENCY = 16;

/**
 * 内容模式的并发度：每个文件是「stat + 读」两次短延迟 I/O，
 * 上限抬高到 16（仍受核数 ×2 约束）可以把 10k 文件的缓存命中扫描压进 1 s。
 */
export const CONTENT_CONCURRENCY = Math.max(4, Math.min(16, (availableParallelism?.() ?? 4) * 2));

const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'pdf',
  'zip',
  'exe',
  'dll',
  'woff',
  'woff2',
  'ttf'
]);

export interface ContentMatch {
  line: number;
  column: number;
  text: string;
}

/** 单文件内容扫描（纯函数，供测试）。 */
export function scanContentMatches(content: string, query: string, caseSensitive = false): ContentMatch[] {
  const matches: ContentMatch[] = [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const lines = content.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const haystack = caseSensitive ? line : line.toLowerCase();
    let from = 0;
    for (;;) {
      const position = haystack.indexOf(needle, from);
      if (position < 0) break;
      const text = line.length > SNIPPET_MAX ? `${line.slice(0, SNIPPET_MAX)}…` : line;
      matches.push({ line: index + 1, column: position + 1, text });
      if (matches.length >= MAX_PER_FILE) return matches;
      from = position + Math.max(1, needle.length);
    }
  }
  return matches;
}

function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 4096);
  for (let index = 0; index < limit; index++) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

/**
 * 广度遍历收集文件路径（跳过忽略目录、符号链接与非普通文件）。
 *
 * 目录读取按 `concurrency` 并行（B5-4）：Windows 上逐个 `opendir` 会因单线程往返抖动，
 * 深层且目录多的树这一点比文件读取量更明显。共享游标 + `pending` 计数保证
 * 「有任务在跑就继续等」，不会因某个 worker 先看到空队列而提前结束。
 */
export async function collectFiles(
  root: string,
  shouldStop: () => boolean = () => false,
  concurrency: number = DIR_CONCURRENCY
): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [root];
  let cursor = 0;
  let pending = 0;
  const waiters: (() => void)[] = [];
  const notify = (): void => {
    for (const wake of waiters.splice(0, waiters.length)) wake();
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (shouldStop() || files.length >= MAX_FILES) return;
      if (cursor >= queue.length) {
        // 可能还有别的 worker 正在读目录，它们会往队列里追加子目录
        if (pending === 0) return;
        await new Promise<void>((resolve) => waiters.push(resolve));
        continue;
      }
      const dir = queue[cursor++] as string;
      pending += 1;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        if (shouldStop() || files.length >= MAX_FILES) return;
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue;
            queue.push(join(dir, entry.name));
            continue;
          }
          if (entry.isFile()) files.push(join(dir, entry.name));
        }
      } catch {
        // 目录在遍历期间被删除/无权限：跳过
      } finally {
        pending -= 1;
        notify();
      }
    }
  };

  const workers = Math.max(1, Math.min(concurrency, MAX_DIR_CONCURRENCY));
  await Promise.all(Array.from({ length: workers }, worker));
  return files;
}

/** 遍历目录并搜索（有界并发、可取消、分批回调）。 */
export async function searchDirectory(options: SearchOptions, hooks: SearchHooks): Promise<SearchSummary> {
  const started = Date.now();
  const caseSensitive = options.caseSensitive ?? false;
  const needle = caseSensitive ? options.query : options.query.toLowerCase();
  const items: SearchItem[] = [];
  let scannedFiles = 0;
  let matchCount = 0;
  let truncated = false;
  let cacheHits = 0;
  let lastFlush = Date.now();

  const flush = (force: boolean): void => {
    if (items.length === 0) return;
    const now = Date.now();
    if (!force && items.length < BATCH_SIZE && now - lastFlush < BATCH_INTERVAL_MS) return;
    const batch = items.splice(0, items.length);
    lastFlush = now;
    hooks.onBatch(batch, { scannedFiles, matchCount });
  };

  const files = await collectFiles(options.root, () => hooks.isCanceled() || truncated);
  let cursor = 0;

  const processFile = async (path: string): Promise<void> => {
    scannedFiles += 1;
    const name = basename(path);
    if (options.mode === 'name') {
      const haystack = caseSensitive ? name : name.toLowerCase();
      if (haystack.includes(needle)) {
        matchCount += 1;
        items.push({ path, name, kind: 'name' });
      }
      return;
    }
    const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    if (BINARY_EXTENSIONS.has(extension)) return;
    try {
      // 已被监听的根目录：跳过 stat，直接复用正文（新鲜度由监听事件与保存钩子失效）
      const trusted = isTrustedPath(path);
      let text = trusted ? lookupContentTrusted(path) : null;
      let cacheHit = text !== null;
      if (text === null) {
        const info = await stat(path);
        if (info.size > MAX_FILE_BYTES) return;
        if (!trusted) text = lookupContent(path, info.mtimeMs, info.size);
        cacheHit = text !== null;
        if (text === null) {
          const buffer = await readFile(path);
          if (looksBinary(buffer)) return;
          text = buffer.toString('utf8');
          storeContent(path, info.mtimeMs, info.size, text);
        }
      }
      if (cacheHit) cacheHits += 1;
      const matches = scanContentMatches(text, options.query, caseSensitive);
      for (const match of matches) {
        matchCount += 1;
        items.push({
          path,
          name,
          kind: 'content',
          line: match.line,
          column: match.column,
          text: match.text
        });
      }
    } catch {
      // 单个文件读取失败不影响整体搜索
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (hooks.isCanceled() || truncated) return;
      const index = cursor;
      cursor += 1;
      const path = files[index];
      if (path === undefined) return;
      await processFile(path);
      if (matchCount >= MAX_RESULTS) {
        truncated = true;
        return;
      }
      flush(false);
    }
  };

  const limit = options.mode === 'content' ? CONTENT_CONCURRENCY : SEARCH_CONCURRENCY;
  const workers = Math.max(1, Math.min(limit, files.length));
  await Promise.all(Array.from({ length: workers }, worker));
  flush(true);

  const canceled = hooks.isCanceled();
  const summary: SearchSummary = {
    files: scannedFiles,
    matches: matchCount,
    elapsedMs: Date.now() - started,
    truncated,
    canceled
  };
  logMain(
    'info',
    `搜索完成：${options.query} → ${matchCount} 处 / ${scannedFiles} 文件 / ${summary.elapsedMs} ms（并发 ${workers}，内容缓存命中 ${cacheHits}）`
  );
  return summary;
}
