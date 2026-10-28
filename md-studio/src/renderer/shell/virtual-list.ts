/**
 * 通用虚拟列表（REQ-035 / B4-4 / B5-3）：只渲染视口附近的条目。
 *
 * 两种行高模式：
 * - 固定：传 `rowHeight: number`，位置用乘法直接算（最快，适合等宽单行）；
 * - 测量：传 `rowHeight: { estimate, measure? }`，渲染后回填真实高度并按前缀和定位，
 *   允许标题折行；测量结果缓存，滚动回已渲染过的区域不再重算。
 *
 * 用于大纲与搜索结果这类可能上万条的长列表：DOM 节点数始终是「可见行 + 缓冲」，
 * 与总条数无关。纯计算部分（`computeWindow` / `computeVariableWindow`）不依赖 DOM，便于单测。
 */

export interface WindowInput {
  total: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  buffer?: number;
}

export interface WindowRange {
  /** 渲染起点（含） */
  start: number;
  /** 渲染终点（不含） */
  end: number;
  /** 顶部占位高度（像素） */
  paddingTop: number;
  /** 底部占位高度（像素） */
  paddingBottom: number;
  /** 总高度 */
  totalHeight: number;
}

/** 动态行高参数：`estimate` 用于未测量过的行，`measure` 可注入自定义测量（测试用）。 */
export interface MeasuredRowHeight {
  estimate: number;
  measure?(row: HTMLElement): number;
}

export type RowHeight = number | MeasuredRowHeight;

export const DEFAULT_BUFFER_ROWS = 8;

/** 测量值下限：避免空行/隐藏行把索引压成 0 高。 */
export const MIN_ROW_HEIGHT = 8;

/** 计算窗口区间；空列表返回全 0。 */
export function computeWindow(input: WindowInput): WindowRange {
  const total = Math.max(0, Math.floor(input.total));
  const rowHeight = Math.max(1, input.rowHeight);
  const buffer = Math.max(0, input.buffer ?? DEFAULT_BUFFER_ROWS);
  const totalHeight = total * rowHeight;
  if (total === 0) return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0, totalHeight: 0 };
  const viewport = Math.max(rowHeight, input.viewportHeight);
  const firstVisible = Math.floor(Math.max(0, input.scrollTop) / rowHeight);
  const visibleCount = Math.ceil(viewport / rowHeight) + 1;
  const start = Math.max(0, Math.min(total, firstVisible - buffer));
  const end = Math.max(start, Math.min(total, firstVisible + visibleCount + buffer));
  return {
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: (total - end) * rowHeight,
    totalHeight
  };
}

export interface VariableWindowInput {
  /** 每行已测量的高度；缺失索引用 `estimate` 补齐 */
  heights: readonly number[];
  total: number;
  estimate: number;
  viewportHeight: number;
  scrollTop: number;
  buffer?: number;
}

/** 行高前缀和（长度 total+1，`offsets[i]` 是第 i 行的顶部偏移）。 */
export function buildOffsets(heights: readonly number[], total: number, estimate: number): Float64Array {
  const offsets = new Float64Array(total + 1);
  for (let index = 0; index < total; index++) {
    const height = heights[index];
    offsets[index + 1] = offsets[index]! + (typeof height === 'number' && height > 0 ? height : estimate);
  }
  return offsets;
}

/** 二分查找：返回最后一个顶部偏移 ≤ scrollTop 的行索引（空列表返回 0）。 */
export function indexAtOffset(offsets: Float64Array, scrollTop: number): number {
  const total = offsets.length - 1;
  if (total <= 0) return 0;
  let low = 0;
  let high = total - 1;
  let result = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (offsets[mid]! <= scrollTop) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

/** 动态行高窗口：与前缀和同源，因此占位高度与真实行高一致。 */
export function computeVariableWindow(input: VariableWindowInput): WindowRange {
  const total = Math.max(0, Math.floor(input.total));
  const estimate = Math.max(MIN_ROW_HEIGHT, input.estimate);
  const buffer = Math.max(0, input.buffer ?? DEFAULT_BUFFER_ROWS);
  if (total === 0) return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0, totalHeight: 0 };
  const offsets = buildOffsets(input.heights, total, estimate);
  const totalHeight = offsets[total]!;
  const scrollTop = Math.min(Math.max(0, input.scrollTop), Math.max(0, totalHeight - 1));
  const firstVisible = indexAtOffset(offsets, scrollTop);
  // 视口底部对应的行：从首行开始累计高度直到越过视口
  const bottom = scrollTop + Math.max(estimate, input.viewportHeight);
  let lastVisible = firstVisible;
  while (lastVisible < total - 1 && offsets[lastVisible + 1]! < bottom) lastVisible += 1;
  const start = Math.max(0, firstVisible - buffer);
  const end = Math.min(total, lastVisible + 1 + buffer);
  return {
    start,
    end,
    paddingTop: offsets[start]!,
    paddingBottom: totalHeight - offsets[end]!,
    totalHeight
  };
}

export interface VirtualListOptions<T> {
  /** 滚动容器（自身滚动） */
  host: HTMLElement;
  /** 固定行高，或 `{ estimate }` 启用测量式动态行高 */
  rowHeight: RowHeight;
  buffer?: number;
  /** 渲染单行；返回元素会被放进列表 */
  renderRow(item: T, index: number): HTMLElement;
  /** 行高变化等场景下取当前视口高度（默认取 host.clientHeight） */
  viewportHeight?(): number;
}

