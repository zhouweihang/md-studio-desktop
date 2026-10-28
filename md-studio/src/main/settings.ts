import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings, type Settings } from '../shared/settings';
import { logMain } from './logger';

/** userData/settings.json 的读写（去抖 + 原子写）。 */
export class SettingsStore {
  private data: Settings = sanitizeSettings(DEFAULT_SETTINGS);
  private filePath: string | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  init(userDataDir: string): void {
    this.filePath = join(userDataDir, 'settings.json');
  }

  async load(): Promise<Settings> {
    if (!this.filePath) return this.data;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.data = sanitizeSettings(JSON.parse(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logMain('warn', `设置读取失败，回退默认值：${(error as Error).message}`);
      }
      this.data = sanitizeSettings(DEFAULT_SETTINGS);
    }
    return this.data;
  }

  get(): Settings {
    return this.data;
  }

  async update(patch: unknown): Promise<Settings> {
    this.data = mergeSettings(this.data, patch);
    this.scheduleWrite();
    return this.data;
  }

  private scheduleWrite(): void {
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = null;
      this.writeChain = this.writeChain.then(() => this.writeNow()).catch(() => undefined);
    }, 250);
  }

  private async writeNow(): Promise<void> {
    if (!this.filePath) return;
    const temporary = `${this.filePath}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(this.data, null, 2), 'utf8');
      await rename(temporary, this.filePath);
    } catch (error) {
      logMain('warn', `设置写入失败：${(error as Error).message}`);
    }
  }

  /** 退出前冲刷未落盘的写入。 */
  async flush(): Promise<void> {
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
    await this.writeChain;
    await this.writeNow();
  }
}

export const settingsStore = new SettingsStore();
