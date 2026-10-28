/**
 * 编辑区右键菜单（REQ-021）：主进程把 Chromium 的 context-menu 参数推过来，
 * 这里按上下文（可编辑/有选区/在表格内/拼写错误/链接）组装条目。
 * 所有条目复用命令 id，与菜单栏、快捷键同源（REQ-015）。
 */

import type { ContextMenuEvent } from '../../shared/channels';
import { cmdLabel, tr } from '../i18n';
import { contextMenu, type ContextMenuItem } from './dialogs';

export interface EditorContextMenuDeps {
  runCommand(id: string, arg?: unknown): void;
  /** 光标是否位于表格内（渲染层才知道编辑器状态） */
  isInsideTable(): boolean;
  /** 替换拼写错误（主进程 replaceMisspelling） */
  replaceMisspelling(word: string): void;
  /** 打开外部链接 */
  openExternal(url: string): void;
  notify(message: string, kind?: 'info' | 'warn' | 'error'): void;
}

const MAX_SUGGESTIONS = 5;

export function buildContextMenuItems(
  event: ContextMenuEvent,
  deps: EditorContextMenuDeps
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const run = (id: string, arg?: unknown) => () => deps.runCommand(id, arg);
  const editAction = (action: 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo') => () => {
    void window.mdstudio.editAction(action);
  };

  // 拼写建议：错误单词优先展示
  if (event.misspelledWord) {
    const suggestions = event.suggestions.slice(0, MAX_SUGGESTIONS);
    if (suggestions.length === 0) {
      items.push({ label: tr('context.noSuggestions', { word: event.misspelledWord }), disabled: true });
    } else {
      for (const suggestion of suggestions) {
        items.push({ label: suggestion, action: () => deps.replaceMisspelling(suggestion) });
      }
    }
    items.push({ separator: true });
  }

  // 链接
  if (event.linkURL) {
    items.push({ label: tr('context.openLink', { url: truncate(event.linkURL) }), action: () => deps.openExternal(event.linkURL!) });
    items.push({
      label: tr('context.copyLink'),
      action: () => {
        void window.mdstudio.writeClipboard({ text: event.linkURL! });
        deps.notify(tr('context.linkCopied'));
      }
    });
    items.push({ separator: true });
  }

  items.push({ label: tr('menu.undo'), action: editAction('undo') });
  items.push({ label: tr('menu.redo'), action: editAction('redo') });
  items.push({ separator: true });
  items.push({ label: tr('menu.cut'), disabled: !event.hasSelection, action: editAction('cut') });
  items.push({ label: tr('menu.copy'), disabled: !event.hasSelection, action: editAction('copy') });
  items.push({ label: tr('menu.paste'), action: editAction('paste') });
  items.push({ separator: true });

  if (event.hasSelection && event.isEditable) {
    items.push({ label: cmdLabel('edit.copyMarkdown'), action: run('edit.copyMarkdown') });
    items.push({ label: cmdLabel('edit.copyHtml'), action: run('edit.copyHtml') });
    items.push({ label: cmdLabel('edit.copyPlainText'), action: run('edit.copyPlainText') });
    items.push({ separator: true });
  }

  if (event.isEditable) {
    items.push({ label: cmdLabel('edit.pasteMarkdown'), action: run('edit.pasteMarkdown') });
    items.push({ label: cmdLabel('edit.pastePlainText'), action: run('edit.pastePlainText') });
    items.push({ separator: true });

    items.push({ label: cmdLabel('format.bold'), action: run('format.bold') });
    items.push({ label: cmdLabel('format.italic'), action: run('format.italic') });
    items.push({ label: cmdLabel('format.strikethrough'), action: run('format.strikethrough') });
    items.push({ label: cmdLabel('format.inlineCode'), action: run('format.inlineCode') });
    items.push({ label: cmdLabel('format.highlight'), action: run('format.highlight') });
    items.push({ separator: true });

    if (deps.isInsideTable()) {
      items.push({ label: cmdLabel('table.addRow'), action: run('table.addRow') });
      items.push({ label: cmdLabel('table.addColumn'), action: run('table.addColumn') });
      items.push({ label: cmdLabel('table.deleteRow'), action: run('table.deleteRow') });
      items.push({ label: cmdLabel('table.deleteColumn'), action: run('table.deleteColumn') });
      items.push({ separator: true });
    }

    items.push({ label: cmdLabel('format.link'), action: run('format.link') });
    items.push({ label: cmdLabel('format.image'), action: run('format.image') });
    items.push({ label: cmdLabel('paragraph.table'), action: run('paragraph.table') });
    items.push({ label: cmdLabel('paragraph.codeBlock'), action: run('paragraph.codeBlock') });
    items.push({ label: cmdLabel('format.footnote'), action: run('format.footnote') });
    items.push({ label: cmdLabel('paragraph.toc'), action: run('paragraph.toc') });
    items.push({ separator: true });
  }

  items.push({ label: cmdLabel('edit.find'), action: run('edit.find') });
  items.push({ label: cmdLabel('edit.replace'), action: run('edit.replace') });

  return items;
}

function truncate(text: string, limit = 48): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 显示编辑区右键菜单。 */
export function showEditorContextMenu(event: ContextMenuEvent, deps: EditorContextMenuDeps): void {
  contextMenu({ x: event.x, y: event.y, items: buildContextMenuItems(event, deps) });
}
