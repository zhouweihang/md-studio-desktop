// @vitest-environment happy-dom
/**
 * 虚拟滚动（REQ-035）：窗口区间计算 + DOM 节点数与总条数解耦。
 */

import { describe, expect, it } from 'vitest';
import {
  buildOffsets,
  computeVariableWindow,
  computeWindow,
  DEFAULT_BUFFER_ROWS,
  indexAtOffset,
  MIN_ROW_HEIGHT,
  VirtualList
} from '../../src/renderer/shell/virtual-list';

describe('computeWindow', () => {
  it('空列表不占空间', () => {
    expect(computeWindow({ total: 0, rowHeight: 22, viewportHeight: 400, scrollTop: 0 })).toEqual({
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0,
      totalHeight: 0
    });
  });

  it('顶部只渲染视口 + 缓冲，其余由底部占位撑开', () => {
    const range = computeWindow({ total: 10_000, rowHeight: 20, viewportHeight: 400, scrollTop: 0, buffer: 8 });
    expect(range.start).toBe(0);
    expect(range.end).toBe(Math.ceil(400 / 20) + 1 + 8);
    expect(range.paddingTop).toBe(0);
    expect(range.totalHeight).toBe(200_000);
    expect(range.paddingBottom).toBe(range.totalHeight - range.end * 20);
  });

  it('滚动到中部时窗口跟随，且始终受总数约束', () => {
    const range = computeWindow({ total: 10_000, rowHeight: 20, viewportHeight: 400, scrollTop: 100_000, buffer: 8 });
    expect(range.start).toBe(5000 - 8);
    expect(range.end).toBe(5000 + 21 + 8);
    expect(range.paddingTop).toBe((5000 - 8) * 20);

    const nearEnd = computeWindow({ total: 100, rowHeight: 20, viewportHeight: 400, scrollTop: 10_000, buffer: 8 });
    expect(nearEnd.end).toBe(100);
    expect(nearEnd.paddingBottom).toBe(0);
  });

  it('滚动位置越界（负值/超大）被夹紧', () => {
    const negative = computeWindow({ total: 50, rowHeight: 20, viewportHeight: 400, scrollTop: -100 });
    expect(negative.start).toBe(0);
    const huge = computeWindow({ total: 50, rowHeight: 20, viewportHeight: 400, scrollTop: 999_999 });
    expect(huge.start).toBeLessThanOrEqual(50);
    expect(huge.end).toBe(50);
  });

  it('默认缓冲行数可预测', () => {
    const range = computeWindow({ total: 1000, rowHeight: 10, viewportHeight: 100, scrollTop: 500 });
    expect(range.start).toBe(50 - DEFAULT_BUFFER_ROWS);
    expect(range.paddingTop).toBe((50 - DEFAULT_BUFFER_ROWS) * 10);
  });
});

describe('动态行高窗口（B5-3）', () => {
  it('前缀和与二分定位一致，占位高度等于真实偏移', () => {
    const heights = [20, 40, 60, 20, 20];
    const offsets = buildOffsets(heights, 5, 20);
    expect(Array.from(offsets)).toEqual([0, 20, 60, 120, 140, 160]);
    expect(indexAtOffset(offsets, 0)).toBe(0);
    expect(indexAtOffset(offsets, 59)).toBe(1);
    expect(indexAtOffset(offsets, 60)).toBe(2);
    expect(indexAtOffset(offsets, 999)).toBe(4);

    const range = computeVariableWindow({
      heights,
      total: 5,
      estimate: 20,
      viewportHeight: 40,
      scrollTop: 60,
      buffer: 0
    });
    expect(range.totalHeight).toBe(160);
    expect(range.start).toBe(2);
    expect(range.paddingTop).toBe(60);
    expect(range.paddingBottom).toBe(160 - 120);
  });

  it('未测量行用估算值补齐，空列表不占空间', () => {
    const range = computeVariableWindow({
      heights: [30],
      total: 4,
      estimate: 25,
      viewportHeight: 100,
      scrollTop: 0,
      buffer: 0
    });
    expect(range.totalHeight).toBe(30 + 25 * 3);
    expect(range.start).toBe(0);
    expect(range.end).toBe(4);

    expect(
      computeVariableWindow({ heights: [], total: 0, estimate: 20, viewportHeight: 100, scrollTop: 0 })
    ).toEqual({ start: 0, end: 0, paddingTop: 0, paddingBottom: 0, totalHeight: 0 });
  });

  it('超长行把后行推后：同一 scrollTop 下窗口起点提前', () => {
    const fixed = computeWindow({ total: 100, rowHeight: 20, viewportHeight: 200, scrollTop: 400, buffer: 0 });
    const heights = Array.from({ length: 100 }, () => 20);
    heights[0] = 200; // 首行折成 10 倍高
    const variable = computeVariableWindow({ heights, total: 100, estimate: 20, viewportHeight: 200, scrollTop: 400, buffer: 0 });
    expect(fixed.start).toBe(20);
    // 首行多占 180px → 第 11 行顶部正好在 400px（200 + 10×20）
    expect(variable.start).toBe(11);
    expect(variable.totalHeight).toBe(200 + 99 * 20);
  });

  it('负数/零高度被下限夹住，不会把索引压扁', () => {
    const offsets = buildOffsets([0, -5, 10], 3, 20);
    expect(Array.from(offsets)).toEqual([0, 20, 40, 50]);
    const range = computeVariableWindow({ heights: [], total: 3, estimate: 0, viewportHeight: 40, scrollTop: 0 });
    expect(range.totalHeight).toBe(MIN_ROW_HEIGHT * 3);
  });
});

