import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import defaultKeymap from '../shared/keymap/default.json';
import { COMMANDS } from '../shared/commands';
import {
  parseUserKeymap,
  resolveKeymap,
  type KeymapFile,
  type KeymapOverrides,
  type ResolvedKeymap
} from '../shared/keymap';
import { logMain } from './logger';

const KNOWN_COMMANDS = new Set(COMMANDS.map((command) => command.id));

/** userData/keymap.json（用户覆盖）的读写与解析。 */
export class KeymapStore {
  private overrides: KeymapOverrides = {};
  private resolved: ResolvedKeymap;
  private filePath: string | null = null;

  constructor() {
    this.resolved = resolveKeymap(defaultKeymap as KeymapFile, null);
  }

  init(userDataDir: string): void {
    this.filePath = join(userDataDir, 'keymap.json');
  }

  async load(): Promise<ResolvedKeymap> {
    if (!this.filePath) return this.resolved;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.overrides = this.filterKnown(parseUserKeymap(JSON.parse(raw) as unknown));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logMain('warn', `键位文件读取失败，使用默认键位：${(error as Error).message}`);
      }
    }
    this.resolved = resolveKeymap(defaultKeymap as KeymapFile, this.overrides);
    if (this.resolved.conflicts.length > 0) {
      logMain(
        'warn',
        `键位冲突 ${this.resolved.conflicts.length} 处：${this.resolved.conflicts
          .map((conflict) => `${conflict.normalized} → ${conflict.commands.join(' / ')}`)
          .join('；')}`
      );
    }
    return this.resolved;
  }

  get(): { resolved: ResolvedKeymap; overrides: KeymapOverrides } {
    return { resolved: this.resolved, overrides: this.overrides };
  }

  async update(bindings: Record<string, string[]>): Promise<ResolvedKeymap> {
    this.overrides = this.filterKnown(parseUserKeymap({ bindings }));
    this.resolved = resolveKeymap(defaultKeymap as KeymapFile, this.overrides);
    if (this.filePath) {
      const temporary = `${this.filePath}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, bindings: this.overrides }, null, 2), 'utf8');
        await rename(temporary, this.filePath);
      } catch (error) {
        logMain('warn', `键位写入失败：${(error as Error).message}`);
      }
    }
    return this.resolved;
  }

  private filterKnown(overrides: KeymapOverrides): KeymapOverrides {
    const result: KeymapOverrides = {};
    for (const [command, keys] of Object.entries(overrides)) {
      if (!KNOWN_COMMANDS.has(command)) {
        logMain('warn', `键位覆盖引用了未知命令「${command}」，已忽略`);
        continue;
      }
      result[command] = keys;
    }
    return result;
  }
}

export const keymapStore = new KeymapStore();
