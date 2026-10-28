/**
 * 用户主题（userData/themes/*.css）元数据解析（REQ-013）。
 * 约定：文件头部注释声明 `/* mdstudio-theme: name=主题名; mode=light|dark *\/`
 */

import type { ThemeMode } from './settings';

export interface ThemeMeta {
  fileName: string;
  name: string;
  mode: ThemeMode | 'unknown';
  issues: string[];
}

export const THEME_META_PATTERN = /\/\*\s*mdstudio-theme\s*:([\s\S]*?)\*\//;
export const THEME_MAX_BYTES = 512 * 1024;

export function parseThemeMeta(css: string, fileName: string): ThemeMeta {
  const issues: string[] = [];
  const fallbackName = fileName.replace(/\.css$/i, '');
  const match = THEME_META_PATTERN.exec(css);
  let name = fallbackName;
  let mode: ThemeMode | 'unknown' = 'unknown';

  if (!match) {
    issues.push('缺少 mdstudio-theme 元数据注释，已按文件名命名');
  } else {
    const body = match[1] ?? '';
    for (const token of body.split(/[;\n]/)) {
      const trimmed = token.trim();
      if (!trimmed) continue;
      const equals = trimmed.indexOf('=');
      if (equals <= 0) continue;
      const key = trimmed.slice(0, equals).trim().toLowerCase();
      const value = trimmed.slice(equals + 1).trim().replace(/^["']|["']$/g, '');
      if (key === 'name' && value) name = value;
      if (key === 'mode') {
        const lower = value.toLowerCase();
        if (lower === 'light' || lower === 'dark') mode = lower;
        else issues.push(`未知的 mode 值「${value}」，按自动识别处理`);
      }
    }
  }

  if (css.trim().length === 0) issues.push('主题文件为空');
  if (css.length > THEME_MAX_BYTES) issues.push('主题文件超过 512 KB 上限，已拒绝加载');
  if (!css.includes('--md-color-')) issues.push('未声明 --md-color-* 变量，界面可能保持内置配色');
  else if (mode === 'unknown') {
    // 以最常用的变量推断底色模式
    const bodyMatch = /--md-color-paper\s*:\s*([^;]+);/.exec(css);
    if (bodyMatch) {
      const value = bodyMatch[1]?.trim() ?? '';
      const derived = inferModeFromColor(value);
      if (derived) mode = derived;
    }
  }

  return { fileName, name, mode, issues };
}

/** 简单亮度推断：#rrggbb / #rgb / rgb() 形式。 */
export function inferModeFromColor(value: string): ThemeMode | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  let r: number | null = null;
  let g: number | null = null;
  let b: number | null = null;
  if (hex) {
    const raw = hex[1] ?? '';
    const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  } else {
    const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value.trim());
    if (rgbMatch) {
      r = Number(rgbMatch[1]);
      g = Number(rgbMatch[2]);
      b = Number(rgbMatch[3]);
    }
  }
  if (r === null || g === null || b === null) return null;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5 ? 'dark' : 'light';
}