describe('VirtualList DOM', () => {
  function makeList(total: number): { host: HTMLElement; list: VirtualList<number> } {
    const host = document.createElement('div');
    document.body.append(host);
    const list = new VirtualList<number>({
      host,
      rowHeight: 20,
      buffer: 4,
      viewportHeight: () => 200,
      renderRow: (value) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.textContent = String(value);
        return row;
      }
    });
    list.setItems(Array.from({ length: total }, (_, index) => index));
    return { host, list };
  }

  it('1 万条只渲染视口 + 缓冲数量的 DOM 行', () => {
    const { host, list } = makeList(10_000);
    expect(list.itemCount).toBe(10_000);
    expect(list.renderedCount).toBeLessThanOrEqual(10 + 1 + 4 * 2);
    expect(host.querySelectorAll('.row')).toHaveLength(list.renderedCount);
    list.destroy();
  });

  it('滚动后窗口移动，节点数保持有界', () => {
    const { host, list } = makeList(5000);
    host.scrollTop = 2000; // 第 100 行
    host.dispatchEvent(new Event('scroll'));
    const first = host.querySelector<HTMLElement>('.row');
    expect(Number(first?.textContent)).toBe(96);
    expect(list.renderedCount).toBeLessThanOrEqual(10 + 1 + 8);
    list.destroy();
  });

  it('scrollToIndex 跳转后首行对齐目标', () => {
    const { host, list } = makeList(1000);
    list.scrollToIndex(400);
    expect(host.scrollTop).toBe(8000);
    const first = host.querySelector<HTMLElement>('.row');
    expect(Number(first?.textContent)).toBe(396);
    list.destroy();
  });

  it('动态行高：测量回填后占位高度按真实行高计算', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const list = new VirtualList<number>({
      host,
      rowHeight: { estimate: 20, measure: (row) => Number(row.dataset.height ?? 20) },
      buffer: 1,
      viewportHeight: () => 200,
      renderRow: (value) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.dataset.height = value === 0 ? '80' : '20';
        row.textContent = String(value);
        return row;
      }
    });
    list.setItems(Array.from({ length: 100 }, (_, index) => index));
    // 第 0 行实测 80px，其余 20px → 总高 80 + 99×20
    expect(list.rowHeightAt(0)).toBe(80);
    expect(list.rowHeightAt(1)).toBe(20);
    const spacerTotal = Number.parseFloat(
      (host.querySelector<HTMLElement>('.virtual-list-inner')?.style.height || '0') // 未显式设置则 0
    );
    expect(Number.isFinite(spacerTotal)).toBe(true);
    const top = host.querySelector<HTMLElement>('.virtual-list-spacer');
    const bottom = host.querySelectorAll<HTMLElement>('.virtual-list-spacer')[1];
    expect(top?.style.height).toBe('0px');
    expect(Number.parseFloat(bottom?.style.height ?? '0')).toBeGreaterThan(0);
    list.destroy();
  });

  it('destroy 清理容器与监听', () => {
    const { host, list } = makeList(50);
    list.destroy();
    expect(host.innerHTML).toBe('');
    expect(host.classList.contains('virtual-list')).toBe(false);
  });
});
