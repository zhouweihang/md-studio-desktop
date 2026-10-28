import { describe, expect, it } from 'vitest';
import defaultKeymap from '../../src/shared/keymap/default.json';
import { COMMANDS } from '../../src/shared/commands';
import {
  normalizeKey,
  parseUserKeymap,
  resolveKeymap,
  toCodeMirrorKey,
  toElectronAccelerator,
  type KeymapFile
} from '../../src/shared/keymap';

const DEFAULTS = defaultKeymap as KeymapFile;

describe('normalizeKey', () => {
  it('把 CmdOrCtrl / Ctrl / Mod 统一为 mod', () => {
    expect(normalizeKey('CmdOrCtrl+Shift+L')).toBe('mod+shift+l');
    expect(normalizeKey('Ctrl+Shift+L')).toBe('mod+shift+l');
    expect(normalizeKey('Mod-Shift-l')).toBe('mod+shift+l');
  });

  it('函数键与方向键规范化', () => {
    expect(normalizeKey('F3')).toBe('f3');
    expect(normalizeKey('Shift+F3')).toBe('shift+f3');
    expect(normalizeKey('CmdOrCtrl+Left')).toBe('mod+arrowleft');
  });

  it('符号键规范化', () => {
    expect(normalizeKey('CmdOrCtrl+/')).toBe('mod+/');
    expect(normalizeKey('CmdOrCtrl+\\')).toBe('mod+\\');
  });

  it('非法输入返回 null', () => {
    expect(normalizeKey('')).toBeNull();
    expect(normalizeKey('Shift')).toBeNull();
    expect(normalizeKey('Ctrl')).toBeNull();
  });
});

describe('平台格式转换', () => {
  it('规范化 → CodeMirror 键位', () => {
    expect(toCodeMirrorKey('CmdOrCtrl+Shift+L')).toBe('Mod-Shift-l');
    expect(toCodeMirrorKey('F3')).toBe('F3');
    expect(toCodeMirrorKey('Shift+F3')).toBe('Shift-F3');
    expect(toCodeMirrorKey('CmdOrCtrl+/')).toBe('Mod-/');
  });

  it('规范化 → Electron Accelerator', () => {
    expect(toElectronAccelerator('Ctrl+Shift+S')).toBe('CmdOrCtrl+Shift+S');
    expect(toElectronAccelerator('F8')).toBe('F8');
    expect(toElectronAccelerator('CmdOrCtrl+Alt+O')).toBe('CmdOrCtrl+Alt+O');
  });
});

describe('resolveKeymap', () => {
  it('默认表无冲突，覆盖生效', () => {
    const resolved = resolveKeymap(DEFAULTS, null);
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.bindings['file.save']).toEqual(['CmdOrCtrl+S']);

    const overridden = resolveKeymap(DEFAULTS, { 'file.save': ['Ctrl+Alt+S', 'Ctrl+Alt+P'] });
    expect(overridden.bindings['file.save']).toEqual(['Ctrl+Alt+S', 'Ctrl+Alt+P']);
    expect(overridden.conflicts).toEqual([]);
  });

  it('两个命令落到同一组合时报告冲突', () => {
    const resolved = resolveKeymap(DEFAULTS, { 'format.italic': ['CmdOrCtrl+B'] });
    const conflict = resolved.conflicts.find((item) => item.normalized === 'mod+b');
    expect(conflict).toBeDefined();
    expect(conflict?.commands).toEqual(['format.bold', 'format.italic']);
  });

  it('parseUserKeymap 过滤非法项', () => {
    const parsed = parseUserKeymap({ bindings: { 'file.save': ['Ctrl+S', 42, ''], 'bad': 'nope' } });
    expect(parsed['file.save']).toEqual(['Ctrl+S']);
    expect(parsed['bad']).toBeUndefined();
  });
});

describe('默认键位表完整性（B2-3）', () => {
  it('所有键位指向已登记命令', () => {
    const known = new Set(COMMANDS.map((command) => command.id));
    for (const command of Object.keys(DEFAULTS.bindings)) {
      expect(known.has(command), `未知命令：${command}`).toBe(true);
    }
  });

  it('默认表内无冲突', () => {
    expect(resolveKeymap(DEFAULTS, null).conflicts).toHaveLength(0);
  });

  it('键位数量与编辑器命令规模匹配（≥25）', () => {
    expect(Object.keys(DEFAULTS.bindings).length).toBeGreaterThanOrEqual(25);
  });
});
