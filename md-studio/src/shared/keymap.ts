/**
 * 键位：默认表（default.json）+ 用户覆盖（userData/keymap.json）→ 规范化组合、冲突检测、
 * 平台格式互转（Electron Accelerator ↔ CodeMirror key）。
 * 纯函数，不依赖 node/electron，主进程与渲染层共用。
 */

export interface KeymapFile {
  version: 1;
  bindings: Record<string, string[]>;
}

export interface KeyConflict {
  combo: string;
  normalized: string;
  commands: string[];
}

export interface ResolvedKeymap {
  bindings: Record<string, string[]>;
  conflicts: KeyConflict[];
}

export type KeymapOverrides = Record<string, string[]>;

const MOD_TOKENS = new Set([
  'cmdorctrl',
  'cmdorcontrol',
  'commandorcontrol',
  'cmd',
  'command',
  'ctrl',
  'control',
  'meta',
  'super'
]);

const MODIFIER_ORDER = ['mod', 'ctrl', 'alt', 'shift'] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

/** Electron 键名 → 规范化键名 */
const KEY_CANONICAL: Record<string, string> = {
  esc: 'escape',
  escape: 'escape',
  space: 'space',
  spacebar: 'space',
  return: 'enter',
  enter: 'enter',
  tab: 'tab',
  backspace: 'backspace',
  delete: 'delete',
  del: 'delete',
  insert: 'insert',
  ins: 'insert',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  arrowup: 'arrowup',
  arrowdown: 'arrowdown',
  arrowleft: 'arrowleft',
  arrowright: 'arrowright',
  pageup: 'pageup',
  pagedown: 'pagedown',
  home: 'home',
  end: 'end',
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  plus: '+',
  minus: '-',
  equal: '=',
  semicolon: ';',
  quote: "'",
  backquote: '`'
};

/** CodeMirror 风格键名 → 规范化键名（反向补充） */
const CM_KEY_CANONICAL: Record<string, string> = {
  arrowup: 'arrowup',
  arrowdown: 'arrowdown',
  arrowleft: 'arrowleft',
  arrowright: 'arrowright',
  escape: 'escape',
  enter: 'enter',
  space: 'space',
  f1: 'f1',
  f2: 'f2',
  f3: 'f3',
  f4: 'f4',
  f5: 'f5',
  f6: 'f6',
  f7: 'f7',
  f8: 'f8',
  f9: 'f9',
  f10: 'f10',
  f11: 'f11',
  f12: 'f12'
};

function canonicalKeyToken(raw: string): string | null {
  const token = raw.trim();
  if (token.length === 0) return null;
  const lower = token.toLowerCase();
  if (KEY_CANONICAL[lower]) return KEY_CANONICAL[lower];
  if (CM_KEY_CANONICAL[lower]) return CM_KEY_CANONICAL[lower];
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower;
  if (token.length === 1) return lower;
  return lower;
}

/**
 * 规范化一个组合键："CmdOrCtrl+Shift+L" / "Mod-Shift-l" / "Ctrl+\\" → "mod+shift+l"。
 * 无法解析时返回 null。
 */
export function normalizeKey(key: string): string | null {
  if (!key) return null;
  const parts = key.split(/[+-]/).filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  const modifiers = new Set<Modifier>();
  let keyToken: string | null = null;
  for (const rawPart of parts) {
    const lower = rawPart.toLowerCase();
    if (lower === 'mod' || MOD_TOKENS.has(lower)) {
      if (lower === 'super') modifiers.add('mod');
      else modifiers.add('mod');
      continue;
    }
    if (lower === 'shift') {
      modifiers.add('shift');
      continue;
    }
    if (lower === 'alt' || lower === 'option') {
      modifiers.add('alt');
      continue;
    }
    if (lower === 'ctrl' || lower === 'control') {
      modifiers.add('ctrl');
      continue;
    }
    const canonical = canonicalKeyToken(rawPart);
    if (!canonical) return null;
    keyToken = canonical;
  }
  if (!keyToken) return null;
  const tokens: string[] = [];
  for (const modifier of MODIFIER_ORDER) {
    if (modifiers.has(modifier)) tokens.push(modifier);
  }
  tokens.push(keyToken);
  return tokens.join('+');
}

