/**
 * 渲染层文案入口（REQ-033）：locale 单点状态 + 静态文案应用 + 命令标签。
 *
 * - 语言来自 `settings.language`（主进程持有并广播）；
 * - `applyStaticTexts()` 依据 `data-i18n*` 属性把 index.html 的静态文案本地化；
 * - 动态文案直接 `tr(key, vars)`。
 */

import { COMMANDS } from '../shared/commands';
import { commandLabel, t, type Locale, type UiKey } from '../shared/i18n';

let current: Locale = 'zh-CN';

const ZH_LABELS = new Map<string, string>(COMMANDS.map((command) => [command.id, command.label]));

export function setLocale(value: Locale): void {
  current = value;
  document.documentElement.lang = value;
}

export function locale(): Locale {
  return current;
}

export function tr(key: UiKey, vars?: Record<string, string | number>): string {
  return t(key, vars, current);
}

/** 命令标签（菜单、右键菜单、表格工具条共用一份对照表）。 */
export function cmdLabel(id: string): string {
  return commandLabel(id, ZH_LABELS.get(id) ?? id, current);
}

/** 应用 index.html 中的 `data-i18n`（文本）/ `data-i18n-title` / `data-i18n-placeholder` / `data-i18n-aria-label`。 */
export function applyStaticTexts(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n as UiKey | undefined;
    if (key) node.textContent = tr(key);
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = node.dataset.i18nTitle as UiKey | undefined;
    if (key) node.title = tr(key);
  }
  for (const node of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    const key = node.dataset.i18nPlaceholder as UiKey | undefined;
    if (key) node.placeholder = tr(key);
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    const key = node.dataset.i18nAriaLabel as UiKey | undefined;
    if (key) node.setAttribute('aria-label', tr(key));
  }
}
