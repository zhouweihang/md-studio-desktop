/**
 * 多标签会话池（REQ-032）：单窗口多文档。
 *
 * 设计要点：
 * - 每个标签持有自己的 `EditorState`（撤销栈、选区、装饰随状态保留），`EditorView` 全局单实例；
 * - 切换标签 = 把当前 `view.state` 回存到旧标签 → `view.setState(新标签.state)`；
 * - 会话池不含 DOM 与 IPC，便于单测；文件名等展示文案由调用方注入（i18n）。
 */

import type { EditorState } from '@codemirror/state';
import { baseName } from '../shared/paths';
import type { TabSnapshot } from '../shared/settings';

export interface TabOptions {
  content: string;
  path?: string | null;
  /** 展示名（未保存文档由调用方给出本地化名称） */
  name?: string;
  mtimeMs?: number | null;
  dirty?: boolean;
  anchor?: number;
  scrollTop?: number;
}

export interface TabRecord {
  id: number;
  path: string | null;
  name: string;
  /** 未保存文档：显示名由渲染时按当前语言计算，不依赖存储的 `name`（B5-7） */
  untitled: boolean;
  mtimeMs: number | null;
  dirty: boolean;
  state: EditorState;
  /** 切换标签时回存的滚动位置 */
  scrollTop: number;
  lastDraftLength: number;
  /** 供关闭逻辑使用的每标签计时器（自动保存 / 草稿） */
  autosaveTimer: ReturnType<typeof setTimeout> | null;
  draftTimer: ReturnType<typeof setTimeout> | null;
}

export interface TabMeta {
  id: number;
  path: string | null;
  name: string;
  /** 未保存文档（显示名请用 `tr('tabs.untitled')`） */
  untitled: boolean;
  dirty: boolean;
}

/** 创建 `EditorState` 的工厂（来自编辑器装配，保证扩展一致）。 */
export type StateFactory = (content: string, anchor?: number) => EditorState;

export class SessionPool {
  private items: TabRecord[] = [];
  private activeId: number | null = null;
  private seq = 0;

  constructor(private readonly makeState: StateFactory) {}

  get size(): number {
    return this.items.length;
  }

  get all(): readonly TabRecord[] {
    return this.items;
  }

  get active(): TabRecord | null {
    if (this.activeId === null) return null;
    return this.items.find((item) => item.id === this.activeId) ?? null;
  }

  get currentId(): number | null {
    return this.activeId;
  }

  /** 追加标签并激活（内容已就绪，例如新建文档或已从磁盘读出）。 */
  add(options: TabOptions): TabRecord {
    const id = ++this.seq;
    const tab: TabRecord = {
      id,
      path: options.path ?? null,
      name: options.name ?? (options.path ? baseName(options.path) : ''),
      untitled: !options.path,
      mtimeMs: options.mtimeMs ?? null,
      dirty: options.dirty ?? false,
      state: this.makeState(options.content, options.anchor ?? 0),
      scrollTop: options.scrollTop ?? 0,
      lastDraftLength: options.content.length,
      autosaveTimer: null,
      draftTimer: null
    };
    this.items.push(tab);
    this.activeId = id;
    return tab;
  }

  find(id: number): TabRecord | null {
    return this.items.find((item) => item.id === id) ?? null;
  }

  findByPath(path: string): TabRecord | null {
    return this.items.find((item) => item.path === path) ?? null;
  }

  indexOf(id: number): number {
    return this.items.findIndex((item) => item.id === id);
  }

  /** 激活指定标签；返回是否发生切换。 */
  activate(id: number): boolean {
    if (this.activeId === id) return false;
    if (!this.find(id)) return false;
    this.activeId = id;
    return true;
  }

  /** 相对激活：`delta` 为 ±1 时按顺序循环切换（Ctrl+Tab / Ctrl+Shift+Tab）。 */
  activateRelative(delta: number): boolean {
    if (this.items.length < 2) return false;
    const current = this.activeId === null ? 0 : this.indexOf(this.activeId);
    const next = ((current + delta) % this.items.length + this.items.length) % this.items.length;
    const target = this.items[next];
    if (!target || target.id === this.activeId) return false;
    this.activeId = target.id;
    return true;
  }

