/**
 * 表格悬浮工具条（REQ-024）：光标在表格内时，在表格上方浮出增删行列与对齐按钮。
 * 按钮只发命令 id（与段落菜单、键位同源），不直接改文档；点击用 mousedown + preventDefault
 * 保持编辑器焦点与选区。
 */

import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import type { UiKey } from '../../shared/i18n';
import { cmdLabel, tr } from '../i18n';

export interface TableToolbarDeps {
  runCommand(id: string): void;
}

interface ToolbarButton {
  id: string;
  label: UiKey;
}

const BUTTONS: ToolbarButton[] = [
  { id: 'table.addRow', label: 'table.addRowShort' },
  { id: 'table.deleteRow', label: 'table.deleteRowShort' },
  { id: 'table.addColumn', label: 'table.addColumnShort' },
  { id: 'table.deleteColumn', label: 'table.deleteColumnShort' },
  { id: 'table.alignLeft', label: 'table.alignLeftShort' },
  { id: 'table.alignCenter', label: 'table.alignCenterShort' },
  { id: 'table.alignRight', label: 'table.alignRightShort' }
];

/** 光标所在表格的源码区间（无则 null）。 */
export function tableRangeAt(view: EditorView): { from: number; to: number } | null {
  const head = view.state.selection.main.head;
  let node = syntaxTree(view.state).resolveInner(head, 1);
  while (node) {
    if (node.name === 'Table') return { from: node.from, to: node.to };
    node = node.parent as typeof node;
  }
  return null;
}

/** 光标是否位于表格内。 */
export function isInsideTable(view: EditorView): boolean {
  return tableRangeAt(view) !== null;
}

export interface TableToolbarHandle {
  refresh(): void;
  destroy(): void;
}

/** 创建工具条（挂在编辑器容器上，跟随表格位置）。 */
export function createTableToolbar(view: EditorView, deps: TableToolbarDeps): TableToolbarHandle {
  const host = document.createElement('div');
  host.className = 'md-table-toolbar';
  host.hidden = true;
  host.setAttribute('role', 'toolbar');

  const created: Array<{ button: ToolbarButton; element: HTMLButtonElement }> = [];
  for (const button of BUTTONS) {
    const element = document.createElement('button');
    element.type = 'button';
    element.dataset.command = button.id;
    created.push({ button, element });
    element.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      deps.runCommand(button.id);
    });
    host.append(element);
  }

  (view.dom.parentElement ?? view.dom).append(host);

  const applyLabels = (): void => {
    host.setAttribute('aria-label', tr('table.toolbar'));
    for (const { button, element } of created) {
      element.textContent = tr(button.label);
      element.title = cmdLabel(button.id);
    }
  };

  const refresh = (): void => {
    applyLabels();
    if (view.dom.parentElement?.contains(host) !== true) {
      (view.dom.parentElement ?? view.dom).append(host);
    }
    const range = tableRangeAt(view);
    if (!range) {
      host.hidden = true;
      return;
    }
    const coords = view.coordsAtPos(range.from);
    const containerRect = (view.dom.parentElement ?? view.dom).getBoundingClientRect();
    if (!coords) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.style.left = `${Math.max(4, coords.left - containerRect.left)}px`;
    host.style.top = `${Math.max(2, coords.top - containerRect.top - 34)}px`;
  };

  let frame = 0;
  const schedule = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      refresh();
    });
  };

  const onScroll = (): void => schedule();
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });

  return {
    refresh,
    destroy(): void {
      view.scrollDOM.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      host.remove();
    }
  };
}