/** 窗口化列表：`setItems` 后按滚动位置增量渲染。 */
export class VirtualList<T> {
  private items: T[] = [];
  private readonly inner: HTMLDivElement;
  private readonly topSpacer: HTMLDivElement;
  private readonly rowsHost: HTMLDivElement;
  private readonly bottomSpacer: HTMLDivElement;
  /** 动态行高模式的测量缓存（索引 → 真实高度） */
  private heights: number[] = [];
  private frame = 0;
  private lastStart = -1;
  private lastEnd = -1;

  constructor(private readonly options: VirtualListOptions<T>) {
    const { host } = options;
    host.classList.add('virtual-list');
    host.innerHTML = '';
    this.inner = document.createElement('div');
    this.inner.className = 'virtual-list-inner';
    this.topSpacer = document.createElement('div');
    this.topSpacer.className = 'virtual-list-spacer';
    this.rowsHost = document.createElement('div');
    this.rowsHost.className = 'virtual-list-rows';
    this.bottomSpacer = document.createElement('div');
    this.bottomSpacer.className = 'virtual-list-spacer';
    this.inner.append(this.topSpacer, this.rowsHost, this.bottomSpacer);
    host.append(this.inner);
    host.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onScroll);
  }

  get renderedCount(): number {
    return this.rowsHost.childElementCount;
  }

  get itemCount(): number {
    return this.items.length;
  }

  /** 动态行高模式下某行当前使用的行高（测量值或估算值）。 */
  rowHeightAt(index: number): number {
    const measured = this.heights[index];
    if (typeof measured === 'number' && measured > 0) return measured;
    return this.estimate();
  }

  setItems(items: readonly T[]): void {
    this.items = [...items];
    // 条目变化后旧测量结果不再对应，整表重置为估算值
    this.heights = [];
    this.lastStart = -1;
    this.lastEnd = -1;
    this.update(true);
  }

  /** 强制重画（语言切换、主题变化后重建行文本）。 */
  refresh(): void {
    this.lastStart = -1;
    this.lastEnd = -1;
    this.update(true);
  }

  scrollToIndex(index: number): void {
    const { host } = this.options;
    const target = Math.max(0, Math.min(this.items.length, index));
    if (typeof this.options.rowHeight === 'number') {
      host.scrollTop = target * this.options.rowHeight;
    } else {
      const offsets = buildOffsets(this.heights, this.items.length, this.estimate());
      host.scrollTop = offsets[Math.min(target, this.items.length)] ?? 0;
    }
    this.update(true);
  }

  destroy(): void {
    this.options.host.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onScroll);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.options.host.innerHTML = '';
    this.options.host.classList.remove('virtual-list');
  }

  private estimate(): number {
    const { rowHeight } = this.options;
    return typeof rowHeight === 'number' ? Math.max(1, rowHeight) : Math.max(MIN_ROW_HEIGHT, rowHeight.estimate);
  }

  private readonly onScroll = (): void => {
    this.update(false);
  };

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update(false);
    });
  }

  private range(viewportHeight: number): WindowRange {
    const { rowHeight } = this.options;
    const scrollTop = this.options.host.scrollTop;
    if (typeof rowHeight === 'number') {
      return computeWindow({
        total: this.items.length,
        rowHeight,
        viewportHeight,
        scrollTop,
        buffer: this.options.buffer
      });
    }
    return computeVariableWindow({
      heights: this.heights,
      total: this.items.length,
      estimate: this.estimate(),
      viewportHeight,
      scrollTop,
      buffer: this.options.buffer
    });
  }

  private update(force: boolean): void {
    const viewportHeight = this.options.viewportHeight?.() ?? this.options.host.clientHeight;
    if (viewportHeight <= 0) {
      // 容器尚未布局（面板隐藏）：下次滚动/显示时再画
      this.schedule();
      return;
    }
    const range = this.range(viewportHeight);
    this.topSpacer.style.height = `${range.paddingTop}px`;
    this.bottomSpacer.style.height = `${range.paddingBottom}px`;
    if (!force && range.start === this.lastStart && range.end === this.lastEnd) return;
    this.lastStart = range.start;
    this.lastEnd = range.end;
    const fragment = document.createDocumentFragment();
    for (let index = range.start; index < range.end; index++) {
      const item = this.items[index];
      if (item === undefined) continue;
      fragment.append(this.options.renderRow(item, index));
    }
    this.rowsHost.replaceChildren(fragment);
    this.measureRows(range.start);
  }

  /** 测量刚渲染的行，回填缓存并修正占位高度（固定行高模式直接跳过）。 */
  private measureRows(start: number): void {
    if (typeof this.options.rowHeight === 'number') return;
    const measure = this.options.rowHeight.measure;
    let changed = false;
    const rows = this.rowsHost.children;
    for (let offset = 0; offset < rows.length; offset++) {
      const row = rows[offset] as HTMLElement;
      const index = start + offset;
      const raw = measure ? measure(row) : row.getBoundingClientRect().height;
      // happy-dom 等无布局环境返回 0：保留估算值，等价于固定行高
      if (!Number.isFinite(raw) || raw <= 0) continue;
      const height = Math.min(4000, Math.max(MIN_ROW_HEIGHT, raw));
      const previous = this.heights[index];
      if (previous === undefined || Math.abs(previous - height) > 0.5) {
        this.heights[index] = height;
        changed = true;
      }
    }
    if (!changed) return;
    // 行高变化会影响后续行的偏移：只更新占位，不重建已渲染的行
    const viewportHeight = this.options.viewportHeight?.() ?? this.options.host.clientHeight;
    if (viewportHeight <= 0) return;
    const range = this.range(viewportHeight);
    this.topSpacer.style.height = `${range.paddingTop}px`;
    this.bottomSpacer.style.height = `${range.paddingBottom}px`;
  }
}
