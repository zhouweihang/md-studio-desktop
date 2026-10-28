// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { tableRangeAt } from '../../src/renderer/editor/table-toolbar';
import { buildContextMenuItems } from '../../src/renderer/shell/context-menu';
import type { ContextMenuEvent } from '../../src/shared/channels';

const DOC = ['# 标题', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', '正文'].join('\n');

function viewAt(anchor: number): EditorView {
  const state = EditorState.create({
    doc: DOC,
    selection: { anchor },
    extensions: [markdown({ base: markdownLanguage })]
  });
  return new EditorView({ state });
}

describe('tableRangeAt', () => {
  it('光标在表格内返回表格区间', () => {
    const view = viewAt(DOC.indexOf('| 1 |') + 2);
    const range = tableRangeAt(view);
    expect(range).not.toBeNull();
    expect(DOC.slice(range!.from, range!.to)).toContain('| A | B |');
  });

  it('光标在表格外返回 null', () => {
    expect(tableRangeAt(viewAt(1))).toBeNull();
    expect(tableRangeAt(viewAt(DOC.length))).toBeNull();
  });
});

describe('右键菜单条目（上下文相关）', () => {
  const base: ContextMenuEvent = {
    x: 0,
    y: 0,
    isEditable: true,
    hasSelection: false,
    selectionText: '',
    misspelledWord: '',
    suggestions: [],
    linkURL: null
  };

  const deps = {
    runCommand: () => undefined,
    isInsideTable: () => true,
    replaceMisspelling: () => undefined,
    openExternal: () => undefined,
    notify: () => undefined
  };

  it('基础菜单包含编辑与格式命令，且不含表格操作', () => {
    const items = buildContextMenuItems({ ...base }, { ...deps, isInsideTable: () => false });
    const labels = items.map((item) => item.label).filter(Boolean) as string[];
    expect(labels).toContain('复制');
    expect(labels).toContain('粘贴');
    expect(labels).toContain('加粗');
    expect(labels).toContain('高亮');
    expect(labels).toContain('脚注');
    expect(labels).toContain('查找…');
    expect(labels).not.toContain('在下方插入行');
  });

  it('在表格内追加表格操作，有选区时追加复制为…', () => {
    const items = buildContextMenuItems({ ...base, hasSelection: true, selectionText: 'x' }, deps);
    const labels = items.map((item) => item.label).filter(Boolean) as string[];
    expect(labels).toContain('在下方插入行');
    expect(labels).toContain('删除本列');
    expect(labels).toContain('复制为 Markdown');
    expect(labels).toContain('复制为 HTML');
  });

  it('拼写错误时给出建议且优先展示', () => {
    const items = buildContextMenuItems(
      { ...base, misspelledWord: 'typo', suggestions: ['type', 'top'] },
      deps
    );
    expect(items[0]?.label).toBe('type');
    expect(items[1]?.label).toBe('top');
    expect(items[2]?.separator).toBe(true);
  });

  it('没有建议时提示且禁用', () => {
    const items = buildContextMenuItems({ ...base, misspelledWord: 'zzz', suggestions: [] }, deps);
    expect(items[0]?.disabled).toBe(true);
    expect(items[0]?.label).toContain('zzz');
  });

  it('可编辑为假时不出现编辑项', () => {
    const items = buildContextMenuItems({ ...base, isEditable: false }, deps);
    const labels = items.map((item) => item.label).filter(Boolean) as string[];
    expect(labels).not.toContain('加粗');
    expect(labels).toContain('撤销');
  });

  it('链接上下文提供打开与复制链接', () => {
    const items = buildContextMenuItems({ ...base, linkURL: 'https://example.com/x' }, deps);
    const labels = items.map((item) => item.label).filter(Boolean) as string[];
    expect(labels.some((label) => label.startsWith('打开链接'))).toBe(true);
    expect(labels).toContain('复制链接地址');
  });
});
