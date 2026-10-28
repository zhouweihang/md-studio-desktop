/**
 * 本地版本快照（REQ-030）：保存时把内容留一份到 `userData/history/<hash>/`。
 *
 * 规则：
 * - 与最新快照内容相同 → 不新增（避免空转）；
 * - 每个文件最多保留 `HISTORY_LIMIT` 份，超出按时间裁剪；
 * - 快照失败只记日志，不影响保存主流程。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HistoryEntry } from '../shared/channels';
import { logMain } from './logger';

export const HISTORY_LIMIT = 50;

export class HistoryStore {
  private root: string | null = null;

  init(userDataDir: string): void {
    this.root = join(userDataDir, 'history');
  }

  private dirFor(path: string): string {
    const hash = createHash('sha1').update(path).digest('hex').slice(0, 16);
    return join(this.root ?? '', hash);
  }

  async list(path: string): Promise<HistoryEntry[]> {
    if (!this.root) return [];
    const dir = this.dirFor(path);
    try {
      const files = await readdir(dir);
      const entries: HistoryEntry[] = [];
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const info = await stat(join(dir, file)).catch(() => null);
        if (!info) continue;
        entries.push({ id: file, savedAt: Number(file.replace(/\.md$/, '')) || info.mtimeMs, size: info.size });
      }
      return entries.sort((left, right) => right.savedAt - left.savedAt);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logMain('warn', `历史快照列举失败：${(error as Error).message}`);
      }
      return [];
    }
  }

  async read(path: string, id: string): Promise<string | null> {
    if (!this.root) return null;
    if (!/^[\d]+\.md$/.test(id)) return null;
    try {
      return await readFile(join(this.dirFor(path), id), 'utf8');
    } catch {
      return null;
    }
  }

  /** 写入快照；内容与最新一份相同则跳过。 */
  async snapshot(path: string, content: string): Promise<{ ok: boolean; created: boolean }> {
    if (!this.root) return { ok: false, created: false };
    const dir = this.dirFor(path);
    try {
      await mkdir(dir, { recursive: true });
      const entries = await this.list(path);
      const latest = entries[0];
      if (latest) {
        const previous = await this.read(path, latest.id);
        if (previous === content) return { ok: true, created: false };
      }
      const id = `${Date.now()}.md`;
      await writeFile(join(dir, id), content, 'utf8');
      await this.prune(path);
      return { ok: true, created: true };
    } catch (error) {
      logMain('warn', `历史快照写入失败：${(error as Error).message}`);
      return { ok: false, created: false };
    }
  }

  /** 超出上限的旧快照删除。 */
  async prune(path: string): Promise<number> {
    if (!this.root) return 0;
    const entries = await this.list(path);
    if (entries.length <= HISTORY_LIMIT) return 0;
    const doomed = entries.slice(HISTORY_LIMIT);
    const dir = this.dirFor(path);
    let removed = 0;
    for (const entry of doomed) {
      await rm(join(dir, entry.id), { force: true }).catch(() => undefined);
      removed += 1;
    }
    return removed;
  }
}

export const historyStore = new HistoryStore();
