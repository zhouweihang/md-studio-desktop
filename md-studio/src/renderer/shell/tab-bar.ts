/**
 * 标签栏（REQ-032）：点击切换、中键/× 关闭、脏标记、右键菜单、溢出横向滚动、
 * 拖拽排序（顺序回写到 `settings.tabs.open`）。数据来自 SessionPool（经 DocManager 暴露）。
 */

import type { TabMeta } from '../session';
import { baseName } from '../../shared/paths';
import { contextMenu } from './dialogs';
import { tr } from '../i18n';

/**
 * 计算拖放后的最终索引（0 基）：`after` 表示落在目标标签右半区。
 * 跨过自身位置时需要扣除被移走的那个位置，否则会偏一位。
 */
export function resolveDropIndex(
  metas: readonly { id: number }[],
  draggedId: number,
  targetId: number,
  after: boolean
): number | null {
  const from = metas.findIndex((item) => item.id === draggedId);
  const index = metas.findIndex((item) => item.id === targetId);
  if (from < 0 || index < 0) return null;
  let target = after ? index + 1 : index;
  if (from < target) target -= 1;
  return target;
}

export interface TabBarDeps {
  metas(): TabMeta[];
  activeId(): number | null;
  onActivate(id: number): void;
  onClose(id: number): void;
  onNew(): void;
  /** 把 `id` 拖到目标索引（0 基，指移动完成后的位置）。 */
  onReorder(id: number, targetIndex: number): void;
  onContextAction(action: 'close' | 'close-others' | 'close-right' | 'copy-path' | 'reveal', id: number): void;
}

export class TabBar {
  private readonly strip: HTMLDivElement;
  private readonly newButton: HTMLButtonElement;
  private dragId: number | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly deps: TabBarDeps
  ) {
    host.innerHTML = '';
    this.strip = document.createElement('div');
    this.strip.id = 'tab-strip';
    this.strip.setAttribute('role', 'tablist');
    this.newButton = document.createElement('button');
    this.newButton.type = 'button';
    this.newButton.id = 'tab-new';
    this.newButton.className = 'tab-action';
    this.newButton.textContent = '＋';
    this.newButton.addEventListener('click', () => this.deps.onNew());
    host.append(this.strip, this.newButton);

    // 触控板/滚轮在标签栏上滚动时横向移动，避免溢出标签不可见
    host.addEventListener(
      'wheel',
      (event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        host.scrollLeft += event.deltaY;
        event.preventDefault();
      },
      { passive: false }
    );
    this.render();
  }

  /** 重绘标签栏（数量、顺序、脏状态、激活项变化时调用）。 */
  render(): void {
    const metas = this.deps.metas();
    const activeId = this.deps.activeId();
    this.newButton.title = tr('tabs.new');
    this.newButton.setAttribute('aria-label', tr('tabs.new'));
    this.strip.innerHTML = '';
    for (const meta of metas) {
      const tab = document.createElement('div');
      tab.className = 'tab';
      tab.setAttribute('role', 'tab');
      tab.dataset.tabId = String(meta.id);
      const isActive = meta.id === activeId;
      tab.setAttribute('aria-selected', String(isActive));
      tab.classList.toggle('active', isActive);
      tab.title = meta.path ?? meta.name;

      const label = document.createElement('span');
      label.className = 'tab-label';
      // 未保存文档的显示名按当前语言计算，语言切换后重绘即生效（B5-7）
      label.textContent = meta.untitled ? tr('tabs.untitled') : meta.path ? baseName(meta.path) : meta.name;
      tab.append(label);

      const dirty = document.createElement('span');
      dirty.className = 'tab-dirty';
      dirty.textContent = '●';
      dirty.hidden = !meta.dirty;
      tab.append(dirty);

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.textContent = '×';
      close.title = tr('tabs.close');
      close.setAttribute('aria-label', tr('tabs.close'));
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        this.deps.onClose(meta.id);
      });
      tab.append(close);

      tab.addEventListener('mousedown', (event) => {
        if (event.button === 1) {
          event.preventDefault();
          this.deps.onClose(meta.id);
        }
      });
      this.attachDrag(tab, meta.id);
      tab.addEventListener('click', () => this.deps.onActivate(meta.id));
      tab.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.showContext(meta, event.clientX, event.clientY);
      });
      this.strip.append(tab);
    }
    this.scrollActiveIntoView();
  }

  /**
   * HTML5 拖拽排序：按指针落在目标标签的左右半区决定插入点，
   * 松手后把最终索引交给 `onReorder`（由 DocManager 回写设置）。
   */
  private attachDrag(tab: HTMLDivElement, id: number): void {
    tab.draggable = true;
    tab.addEventListener('dragstart', (event) => {
      this.dragId = id;
      tab.classList.add('dragging');
      if (!event.dataTransfer) return;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(id));
    });
    tab.addEventListener('dragover', (event) => {
      if (this.dragId === null || this.dragId === id) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      this.clearDropMarks();
      tab.classList.add(this.dropAfter(tab, event.clientX) ? 'drop-after' : 'drop-before');
    });
    tab.addEventListener('drop', (event) => {
      const dragged = this.dragId;
      if (dragged === null) return;
      event.preventDefault();
      const metas = this.deps.metas();
      const after = this.dropAfter(tab, event.clientX);
      const target = resolveDropIndex(metas, dragged, id, after);
      const from = metas.findIndex((item) => item.id === dragged);
      this.endDrag();
      if (target !== null && target !== from) this.deps.onReorder(dragged, target);
    });
    tab.addEventListener('dragend', () => this.endDrag());
  }

  private dropAfter(tab: HTMLElement, clientX: number): boolean {
    const rect = tab.getBoundingClientRect();
    return clientX > rect.left + rect.width / 2;
  }

  private clearDropMarks(): void {
    for (const item of this.strip.querySelectorAll<HTMLElement>('.drop-before, .drop-after')) {
      item.classList.remove('drop-before', 'drop-after');
    }
  }

  private endDrag(): void {
    this.dragId = null;
    this.clearDropMarks();
    for (const item of this.strip.querySelectorAll<HTMLElement>('.dragging')) item.classList.remove('dragging');
  }

  private showContext(meta: TabMeta, x: number, y: number): void {
    contextMenu({
      x,
      y,
      items: [
        { label: tr('tabs.close'), action: () => this.deps.onContextAction('close', meta.id) },
        { label: tr('tabs.closeOthers'), action: () => this.deps.onContextAction('close-others', meta.id) },
        { label: tr('tabs.closeRight'), action: () => this.deps.onContextAction('close-right', meta.id) },
        { separator: true },
        {
          label: tr('tabs.copyPath'),
          disabled: !meta.path,
          action: () => this.deps.onContextAction('copy-path', meta.id)
        },
        {
          label: tr('tabs.reveal'),
          disabled: !meta.path,
          action: () => this.deps.onContextAction('reveal', meta.id)
        }
      ]
    });
  }

  private scrollActiveIntoView(): void {
    const active = this.strip.querySelector<HTMLElement>('.tab.active');
    if (!active) return;
    const hostRect = this.host.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    if (rect.left < hostRect.left) this.host.scrollLeft -= hostRect.left - rect.left + 8;
    else if (rect.right > hostRect.right) this.host.scrollLeft += rect.right - hostRect.right + 8;
  }
}
