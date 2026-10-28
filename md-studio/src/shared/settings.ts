/**
 * 应用设置（userData/settings.json 的模型）：窗口、视图、文件、自动保存、主题。
 * 纯函数 sanitize/merge，主进程负责落盘与广播。
 */

export type ThemeMode = 'light' | 'dark';
export type SidebarTab = 'files' | 'outline' | 'search';

export interface Settings {
  version: 1;
  theme: {
    /** 内置主题模式（用户主题存在时作为回退） */
    mode: ThemeMode;
    /** 用户主题文件名（userData/themes/*.css），null 表示使用内置 */
    userTheme: string | null;
  };
  view: {
    sidebarVisible: boolean;
    sidebarTab: SidebarTab;
    sidebarWidth: number;
    sourceMode: boolean;
    focusMode: boolean;
    typewriterMode: boolean;
    /** 缩放级别（Chromium zoom level，-4~5） */
    zoomLevel: number;
  };
  editor: {
    /** 拼写检查（Chromium 内置词典） */
    spellcheck: boolean;
  };
  window: {
    width: number;
    height: number;
    x: number | null;
    y: number | null;
    maximized: boolean;
    /** 窗口置顶（REQ-025） */
    alwaysOnTop: boolean;
  };
  files: {
    recent: string[];
    workspaceRoot: string | null;
    lastOpen: string | null;
  };
  autosave: {
    enabled: boolean;
    delayMs: number;
  };
  pandoc: {
    /** pandoc 可执行文件路径（空字符串 = 走 PATH） */
    path: string;
  };
  /** 导出选项（REQ-035） */
  exportOptions: {
    /** 内联 KaTeX 字体（base64）：关闭 / 常用字形 / 全量字形（B5-5） */
    inlineMathFonts: InlineMathFontsScope;
  };
  /** 多标签会话（REQ-032）：上次打开的标签集合 */
  tabs: {
    open: TabSnapshot[];
    active: number;
  };
  /** 界面语言（REQ-033） */
  language: 'zh-CN' | 'en';
}

export interface TabSnapshot {
  path: string | null;
  name: string;
  /** 光标位置（恢复到标签时用） */
  anchor: number;
}

export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K];
};

export const RECENT_LIMIT = 10;
export const AUTOSAVE_DELAY_DEFAULT = 5000;
export const AUTOSAVE_DELAY_MIN = 1000;
export const AUTOSAVE_DELAY_MAX = 60000;
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 520;
export const ZOOM_LEVEL_MIN = -4;
export const ZOOM_LEVEL_MAX = 5;

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  theme: { mode: 'light', userTheme: null },
  view: {
    sidebarVisible: true,
    sidebarTab: 'files',
    sidebarWidth: 260,
    sourceMode: false,
    focusMode: false,
    typewriterMode: false,
    zoomLevel: 0
  },
  editor: { spellcheck: true },
  window: { width: 1200, height: 800, x: null, y: null, maximized: false, alwaysOnTop: false },
  files: { recent: [], workspaceRoot: null, lastOpen: null },
  autosave: { enabled: true, delayMs: AUTOSAVE_DELAY_DEFAULT },
  pandoc: { path: '' },
  exportOptions: { inlineMathFonts: 'off' },
  tabs: { open: [], active: 0 },
  language: 'zh-CN'
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * KaTeX 字体内联范围（B5-5）：`off` 不内联、`common` 常用字形、`all` 全部 woff2。
 * 旧版设置里该字段是布尔值，读取时按 true→`common`、false→`off` 迁移。
 */
export type InlineMathFontsScope = 'off' | 'common' | 'all';

