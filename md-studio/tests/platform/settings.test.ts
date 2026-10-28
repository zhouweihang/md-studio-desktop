import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_DELAY_DEFAULT,
  DEFAULT_SETTINGS,
  mergeSettings,
  pushRecent,
  RECENT_LIMIT,
  sanitizeSettings,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN
} from '../../src/shared/settings';

describe('sanitizeSettings', () => {
  it('空输入回退默认值', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });

  it('非法字段回退，合法字段保留', () => {
    const settings = sanitizeSettings({
      theme: { mode: 'dark', userTheme: 'my.css' },
      view: { sidebarVisible: 'yes', sidebarTab: 'outline', sidebarWidth: 9999, sourceMode: true },
      autosave: { enabled: false, delayMs: 10 },
      files: { recent: ['/a.md', '/a.md', 42, '/b.md'] }
    });
    expect(settings.theme).toEqual({ mode: 'dark', userTheme: 'my.css' });
    expect(settings.view.sidebarVisible).toBe(DEFAULT_SETTINGS.view.sidebarVisible);
    expect(settings.view.sidebarTab).toBe('outline');
    expect(settings.view.sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);
    expect(settings.view.sourceMode).toBe(true);
    expect(settings.autosave.enabled).toBe(false);
    expect(settings.autosave.delayMs).toBe(1000);
    expect(settings.files.recent).toEqual(['/a.md', '/b.md']);
  });

  it('窗口尺寸与坐标', () => {
    const settings = sanitizeSettings({ window: { width: 100, height: 5000, x: 10.6, y: 'a', maximized: true } });
    expect(settings.window.width).toBe(640);
    expect(settings.window.height).toBe(5000);
    expect(settings.window.x).toBe(11);
    expect(settings.window.y).toBeNull();
    expect(settings.window.maximized).toBe(true);
    expect(settings.window.width).toBeGreaterThanOrEqual(640);
    expect(SIDEBAR_WIDTH_MIN).toBeLessThan(SIDEBAR_WIDTH_MAX);
    expect(DEFAULT_SETTINGS.autosave.delayMs).toBe(AUTOSAVE_DELAY_DEFAULT);
  });
});

describe('mergeSettings', () => {
  it('按节浅合并且不影响其他节', () => {
    const base = sanitizeSettings(DEFAULT_SETTINGS);
    const merged = mergeSettings(base, { view: { focusMode: true }, theme: { mode: 'dark' } });
    expect(merged.view.focusMode).toBe(true);
    expect(merged.view.typewriterMode).toBe(base.view.typewriterMode);
    expect(merged.theme.mode).toBe('dark');
    expect(merged.autosave).toEqual(base.autosave);
  });

  it('非对象 patch 原样返回', () => {
    const base = sanitizeSettings(DEFAULT_SETTINGS);
    expect(mergeSettings(base, null)).toBe(base);
    expect(mergeSettings(base, 42)).toBe(base);
  });
});

describe('pushRecent', () => {
  it('去重置顶并限制长度', () => {
    const recent = Array.from({ length: RECENT_LIMIT + 3 }, (_, index) => `/doc-${index}.md`);
    const next = pushRecent(recent, '/doc-2.md');
    expect(next[0]).toBe('/doc-2.md');
    expect(next).toHaveLength(RECENT_LIMIT);
    expect(new Set(next).size).toBe(next.length);
  });
});
