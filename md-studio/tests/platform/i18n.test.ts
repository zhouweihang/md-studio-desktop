/**
 * 界面语言目录（REQ-033）：键齐全、占位符一致、缺键回退、命令标签英文覆盖。
 */

import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/shared/commands';
import {
  COMMAND_LABELS_EN,
  catalogKeys,
  commandLabel,
  isLocale,
  LOCALES,
  t,
  zhCatalogKeys
} from '../../src/shared/i18n';
import { sanitizeSettings } from '../../src/shared/settings';

/** 取模板里的占位符集合（`{name}` 形式）。 */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}

describe('文案目录完整性', () => {
  it('中英目录键完全一致', () => {
    const zh = zhCatalogKeys().sort();
    const en = catalogKeys('en').sort();
    expect(en).toEqual(zh);
    expect(zh.length).toBeGreaterThan(200);
  });

  it('中英同名键的占位符一致（缺变量会在运行时露字面量）', () => {
    const mismatched: string[] = [];
    for (const key of zhCatalogKeys()) {
      const zh = t(key as never, undefined, 'zh-CN');
      const en = t(key as never, undefined, 'en');
      if (placeholders(zh).join(',') !== placeholders(en).join(',')) mismatched.push(key);
    }
    expect(mismatched).toEqual([]);
  });

  it('英文目录不残留中文（技术名词与示例路径除外）', () => {
    const leftovers: string[] = [];
    for (const key of catalogKeys('en')) {
      const value = t(key as never, undefined, 'en');
      // 允许出现：语言自称、示例文件名、HTTP 头等
      const scrubbed = value
        .replace(/简体中文/g, '')
        .replace(/笔记\.md/g, '')
        .replace(/[^\u4e00-\u9fa5]/g, '');
      if (/[\u4e00-\u9fa5]/.test(scrubbed)) leftovers.push(`${key}: ${value}`);
    }
    expect(leftovers).toEqual([]);
  });

  it('LANG 判定只接受受支持的语言', () => {
    expect(LOCALES).toEqual(['zh-CN', 'en']);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('zh-CN')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('取值与回退', () => {
  it('变量替换按名生效，缺变量保留占位符', () => {
    expect(t('status.words', { count: 12 }, 'zh-CN')).toBe('12 字');
    expect(t('status.words', { count: 12 }, 'en')).toBe('12 words');
    expect(t('status.selected', { selected: 3 }, 'en')).toContain('{total}');
  });

  it('缺键回退中文，再缺返回键名', () => {
    expect(t('editor.placeholder', undefined, 'en')).toBe('Start writing… (Ctrl+/ toggles source mode)');
    expect(t('not.a.key' as never, undefined, 'en')).toBe('not.a.key');
  });

  it('locale 回退：未知语言按中文目录取值', () => {
    expect(t('menu.file', undefined, 'xx' as never)).toBe('文件');
  });
});

describe('命令标签双语', () => {
  it('命令表的每个 id 都有英文标签', () => {
    const missing = COMMANDS.map((command) => command.id).filter((id) => !COMMAND_LABELS_EN[id]);
    expect(missing).toEqual([]);
  });

  it('中文取命令表标签，英文取目录标签', () => {
    const save = COMMANDS.find((command) => command.id === 'file.save')!;
    expect(commandLabel('file.save', save.label, 'zh-CN')).toBe('保存');
    expect(commandLabel('file.save', save.label, 'en')).toBe('Save');
    expect(commandLabel('unknown.command', '未知', 'en')).toBe('未知');
  });

  it('新命令（标签页切换）已登记键位与英文标签', () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(ids).toContain('tab.next');
    expect(ids).toContain('tab.prev');
    expect(COMMAND_LABELS_EN['tab.next']).toBe('Next tab');
    expect(COMMAND_LABELS_EN['tab.prev']).toBe('Previous tab');
  });
});

describe('语言持久化', () => {
  it('settings.language 只接受 zh-CN / en，非法值回退中文', () => {
    expect(sanitizeSettings({ language: 'en' }).language).toBe('en');
    expect(sanitizeSettings({ language: 'zh-CN' }).language).toBe('zh-CN');
    expect(sanitizeSettings({ language: 'de' }).language).toBe('zh-CN');
    expect(sanitizeSettings({}).language).toBe('zh-CN');
  });

  it('导出字体内联档位随设置洗牌保留（旧布尔值迁移到 common/off）', () => {
    expect(sanitizeSettings({ exportOptions: { inlineMathFonts: 'all' } }).exportOptions.inlineMathFonts).toBe('all');
    expect(sanitizeSettings({ exportOptions: { inlineMathFonts: 'common' } }).exportOptions.inlineMathFonts).toBe('common');
    expect(sanitizeSettings({ exportOptions: { inlineMathFonts: true } }).exportOptions.inlineMathFonts).toBe('common');
    expect(sanitizeSettings({ exportOptions: { inlineMathFonts: false } }).exportOptions.inlineMathFonts).toBe('off');
    expect(sanitizeSettings({ exportOptions: { inlineMathFonts: 'yes' } }).exportOptions.inlineMathFonts).toBe('off');
    expect(sanitizeSettings({}).exportOptions.inlineMathFonts).toBe('off');
  });
});
