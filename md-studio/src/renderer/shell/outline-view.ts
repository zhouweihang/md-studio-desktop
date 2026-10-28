import { extractOutline, type OutlineItem } from '../../shared/outline';
import { tr } from '../i18n';
import { VirtualList } from './virtual-list';

export interface OutlineViewOptions {
  onJump(item: OutlineItem): void;
}

type OutlineRow = { kind: 'empty' } | { kind: 'heading'; item: OutlineItem };

/** 估算行高；实际行高由 VirtualList 测量回填（长标题允许折行，B5-3）。 */
const ROW_HEIGHT_ESTIMATE = 26;

/** 大纲视图（REQ-012/035）：从文档文本抽取标题树，虚拟滚动渲染，点击跳转。 */
export class OutlineView {
  private items: OutlineItem[] = [];
  private activeLine = 0;
  private readonly list: VirtualList<OutlineRow>;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: OutlineViewOptions
  ) {
    this.list = new VirtualList<OutlineRow>({
      host: container,
      rowHeight: { estimate: ROW_HEIGHT_ESTIMATE },
      renderRow: (row) => this.renderRow(row)
    });
  }

  update(text: string): void {
    this.items = extractOutline(text);
    this.list.setItems(this.rows());
  }

  setActiveLine(line: number): void {
    if (this.activeLine === line) return;
    const previous = this.activeItem();
    this.activeLine = line;
    const next = this.activeItem();
    if (previous?.line !== next?.line) this.list.refresh();
  }

  getItems(): OutlineItem[] {
    return this.items;
  }

  /** 语言切换后重画（标题行文本与提示随文案变化）。 */
  render(): void {
    this.list.refresh();
  }

  /** 当前标题列表（诊断/测试用）。 */
  get currentItems(): readonly OutlineItem[] {
    return this.items;
  }

  private rows(): OutlineRow[] {
    if (this.items.length === 0) return [{ kind: 'empty' }];
    return this.items.map((item) => ({ kind: 'heading', item }));
  }

  private activeItem(): OutlineItem | null {
    let active: OutlineItem | null = null;
    for (const item of this.items) {
      if (item.line <= this.activeLine) active = item;
      else break;
    }
    return active;
  }

  private renderRow(row: OutlineRow): HTMLElement {
    if (row.kind === 'empty') {
      const empty = document.createElement('div');
      empty.className = 'pane-empty';
      empty.textContent = `${tr('outline.empty')}\n${tr('outline.emptyHint')}`;
      return empty;
    }
    const { item } = row;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'outline-row';
    button.textContent = item.text;
    button.dataset.line = String(item.line);
    // 不再写死高度：长标题折行后的真实高度由列表测量
    button.style.paddingLeft = `${(item.level - 1) * 12 + 8}px`;
    button.title = tr('outline.tooltip', { marks: '#'.repeat(item.level), text: item.text, line: item.line });
    if (this.activeItem()?.line === item.line) button.classList.add('active');
    button.addEventListener('click', () => this.options.onJump(item));
    return button;
  }
}
