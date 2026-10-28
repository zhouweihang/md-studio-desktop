import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings } from '../../src/shared/settings';

describe('模式状态持久化（REQ-007：重启后状态保持）', () => {
  it('三个模式开关经设置模型往返不丢失', () => {
    const stored = mergeSettings(sanitizeSettings(DEFAULT_SETTINGS), {
      view: { sourceMode: true, focusMode: true, typewriterMode: true }
    });
    const reloaded = sanitizeSettings(JSON.parse(JSON.stringify(stored)));
    expect(reloaded.view.sourceMode).toBe(true);
    expect(reloaded.view.focusMode).toBe(true);
    expect(reloaded.view.typewriterMode).toBe(true);
  });

  it('默认关闭，可分别切换', () => {
    const base = sanitizeSettings(DEFAULT_SETTINGS);
    expect(base.view.sourceMode).toBe(false);
    expect(base.view.focusMode).toBe(false);
    expect(base.view.typewriterMode).toBe(false);
    const toggled = mergeSettings(base, { view: { focusMode: true } });
    expect(toggled.view.focusMode).toBe(true);
    expect(toggled.view.sourceMode).toBe(false);
    expect(mergeSettings(toggled, { view: { focusMode: false } }).view.focusMode).toBe(false);
  });

  it('侧栏状态同表持久化', () => {
    const stored = mergeSettings(sanitizeSettings(DEFAULT_SETTINGS), {
      view: { sidebarVisible: false, sidebarTab: 'outline', sidebarWidth: 320 }
    });
    const reloaded = sanitizeSettings(JSON.parse(JSON.stringify(stored)));
    expect(reloaded.view.sidebarVisible).toBe(false);
    expect(reloaded.view.sidebarTab).toBe('outline');
    expect(reloaded.view.sidebarWidth).toBe(320);
  });
});

describe('主题与会话状态持久化', () => {
  it('主题模式与用户主题随设置保存', () => {
    const stored = mergeSettings(sanitizeSettings(DEFAULT_SETTINGS), {
      theme: { mode: 'dark', userTheme: 'solarized.css' }
    });
    const reloaded = sanitizeSettings(JSON.parse(JSON.stringify(stored)));
    expect(reloaded.theme.mode).toBe('dark');
    expect(reloaded.theme.userTheme).toBe('solarized.css');
  });

  it('窗口尺寸与最大化状态保存', () => {
    const stored = mergeSettings(sanitizeSettings(DEFAULT_SETTINGS), {
      window: { width: 1400, height: 900, x: 120, y: 80, maximized: true }
    });
    const reloaded = sanitizeSettings(JSON.parse(JSON.stringify(stored)));
    expect(reloaded.window).toEqual({
      width: 1400,
      height: 900,
      x: 120,
      y: 80,
      maximized: true,
      alwaysOnTop: false
    });
  });
});