  /** 把视图当前状态回存到标签（切换标签 / 取快照前调用）。 */
  storeState(id: number, state: EditorState, scrollTop?: number): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.state = state;
    if (typeof scrollTop === 'number') tab.scrollTop = scrollTop;
  }

  setDirty(id: number, dirty: boolean): void {
    const tab = this.find(id);
    if (!tab || tab.dirty === dirty) return;
    tab.dirty = dirty;
  }

  rename(id: number, name: string): void {
    const tab = this.find(id);
    if (tab) tab.name = name;
  }

  /** 绑定/解绑磁盘路径；未保存标记随之切换（另存为、重命名、删除文件都走这里）。 */
  setPath(id: number, path: string | null): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.path = path;
    tab.untitled = !path;
    if (path) tab.name = baseName(path);
  }

  /** 关闭标签；返回关闭后应激活的标签 id。池空时返回 null（调用方决定是否补一个空标签）。 */
  close(id: number): number | null {
    const index = this.indexOf(id);
    if (index < 0) return this.activeId;
    const [removed] = this.items.splice(index, 1);
    if (removed) {
      if (removed.autosaveTimer) clearTimeout(removed.autosaveTimer);
      if (removed.draftTimer) clearTimeout(removed.draftTimer);
    }
    if (this.items.length === 0) {
      this.activeId = null;
      return null;
    }
    if (this.activeId === id) {
      const next = this.items[Math.min(index, this.items.length - 1)];
      this.activeId = next ? next.id : null;
    }
    return this.activeId;
  }

  /** 关闭除 `id` 之外的全部标签，返回被关闭的标签（供草稿清理等钩子使用）。 */
  closeOthers(id: number): TabRecord[] {
    if (!this.find(id)) return [];
    const removed = this.items.filter((item) => item.id !== id);
    for (const tab of removed) this.close(tab.id);
    this.activeId = id;
    return removed;
  }

  /** 关闭 `id` 右侧的全部标签。 */
  closeRight(id: number): TabRecord[] {
    const index = this.indexOf(id);
    if (index < 0) return [];
    const removed = this.items.slice(index + 1);
    for (const tab of removed) this.close(tab.id);
    this.activeId = id;
    return removed;
  }

  /** 调整标签顺序（拖拽为后续项，本轮仅提供键盘/命令入口）。 */
  move(id: number, delta: number): boolean {
    const index = this.indexOf(id);
    if (index < 0) return false;
    const target = index + delta;
    if (target < 0 || target >= this.items.length) return false;
    const [item] = this.items.splice(index, 1);
    if (!item) return false;
    this.items.splice(target, 0, item);
    return true;
  }

  /** 拖拽排序：把 `id` 移到数组的 `targetIndex` 位置（0 基，超界自动收拢）。 */
  moveTo(id: number, targetIndex: number): boolean {
    const index = this.indexOf(id);
    if (index < 0) return false;
    const target = Math.max(0, Math.min(this.items.length - 1, targetIndex));
    if (target === index) return false;
    const [item] = this.items.splice(index, 1);
    if (!item) return false;
    this.items.splice(target, 0, item);
    return true;
  }

  metas(): TabMeta[] {
    return this.items.map((item) => ({
      id: item.id,
      path: item.path,
      name: item.name,
      untitled: item.untitled,
      dirty: item.dirty
    }));
  }

  /** 会话快照（写入 `settings.tabs`）：只保存路径与游标，未保存内容不入设置。 */
  snapshot(): { open: TabSnapshot[]; active: number } {
    const open = this.items.map((item) => ({
      path: item.path,
      name: item.name,
      anchor: item.state.selection.main.head
    }));
    return { open, active: Math.max(0, this.indexOf(this.activeId ?? -1)) };
  }
}