const CM_SPECIAL: Record<string, string> = {
  escape: 'Escape',
  enter: 'Enter',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End'
};

/** 规范化组合 → CodeMirror key（如 "mod+shift+l" → "Mod-Shift-l"）。 */
export function toCodeMirrorKey(key: string): string | null {
  const normalized = normalizeKey(key);
  if (!normalized) return null;
  const tokens = normalized.split('+');
  const keyToken = tokens[tokens.length - 1] ?? '';
  const modifiers = tokens.slice(0, -1);
  const cmModifiers = modifiers.map((modifier) => {
    if (modifier === 'mod') return 'Mod';
    if (modifier === 'ctrl') return 'Ctrl';
    if (modifier === 'alt') return 'Alt';
    return 'Shift';
  });
  const cmKey = CM_SPECIAL[keyToken] ?? (keyToken.length === 1 ? keyToken : keyToken.charAt(0).toUpperCase() + keyToken.slice(1));
  return [...cmModifiers, cmKey].join('-');
}

const ELECTRON_SPECIAL: Record<string, string> = {
  escape: 'Esc',
  enter: 'Enter',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End'
};

/** 规范化组合 → Electron Accelerator（如 "mod+shift+l" → "CmdOrCtrl+Shift+L"）。 */
export function toElectronAccelerator(key: string): string | undefined {
  const normalized = normalizeKey(key);
  if (!normalized) return undefined;
  const tokens = normalized.split('+');
  const keyToken = tokens[tokens.length - 1] ?? '';
  const modifiers = tokens.slice(0, -1).map((modifier) => {
    if (modifier === 'mod') return 'CmdOrCtrl';
    if (modifier === 'ctrl') return 'Ctrl';
    if (modifier === 'alt') return 'Alt';
    return 'Shift';
  });
  let electronKey = ELECTRON_SPECIAL[keyToken];
  if (!electronKey) {
    if (/^f\d+$/.test(keyToken)) electronKey = keyToken.toUpperCase();
    else if (keyToken.length === 1) electronKey = keyToken.toUpperCase();
    else electronKey = keyToken.charAt(0).toUpperCase() + keyToken.slice(1);
  }
  return [...modifiers, electronKey].join('+');
}

/** 解析用户键位文件内容（宽松）：返回合法的覆盖映射，非法项忽略。 */
export function parseUserKeymap(raw: unknown): KeymapOverrides {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const bindingsRaw = source.bindings;
  if (!bindingsRaw || typeof bindingsRaw !== 'object') return {};
  const result: KeymapOverrides = {};
  for (const [command, value] of Object.entries(bindingsRaw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const keys = value.filter((item): item is string => typeof item === 'string' && normalizeKey(item) !== null);
    if (keys.length > 0) result[command] = keys;
  }
  return result;
}

/** 默认键位 + 用户覆盖 → 生效键位与冲突列表。 */
export function resolveKeymap(defaults: KeymapFile, overrides: KeymapOverrides | null): ResolvedKeymap {
  const bindings: Record<string, string[]> = {};
  for (const [command, keys] of Object.entries(defaults.bindings)) {
    bindings[command] = [...keys];
  }
  if (overrides) {
    for (const [command, keys] of Object.entries(overrides)) {
      bindings[command] = [...keys];
    }
  }
  const byCombo = new Map<string, { combo: string; commands: string[] }>();
  for (const [command, keys] of Object.entries(bindings)) {
    for (const key of keys) {
      const normalized = normalizeKey(key);
      if (!normalized) continue;
      const entry = byCombo.get(normalized) ?? { combo: key, commands: [] };
      if (!entry.commands.includes(command)) entry.commands.push(command);
      byCombo.set(normalized, entry);
    }
  }
  const conflicts: KeyConflict[] = [];
  for (const [normalized, entry] of byCombo) {
    if (entry.commands.length > 1) {
      conflicts.push({ combo: entry.combo, normalized, commands: [...entry.commands].sort() });
    }
  }
  conflicts.sort((a, b) => a.normalized.localeCompare(b.normalized));
  return { bindings, conflicts };
}
