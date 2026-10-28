import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { computeDecorations, mightContainBlocks } from '../../src/renderer/editor/live-preview';
import {
  FenceChipWidget,
  HrWidget,
  ImageWidget,
  MathWidget,
  MermaidWidget,
  TableWidget,
  TaskWidget
} from '../../src/renderer/editor/widgets';

interface Collected {
  from: number;
  to: number;
  cls?: string;
  attrs?: Record<string, string>;
  widget?: unknown;
  line: boolean;
}

function stateFor(doc: string, anchor: number): EditorState {
  return EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ base: markdownLanguage })] });
}

function collect(doc: string, anchor: number, docDir: string | null = '/proj/docs'): Collected[] {
  const state = stateFor(doc, anchor);
  const sets = computeDecorations(state, [{ from: 0, to: state.doc.length }], { getDocDir: () => docDir });
  const items: Collected[] = [];
  sets.decorations.between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string; attributes?: Record<string, string>; widget?: unknown };
    items.push({ from, to, cls: spec.class, attrs: spec.attributes, widget: spec.widget, line: from === to });
  });
  return items;
}

function widgets(items: Collected[]): unknown[] {
  return items.filter((item) => item.widget !== undefined).map((item) => item.widget);
}

describe('标题', () => {
  const doc = '# 标题\n\n正文';

  it('非活动标题隐藏 # 并加大字号', () => {
    const items = collect(doc, 5);
    expect(items.some((item) => item.cls === 'md-h md-h1')).toBe(true);
    expect(items.some((item) => item.from === 0 && item.to === 2 && item.widget === undefined)).toBe(true);
  });

  it('光标所在标题露出源码', () => {
    const items = collect(doc, 3);
    expect(items.some((item) => item.from === 0 && item.to === 2)).toBe(false);
  });
});

describe('强调 / 行内代码 / 删除线', () => {
  it('加粗标记与非活动隐藏两端 **', () => {
    const items = collect('**粗**\n\nx', 8);
    expect(items.some((item) => item.cls === 'md-strong')).toBe(true);
    const hides = items.filter((item) => item.widget === undefined && item.from !== item.to && item.to - item.from === 2);
    expect(hides.length).toBeGreaterThanOrEqual(2);
  });

  it('活动时保留标记', () => {
    const items = collect('**粗**', 2);
    const hides = items.filter((item) => item.widget === undefined && item.to - item.from === 2 && item.from < 2);
    expect(hides).toHaveLength(0);
  });

  it('行内代码与删除线打标', () => {
    const items = collect('`code` 与 ~~旧~~\n\nx', 14);
    expect(items.some((item) => item.cls === 'md-code')).toBe(true);
    expect(items.some((item) => item.cls === 'md-strike')).toBe(true);
  });
});

describe('任务框 / 分隔线 / 链接', () => {
  it('任务框渲染为可点击 widget（含位置与勾选状态）', () => {
    const items = collect('- [ ] 待办\n\nx', 10);
    const task = widgets(items).find((widget) => widget instanceof TaskWidget) as TaskWidget | undefined;
    expect(task).toBeDefined();
    expect(task?.eq(new TaskWidget(false, 2))).toBe(true);
    expect(task?.eq(new TaskWidget(false, 9))).toBe(false);
    expect(task?.eq(new TaskWidget(true, 2))).toBe(false);
  });

  it('已完成任务框为选中态', () => {
    const items = collect('- [x] 完成\n\nx', 10);
    expect(widgets(items).some((widget) => widget instanceof TaskWidget)).toBe(true);
  });

  it('光标在任务行时显示源码', () => {
    const items = collect('- [ ] 待办', 4);
    expect(widgets(items).some((widget) => widget instanceof TaskWidget)).toBe(false);
  });

  it('分隔线渲染为 hr widget', () => {
    const items = collect('---\n\nx', 5);
    expect(widgets(items).some((widget) => widget instanceof HrWidget)).toBe(true);
  });

  it('链接非活动时隐藏标记并保留 href', () => {
    const items = collect('[文字](https://a.example)\n\nx', 25);
    const link = items.find((item) => item.cls === 'md-link');
    expect(link?.attrs?.['data-href']).toBe('https://a.example');
    const hiddenChars = items.filter((item) => item.widget === undefined && item.to > item.from).reduce((sum, item) => sum + (item.cls ? 0 : item.to - item.from), 0);
    expect(hiddenChars).toBeGreaterThan(0);
  });
});

describe('围栏代码块', () => {
  const doc = '```js\nconst a = 1;\n```\n\nx';

  it('非活动块隐藏围栏并显示语言标签', () => {
    const items = collect(doc, doc.length);
    const chip = widgets(items).find((widget) => widget instanceof FenceChipWidget) as FenceChipWidget | undefined;
    expect(chip).toBeDefined();
    expect(chip?.eq(new FenceChipWidget('js'))).toBe(true);
    expect(items.filter((item) => item.cls === 'md-codeblock')).toHaveLength(3);
  });

  it('光标进入代码块显示源码', () => {
    const items = collect(doc, 8);
    expect(widgets(items).some((widget) => widget instanceof FenceChipWidget)).toBe(false);
  });

  it('mermaid 围栏渲染为图表 widget', () => {
    const doc = '```mermaid\ngraph TD\n  A-->B\n```\n\nx';
    const items = collect(doc, doc.length);
    expect(widgets(items).some((widget) => widget instanceof MermaidWidget)).toBe(true);
  });
});

