import type { SearchBatchEvent, SearchDoneEvent, SearchItem } from '../../shared/channels';
import { baseName } from '../../shared/paths';
import { tr } from '../i18n';
import { toast } from './dialogs';
import { VirtualList } from './virtual-list';

export interface SearchViewElements {
  input: HTMLInputElement;
  mode: HTMLSelectElement;
  case: HTMLInputElement;
  cancel: HTMLButtonElement;
  results: HTMLElement;
}

export interface SearchViewOptions {
  root(): string | null;
  onOpen(path: string, line?: number): void;
}

const DEBOUNCE_MS = 300;
/** 主进程已把总命中断在 2000；这里用虚拟滚动渲染全部（REQ-035）。 */
const MAX_RENDERED_HITS = 2000;
/** 估算行高；长路径/长命中行折行后的真实高度由 VirtualList 测量回填（B5-3）。 */
const ROW_HEIGHT_ESTIMATE = 22;

type SearchRow =
  | { kind: 'empty' }
  | { kind: 'file'; path: string }
  | { kind: 'hit'; path: string; item: SearchItem };

/** 文件搜索视图（REQ-011）：内容/文件名两种模式，结果分批到达、可取消。 */
export class SearchView {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentId = 0;
  private running = false;
  private readonly groups = new Map<string, SearchItem[]>();
  private summary: HTMLElement;
  private readonly list: VirtualList<SearchRow>;

  constructor(
    private readonly elements: SearchViewElements,
    private readonly options: SearchViewOptions
  ) {
    this.summary = document.createElement('div');
    this.summary.className = 'search-summary';
    this.summary.hidden = true;
    this.elements.results.after(this.summary);
    this.list = new VirtualList<SearchRow>({
      host: elements.results,
      rowHeight: { estimate: ROW_HEIGHT_ESTIMATE },
      renderRow: (row) => this.renderRow(row)
    });

    this.elements.input.addEventListener('input', () => this.schedule());
    this.elements.mode.addEventListener('change', () => this.schedule(true));
    this.elements.case.addEventListener('change', () => this.schedule(true));
    this.elements.cancel.addEventListener('click', () => void this.cancel());
    this.elements.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.schedule(true);
      if (event.key === 'Escape') void this.cancel();
      event.stopPropagation();
    });

    window.mdstudio.onSearchBatch((event) => this.handleBatch(event));
    window.mdstudio.onSearchDone((event) => this.handleDone(event));
  }

  focusInput(): void {
    this.elements.input.focus();
    this.elements.input.select();
  }

  get query(): string {
    return this.elements.input.value.trim();
  }

  schedule(immediate = false): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, immediate ? 0 : DEBOUNCE_MS);
  }

  async cancel(): Promise<void> {
    if (!this.running) return;
    await window.mdstudio.cancelSearch();
  }

  private async run(): Promise<void> {
    const query = this.query;
    const root = this.options.root();
    this.groups.clear();
    this.list.setItems([]);
    this.summary.hidden = true;
    if (!query) {
      this.running = false;
      this.elements.cancel.hidden = true;
      this.list.setItems([]);
      return;
    }
    if (!root) {
      this.summary.hidden = false;
      this.summary.textContent = tr('search.noRoot');
      toast(tr('toast.openFolderFirst'), 'warn');
      return;
    }
    const { id } = await window.mdstudio.startSearch({
      root,
      query,
      mode: this.elements.mode.value === 'name' ? 'name' : 'content',
      caseSensitive: this.elements.case.checked
    });
    this.currentId = id;
    this.running = true;
    this.elements.cancel.hidden = false;
    this.summary.hidden = false;
    this.summary.textContent = tr('search.running');
  }

  private handleBatch(event: SearchBatchEvent): void {
    if (event.id !== this.currentId) return;
    let rendered = 0;
    for (const item of event.items) {
      const group = this.groups.get(item.path) ?? [];
      group.push(item);
      this.groups.set(item.path, group);
      rendered += 1;
    }
    if (rendered > 0) this.render();
    this.summary.hidden = false;
    this.summary.textContent = tr('search.scanning', { files: event.scannedFiles, matches: event.matchCount });
  }

  private handleDone(event: SearchDoneEvent): void {
    if (event.id !== this.currentId) return;
    this.running = false;
    this.elements.cancel.hidden = true;
    this.summary.hidden = false;
    const seconds = (event.elapsedMs / 1000).toFixed(2);
    const suffix = event.truncated ? tr('search.truncated') : event.canceled ? tr('search.canceled') : '';
    this.summary.textContent = `${tr('search.summary', {
      matches: event.matches,
      groups: this.groups.size,
      files: event.files,
      seconds
    })}${suffix}`;
    this.list.setItems(this.rows(event.matches === 0 && !event.canceled));
  }

  /** 重画结果列表（语言切换后重用当前分组）。 */
  render(): void {
    this.list.setItems(this.rows(false));
  }

  /** 扁平化为「文件标题 + 命中行」，交给虚拟列表按视口渲染。 */
  private rows(empty: boolean): SearchRow[] {
    if (empty) return [{ kind: 'empty' }];
    const rows: SearchRow[] = [];
    let hits = 0;
    for (const [path, items] of this.groups) {
      if (hits >= MAX_RENDERED_HITS) break;
      rows.push({ kind: 'file', path });
      for (const item of items) {
        if (hits >= MAX_RENDERED_HITS) break;
        hits += 1;
        rows.push({ kind: 'hit', path, item });
      }
    }
    return rows;
  }

  private renderRow(row: SearchRow): HTMLElement {
    if (row.kind === 'empty') {
      const empty = document.createElement('div');
      empty.className = 'pane-empty';
      empty.textContent = tr('search.emptyResult');
      return empty;
    }
    if (row.kind === 'file') {
      const heading = document.createElement('div');
      heading.className = 'search-file-name';
      heading.textContent = baseName(row.path);
      heading.title = row.path;
      return heading;
    }

    const item = row.item;
    const hit = document.createElement('button');
    hit.type = 'button';
    hit.className = 'search-hit';
    if (item.kind === 'name') {
      hit.textContent = `${item.name}${tr('search.nameMatch')}`;
    } else {
      hit.title = `${item.path}:${item.line ?? 1}:${item.column ?? 1}`;
      const text = item.text ?? '';
      const column = (item.column ?? 1) - 1;
      const length = this.query.length;
      const before = document.createTextNode(text.slice(0, column));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(column, column + length);
      const after = document.createTextNode(text.slice(column + length));
      hit.append(document.createTextNode(`${item.line ?? 1}: `), before, mark, after);
    }
    hit.addEventListener('click', () => this.options.onOpen(item.path, item.line));
    return hit;
  }
}