function pickMathFontsScope(value: unknown, fallback: InlineMathFontsScope): InlineMathFontsScope {
  if (value === 'off' || value === 'common' || value === 'all') return value;
  if (value === true) return 'common';
  if (value === false) return 'off';
  return fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function pickNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function pickThemeMode(value: unknown, fallback: ThemeMode): ThemeMode {
  return value === 'light' || value === 'dark' ? value : fallback;
}

function pickSidebarTab(value: unknown, fallback: SidebarTab): SidebarTab {
  return value === 'files' || value === 'outline' || value === 'search' ? value : fallback;
}

function pickString(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' ? value : fallback;
}

function pickStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

/** 把任意输入（磁盘 JSON / 渲染层 patch）洗成完整合法设置；非法字段回退默认值。 */
export function sanitizeSettings(input: unknown): Settings {
  const raw = isRecord(input) ? input : {};
  const theme = isRecord(raw.theme) ? raw.theme : {};
  const view = isRecord(raw.view) ? raw.view : {};
  const editor = isRecord(raw.editor) ? raw.editor : {};
  const windowSection = isRecord(raw.window) ? raw.window : {};
  const files = isRecord(raw.files) ? raw.files : {};
  const autosave = isRecord(raw.autosave) ? raw.autosave : {};
  const pandoc = isRecord(raw.pandoc) ? raw.pandoc : {};
  const exportOptions = isRecord(raw.exportOptions) ? raw.exportOptions : {};
  const tabs = isRecord(raw.tabs) ? raw.tabs : {};

  return {
    version: 1,
    theme: {
      mode: pickThemeMode(theme.mode, DEFAULT_SETTINGS.theme.mode),
      userTheme: pickString(theme.userTheme, null)
    },
    view: {
      sidebarVisible: pickBoolean(view.sidebarVisible, DEFAULT_SETTINGS.view.sidebarVisible),
      sidebarTab: pickSidebarTab(view.sidebarTab, DEFAULT_SETTINGS.view.sidebarTab),
      sidebarWidth: pickNumber(view.sidebarWidth, DEFAULT_SETTINGS.view.sidebarWidth, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX),
      sourceMode: pickBoolean(view.sourceMode, DEFAULT_SETTINGS.view.sourceMode),
      focusMode: pickBoolean(view.focusMode, DEFAULT_SETTINGS.view.focusMode),
      typewriterMode: pickBoolean(view.typewriterMode, DEFAULT_SETTINGS.view.typewriterMode),
      zoomLevel: pickNumber(view.zoomLevel, DEFAULT_SETTINGS.view.zoomLevel, ZOOM_LEVEL_MIN, ZOOM_LEVEL_MAX)
    },
    editor: {
      spellcheck: pickBoolean(editor.spellcheck, DEFAULT_SETTINGS.editor.spellcheck)
    },
    window: {
      width: pickNumber(windowSection.width, DEFAULT_SETTINGS.window.width, 640, 10000),
      height: pickNumber(windowSection.height, DEFAULT_SETTINGS.window.height, 420, 10000),
      x: pickNullableNumber(windowSection.x),
      y: pickNullableNumber(windowSection.y),
      maximized: pickBoolean(windowSection.maximized, false),
      alwaysOnTop: pickBoolean(windowSection.alwaysOnTop, false)
    },
    files: {
      recent: pickStringArray(files.recent, RECENT_LIMIT),
      workspaceRoot: pickString(files.workspaceRoot, null),
      lastOpen: pickString(files.lastOpen, null)
    },
    autosave: {
      enabled: pickBoolean(autosave.enabled, DEFAULT_SETTINGS.autosave.enabled),
      delayMs: pickNumber(autosave.delayMs, AUTOSAVE_DELAY_DEFAULT, AUTOSAVE_DELAY_MIN, AUTOSAVE_DELAY_MAX)
    },
    pandoc: {
      path: typeof pandoc.path === 'string' ? pandoc.path : ''
    },
    exportOptions: {
      inlineMathFonts: pickMathFontsScope(exportOptions.inlineMathFonts, DEFAULT_SETTINGS.exportOptions.inlineMathFonts)
    },
    tabs: {
      open: pickTabs(tabs.open),
      active: pickNumber(tabs.active, 0, 0, 64)
    },
    language: raw.language === 'en' ? 'en' : 'zh-CN'
  };
}

/** 标签快照过滤：只保留合法结构，最多 32 个。 */
function pickTabs(value: unknown): TabSnapshot[] {
  if (!Array.isArray(value)) return [];
  const result: TabSnapshot[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const path = typeof item.path === 'string' && item.path.length > 0 ? item.path : null;
    const name = typeof item.name === 'string' && item.name.length > 0 ? item.name : '未命名';
    const anchor = typeof item.anchor === 'number' && Number.isFinite(item.anchor) ? Math.max(0, Math.round(item.anchor)) : 0;
    if (!path && name === '未命名') continue;
    result.push({ path, name, anchor });
    if (result.length >= 32) break;
  }
  return result;
}

/** 在现有设置上应用一节或多节 patch（浅层按节合并，值经过洗牌）。 */
export function mergeSettings(base: Settings, patch: unknown): Settings {
  if (!isRecord(patch)) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const section of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const incoming = patch[section];
    if (incoming === undefined) continue;
    if (section === 'version') {
      merged.version = base.version;
      continue;
    }
    if (isRecord(incoming)) {
      merged[section] = { ...(base[section] as object), ...incoming };
    } else {
      // 非对象节（language）直接覆盖；非法值由 sanitizeSettings 回退默认
      merged[section] = incoming;
    }
  }
  return sanitizeSettings(merged);
}

/** 把路径插入最近文件列表（去重、置顶、限长）。 */
export function pushRecent(recent: string[], path: string): string[] {
  return [path, ...recent.filter((item) => item !== path)].slice(0, RECENT_LIMIT);
}