describe('表格 / 公式 / 图片', () => {
  const table = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n尾';

  it('非活动表格渲染为表格 widget', () => {
    const items = collect(table, table.length - 1);
    expect(widgets(items).some((widget) => widget instanceof TableWidget)).toBe(true);
  });

  it('光标在表格内显示源码', () => {
    const items = collect(table, 2);
    expect(widgets(items).some((widget) => widget instanceof TableWidget)).toBe(false);
  });

  it('行内公式与块级公式渲染为 KaTeX widget', () => {
    const inlineDoc = '$x^2$\n\n尾';
    const inline = collect(inlineDoc, inlineDoc.length);
    expect(widgets(inline).some((widget) => widget instanceof MathWidget)).toBe(true);
    const blockDoc = '$$\n\\int_0^1 x dx\n$$\n\n尾';
    const block = collect(blockDoc, blockDoc.length);
    expect(widgets(block).some((widget) => widget instanceof MathWidget)).toBe(true);
  });

  it('非法公式保留源码并标注错误', () => {
    const doc = '$\\frac{1}{$\n\n尾';
    const items = collect(doc, doc.length);
    expect(items.some((item) => item.cls === 'md-math-error')).toBe(true);
    expect(widgets(items).some((widget) => widget instanceof MathWidget)).toBe(false);
  });

  it('图片渲染为图片 widget（相对路径解析到文档目录）', () => {
    const doc = '![图](./assets/a.png)\n\n尾';
    const items = collect(doc, doc.length);
    expect(widgets(items).some((widget) => widget instanceof ImageWidget)).toBe(true);
  });
});

describe('插件/状态域分工（CM6：插件不得替换换行）', () => {
  const table = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n尾';

  it('skipBlocks：插件侧不产出跨行 widget，但给出 blockRanges 与原子域', () => {
    const state = stateFor(table, table.length);
    const sets = computeDecorations(state, [{ from: 0, to: state.doc.length }], { getDocDir: () => null }, { skipBlocks: true });
    let hasTableWidget = false;
    sets.decorations.between(0, state.doc.length, (_from, _to, value) => {
      if ((value.spec as { widget?: unknown }).widget instanceof TableWidget) hasTableWidget = true;
    });
    expect(hasTableWidget).toBe(false);
    let blockCount = 0;
    sets.blockRanges.between(0, state.doc.length, () => {
      blockCount += 1;
    });
    expect(blockCount).toBeGreaterThan(0);
  });

  it('onlyBlocks：状态域只产出跨行块 widget（表格/图表/块级公式）', () => {
    const doc = [table, '```mermaid', 'graph TD', '  A-->B', '```', '', '$$', 'x^2', '$$', '', '尾'].join('\n');
    const state = stateFor(doc, doc.length);
    const sets = computeDecorations(state, [{ from: 0, to: state.doc.length }], { getDocDir: () => null }, { onlyBlocks: true });
    const found: unknown[] = [];
    sets.decorations.between(0, state.doc.length, (_from, _to, value) => {
      const widget = (value.spec as { widget?: unknown }).widget;
      if (widget) found.push(widget);
    });
    expect(found.some((widget) => widget instanceof TableWidget)).toBe(true);
    expect(found.some((widget) => widget instanceof MermaidWidget)).toBe(true);
    expect(found.some((widget) => widget instanceof MathWidget)).toBe(true);
  });

  it('onlyBlocks 不产出行内/行类装饰', () => {
    const state = stateFor('# 标题\n\n**粗** $x$', 12);
    const sets = computeDecorations(state, [{ from: 0, to: state.doc.length }], { getDocDir: () => null }, { onlyBlocks: true });
    expect(sets.decorations.size).toBe(0);
  });
});

describe('装饰稳定性', () => {
  it('原子区间覆盖 widget 替换范围（光标不可落入）', () => {
    const doc = '```mermaid\ngraph TD\n  A-->B\n```\n\nx';
    const state = stateFor(doc, doc.length);
    const sets = computeDecorations(state, [{ from: 0, to: state.doc.length }], { getDocDir: () => null });
    let atomicCount = 0;
    sets.atomicRanges.between(0, state.doc.length, () => {
      atomicCount += 1;
    });
    expect(atomicCount).toBeGreaterThan(0);
  });

  it('同一文档重复计算结果一致（确定性投影）', () => {
    const doc = '# 标题\n\n- [ ] 任务\n\n$e^x$';
    const first = collect(doc, 0).map((item) => `${item.from}:${item.to}:${item.cls ?? ''}`);
    const second = collect(doc, 0).map((item) => `${item.from}:${item.to}:${item.cls ?? ''}`);
    expect(first).toEqual(second);
  });
});
