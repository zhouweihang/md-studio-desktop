import { describe, expect, it } from 'vitest';
import { clampZoomLevel, stepZoomLevel, zoomPercent } from '../../src/shared/view-controls';
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings } from '../../src/shared/settings';

describe('clampZoomLevel', () => {
  it('夹取到 [-4, 5] 并取整', () => {
    expect(clampZoomLevel(0)).toBe(0);
    expect(clampZoomLevel(-9)).toBe(-4);
    expect(clampZoomLevel(42)).toBe(5);
    expect(clampZoomLevel(1.6)).toBe(2);
  });

  it('非法输入回退 0', () => {
    expect(clampZoomLevel(Number.NaN)).toBe(0);
    expect(clampZoomLevel(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('stepZoomLevel', () => {
  it('放大/缩小/重置', () => {
    expect(stepZoomLevel(0, 1)).toBe(1);
    expect(stepZoomLevel(0, -1)).toBe(-1);
    expect(stepZoomLevel(3, 0)).toBe(0);
  });

  it('边界不再越界', () => {
    expect(stepZoomLevel(5, 1)).toBe(5);
    expect(stepZoomLevel(-4, -1)).toBe(-4);
  });
});

describe('zoomPercent', () => {
  it('每级 1.2 倍', () => {
    expect(zoomPercent(0)).toBe('100%');
    expect(zoomPercent(1)).toBe('120%');
    expect(zoomPercent(-1)).toBe('83%');
  });
});

describe('设置里的视图字段', () => {
  it('默认值包含缩放 / 置顶 / 拼写检查 / 语言', () => {
    const settings = sanitizeSettings(DEFAULT_SETTINGS);
    expect(settings.view.zoomLevel).toBe(0);
    expect(settings.window.alwaysOnTop).toBe(false);
    expect(settings.editor.spellcheck).toBe(true);
    expect(settings.language).toBe('zh-CN');
    expect(settings.pandoc.path).toBe('');
  });

  it('patch 生效且越界值被夹取', () => {
    const merged = mergeSettings(sanitizeSettings(DEFAULT_SETTINGS), {
      view: { zoomLevel: 99 },
      window: { alwaysOnTop: true },
      editor: { spellcheck: false },
      language: 'en'
    });
    expect(merged.view.zoomLevel).toBe(5);
    expect(merged.window.alwaysOnTop).toBe(true);
    expect(merged.editor.spellcheck).toBe(false);
    expect(merged.language).toBe('en');
  });

  it('非法语言与缩放回退默认', () => {
    const merged = sanitizeSettings({ language: 'fr', view: { zoomLevel: 'x' } });
    expect(merged.language).toBe('zh-CN');
    expect(merged.view.zoomLevel).toBe(0);
  });
});
