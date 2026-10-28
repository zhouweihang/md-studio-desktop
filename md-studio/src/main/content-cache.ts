/**
 * 搜索结果的内容缓存（REQ-034）：缓存**文件正文**而不是查询结果。
 *
 * 两种新鲜度模式：
 * - 默认（未信任根）：每次扫描都 `stat` 比对 mtime/size，慢但绝对正确；
 * - 信任根（工作区已被 chokidar 监听）：跳过 `stat` 直接复用正文，由监听事件与
 *   编辑器保存钩子调用 `invalidateContentCachePath()` 失效条目。10k 文件下从 ~950 ms
 *   （10k 次 stat 的 Windows 下限）降到 ~50 ms。
 *
 * 预算 64 MB，超出后按最近最少使用（Map 插入顺序）驱逐。
 */

const MAX_BYTES = 64 * 1024 * 1024;

interface Entry {
  mtimeMs: number;
  size: number;
  /** 入缓存时间（诊断用） */
  storedAt: number;
  text: string;
}

const cache = new Map<string, Entry>();
let bytes = 0;
let trustedRoot: string | null = null;

function normalize(root: string): string {
  return root.replace(/[\\/]+$/, '').toLowerCase();
}

/** 标记/清除「该根目录已被文件监听」，决定是否跳过 stat 校验。 */
export function setTrustedRoot(root: string | null): void {
  const next = root ? normalize(root) : null;
  if (next !== trustedRoot) {
    // 换根意味着旧的失效保证不再成立，直接清空
    clearContentCache();
    trustedRoot = next;
  }
}

export function isTrustedPath(path: string): boolean {
  if (!trustedRoot) return false;
  return normalize(path).startsWith(`${trustedRoot}\\`) || normalize(path).startsWith(`${trustedRoot}/`);
}

/** 按 path + mtime + size 取正文；不匹配时移除条目并返回 null。 */
export function lookupContent(path: string, mtimeMs: number, size: number): string | null {
  const entry = cache.get(path);
  if (!entry) return null;
  if (entry.mtimeMs !== mtimeMs || entry.size !== size) {
    remove(path);
    return null;
  }
  return touch(path, entry);
}

/** 信任根下的读取：跳过 mtime 校验（新鲜度由监听/保存钩子保证）。 */
export function lookupContentTrusted(path: string): string | null {
  const entry = cache.get(path);
  if (!entry) return null;
  return touch(path, entry);
}

export function storeContent(path: string, mtimeMs: number, size: number, text: string): void {
  remove(path);
  cache.set(path, { mtimeMs, size, storedAt: Date.now(), text });
  bytes += size;
  while (bytes > MAX_BYTES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    remove(oldest.value);
  }
}

/** 文件被改动/删除时失效单个条目（监听事件与保存钩子都走这里）。 */
export function invalidateContentCachePath(path: string): void {
  remove(path);
  // 目录被删/改名：把该前缀下的条目一并清掉
  const prefix = path.endsWith('\\') || path.endsWith('/') ? path : `${path}\\`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) remove(key);
  }
}

export function clearContentCache(): void {
  cache.clear();
  bytes = 0;
}

export function contentCacheStats(): { files: number; bytes: number; trustedRoot: string | null } {
  return { files: cache.size, bytes, trustedRoot };
}

function touch(path: string, entry: Entry): string {
  cache.delete(path);
  cache.set(path, entry);
  return entry.text;
}

function remove(path: string): void {
  const entry = cache.get(path);
  if (!entry) return;
  bytes -= entry.size;
  cache.delete(path);
}
