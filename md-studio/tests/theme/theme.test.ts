import { describe, expect, it } from 'vitest';
import { inferModeFromColor, parseThemeMeta, THEME_MAX_BYTES } from '../../src/shared/theme-meta';

const VALID = `/* mdstudio-theme: name=Solarized; mode=dark */
:root {
  --md-color-paper: #002b36;
  --md-color-ink: #93a1a1;
}`;

describe('parseThemeMeta', () => {
  it('解析元数据：名称与模式', () => {
    const meta = parseThemeMeta(VALID, 'solarized.css');
    expect(meta.name).toBe('Solarized');
    expect(meta.mode).toBe('dark');
    expect(meta.issues).toEqual([]);
    expect(meta.fileName).toBe('solarized.css');
  });

  it('缺少元数据时按文件名命名并提示', () => {
    const meta = parseThemeMeta(':root { --md-color-paper: #fff; }', 'my-theme.css');
    expect(meta.name).toBe('my-theme');
    expect(meta.issues.some((issue) => issue.includes('缺少 mdstudio-theme 元数据'))).toBe(true);
  });

  it('未声明变量时给出提示', () => {
    const meta = parseThemeMeta('/* mdstudio-theme: name=X; mode=light */\nbody { color: red; }', 'x.css');
    expect(meta.issues.some((issue) => issue.includes('--md-color-'))).toBe(true);
  });

  it('非法 mode 值按自动识别处理', () => {
    const meta = parseThemeMeta('/* mdstudio-theme: name=Y; mode=neon */\n:root { --md-color-paper: #223344; }', 'y.css');
    expect(meta.mode).toBe('dark');
    expect(meta.issues.some((issue) => issue.includes('未知的 mode'))).toBe(true);
  });

  it('空文件与超大文件被标注', () => {
    expect(parseThemeMeta('', 'empty.css').issues).toContain('主题文件为空');
    const huge = `/* mdstudio-theme: name=H */\n:root{--md-color-paper:#fff}\n/* ${'x'.repeat(THEME_MAX_BYTES)} */`;
    expect(parseThemeMeta(huge, 'huge.css').issues.some((issue) => issue.includes('512 KB'))).toBe(true);
  });
});

describe('inferModeFromColor', () => {
  it('按亮度推断明暗', () => {
    expect(inferModeFromColor('#ffffff')).toBe('light');
    expect(inferModeFromColor('#000')).toBe('dark');
    expect(inferModeFromColor('rgb(250, 250, 250)')).toBe('light');
    expect(inferModeFromColor('rgb(10, 12, 14)')).toBe('dark');
  });

  it('无法识别返回 null', () => {
    expect(inferModeFromColor('rgb(var(--x))')).toBeNull();
    expect(inferModeFromColor('var(--md-color-paper)')).toBeNull();
  });
});
