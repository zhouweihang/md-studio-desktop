import { mkdir, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { ThemeReadResult } from '../shared/channels';
import { THEME_MAX_BYTES, parseThemeMeta, type ThemeMeta } from '../shared/theme-meta';
import { logMain } from './logger';

/** userData/themes/*.css 的列表、读取与热加载。 */
export class ThemeStore {
  private dir: string | null = null;
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  init(userDataDir: string): void {
    this.dir = join(userDataDir, 'themes');
  }

  async ensureDir(): Promise<void> {
    if (!this.dir) return;
    await mkdir(this.dir, { recursive: true }).catch(() => undefined);
  }

  async list(): Promise<ThemeMeta[]> {
    if (!this.dir) return [];
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const themes: ThemeMeta[] = [];
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.css')) continue;
      try {
        const css = await readFile(join(this.dir, name), 'utf8');
        themes.push(parseThemeMeta(css, name));
      } catch (error) {
        logMain('warn', `主题读取失败 ${name}：${(error as Error).message}`);
      }
    }
    return themes.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
  }

  async read(fileName: string): Promise<ThemeReadResult> {
    const safeName = basename(fileName);
    if (safeName !== fileName || !safeName.toLowerCase().endsWith('.css')) {
      throw new Error('非法的主题文件名');
    }
    const css = await readFile(join(this.dir ?? '', safeName), 'utf8');
    if (css.length > THEME_MAX_BYTES) throw new Error('主题文件超过 512 KB 上限');
    return { meta: parseThemeMeta(css, safeName), css };
  }

  /** 目录变化（新建/修改/删除）去抖后回调，用于热加载。 */
  startWatching(onChange: () => void): void {
    if (!this.dir || this.watcher) return;
    this.watcher = watch(this.dir, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
    });
    const trigger = (): void => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        onChange();
      }, 300);
    };
    this.watcher.on('add', trigger);
    this.watcher.on('change', trigger);
    this.watcher.on('unlink', trigger);
    this.watcher.on('error', (error) => logMain('warn', `主题目录监听错误：${String(error)}`));
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.watcher) {
      const watcher = this.watcher;
      this.watcher = null;
      await watcher.close().catch(() => undefined);
    }
  }
}

export const themeStore = new ThemeStore();
