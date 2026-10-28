import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DraftMeta, DraftRecord } from '../shared/channels';
import { draftIdFor } from '../shared/draft-id';
import { logMain } from './logger';

interface SessionRecord {
  clean: boolean;
  startedAt: number;
}

interface DraftFile {
  id: string;
  path: string | null;
  name: string;
  content: string;
  updatedAt: number;
}

/** userData/session.json（上一次是否正常退出）+ userData/drafts/*.json。 */
export class DraftStore {
  private draftsDir: string | null = null;
  private sessionFile: string | null = null;
  private previousRunClean = true;

  init(userDataDir: string): void {
    this.draftsDir = join(userDataDir, 'drafts');
    this.sessionFile = join(userDataDir, 'session.json');
  }

  /** 读取上一次退出状态并写入「运行中」标记。 */
  async beginSession(): Promise<void> {
    if (!this.sessionFile) return;
    try {
      const raw = await readFile(this.sessionFile, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SessionRecord>;
      this.previousRunClean = parsed.clean !== false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logMain('warn', `会话文件读取失败：${(error as Error).message}`);
      }
      this.previousRunClean = true;
    }
    await this.writeJson(this.sessionFile, { clean: false, startedAt: Date.now() } satisfies SessionRecord);
  }

  previousSessionCrashed(): boolean {
    return !this.previousRunClean;
  }

  /** 正常退出时调用。 */
  async endSession(): Promise<void> {
    if (!this.sessionFile) return;
    await this.writeJson(this.sessionFile, { clean: true, startedAt: Date.now() } satisfies SessionRecord);
  }

  draftId(path: string | null): string {
    return draftIdFor(path);
  }

  async save(id: string, path: string | null, name: string, content: string): Promise<void> {
    if (!this.draftsDir) return;
    await mkdir(this.draftsDir, { recursive: true });
    const record: DraftFile = { id, path, name, content, updatedAt: Date.now() };
    await this.writeJson(join(this.draftsDir, `${id}.json`), record);
  }

  async read(id: string): Promise<DraftRecord | null> {
    if (!this.draftsDir) return null;
    try {
      const raw = await readFile(join(this.draftsDir, `${id}.json`), 'utf8');
      const parsed = JSON.parse(raw) as Partial<DraftFile>;
      return {
        id,
        path: parsed.path ?? null,
        name: parsed.name ?? '未命名',
        content: parsed.content ?? '',
        updatedAt: parsed.updatedAt ?? 0,
        size: (parsed.content ?? '').length
      };
    } catch {
      return null;
    }
  }

  async clear(id: string): Promise<void> {
    if (!this.draftsDir) return;
    await rm(join(this.draftsDir, `${id}.json`), { force: true }).catch(() => undefined);
  }

  async list(): Promise<DraftMeta[]> {
    if (!this.draftsDir) return [];
    let names: string[] = [];
    try {
      names = await readdir(this.draftsDir);
    } catch {
      return [];
    }
    const result: DraftMeta[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const record = await this.read(name.replace(/\.json$/, ''));
      if (!record) continue;
      result.push({
        id: record.id,
        path: record.path,
        name: record.name,
        updatedAt: record.updatedAt,
        size: record.size
      });
    }
    return result.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async discardAll(): Promise<void> {
    if (!this.draftsDir) return;
    let names: string[] = [];
    try {
      names = await readdir(this.draftsDir);
    } catch {
      return;
    }
    await Promise.all(names.map((name) => rm(join(this.draftsDir ?? '', name), { force: true }).catch(() => undefined)));
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    const temporary = `${file}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value), 'utf8');
      await rename(temporary, file);
    } catch (error) {
      logMain('warn', `草稿写入失败：${(error as Error).message}`);
    }
  }
}

export const draftStore = new DraftStore();
