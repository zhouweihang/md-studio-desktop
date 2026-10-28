// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { emojiCount, emojiFor, replaceEmojiShortcodes, searchEmoji } from '../../src/shared/emoji';
import {
  definitionTermLines,
  footnoteIndexMap,
  scanDefinitionList,
  scanFootnoteDefinitions,
  scanFootnoteRefs,
  scanHighlights
} from '../../src/shared/extended-syntax';
import { computeDecorations } from '../../src/renderer/editor/live-preview';
import { EmojiWidget, FootnoteRefWidget, FrontMatterWidget } from '../../src/renderer/editor/widgets';

interface Collected {
  from: number;
  to: number;
  cls?: string;
  widget?: unknown;
}

function collect(doc: string, anchor = 0): Collected[] {
  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown({ base: markdownLanguage })]
  });
  const sets = computeDecorations(state, [{ from: 0, to: state.doc.length }]);
  const items: Collected[] = [];
  sets.decorations.between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string; widget?: unknown };
    items.push({ from, to, cls: spec.class, widget: spec.widget });
  });
  return items;
}

describe('scanHighlights', () => {
  it('识别 ==高亮== 并给出内层区间', () => {
    const spans = scanHighlights('前 ==重点== 后');
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ from: 2, to: 8, innerFrom: 4, innerTo: 6 });
  });

  it('未闭合 / 跨行 / 三连等号不识别', () => {
    expect(scanHighlights('==没闭合')).toHaveLength(0);
    expect(scanHighlights('==跨\n行==')).toHaveLength(0);
    expect(scanHighlights('===x===')).toHaveLength(0);
  });

  it('跳过行内代码区间', () => {
    const text = '`==code==` 与 ==真高亮==';
    const skip = [{ from: 0, to: 10 }];
    const spans = scanHighlights(text, skip);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.innerFrom, spans[0]!.innerTo)).toBe('真高亮');
  });

  it('允许内部嵌套强调并支持转义', () => {
    const text = '==a **b** c==';
    const spans = scanHighlights(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.innerFrom, spans[0]!.innerTo)).toBe('a **b** c');

    const escaped = scanHighlights('==a \\== b==');
    expect(escaped).toHaveLength(1);
    expect(escaped[0]!.to).toBe(11);
  });
});

describe('scanFootnoteRefs / scanFootnoteDefinitions', () => {
  const doc = ['正文引用[^a] 与 [^b]。', '', '[^a]: 第一条', '[^b]: 第二条'].join('\n');

  it('引用与定义都识别，序号按定义顺序', () => {
    const refs = scanFootnoteRefs(doc);
    expect(refs.map((ref) => ref.id)).toEqual(['a', 'b']);
    const definitions = scanFootnoteDefinitions(doc);
    expect(definitions.map((definition) => definition.id)).toEqual(['a', 'b']);
    const index = footnoteIndexMap(definitions);
    expect(index.get('a')).toBe(1);
    expect(index.get('b')).toBe(2);
  });

  it('定义行的 [^id]: 标记不会被当作引用', () => {
    const refs = scanFootnoteRefs('[^a]: 定义\n\n引用[^a]');
    expect(refs).toHaveLength(1);
    expect(refs[0]!.id).toBe('a');
  });

  it('空定义 / 非法 id 不识别', () => {
    expect(scanFootnoteRefs('[^]')).toHaveLength(0);
    expect(scanFootnoteRefs('[^a b]')).toHaveLength(0);
    expect(scanFootnoteDefinitions('普通 [^a] 行')).toHaveLength(0);
  });
});

describe('scanDefinitionList', () => {
  it('术语下一行以 “: ” 开头即为定义项', () => {
    const text = ['Apple', ': 一种水果', ': 也可以是公司', '', 'Banana', ': 另一种水果'].join('\n');
    const items = scanDefinitionList(text);
    expect(items.map((item) => item.line)).toEqual([2, 3, 6]);
    expect(definitionTermLines(items)).toEqual(new Set([1, 5]));
  });

  it('列表项 / 标题 / 引用后不构成定义', () => {
    const text = ['- 列表项', ': 不应识别', '', '# 标题', ': 不应识别', '', '> 引用', ': 不应识别'].join('\n');
    expect(scanDefinitionList(text)).toHaveLength(0);
  });
});

describe('编辑态装饰（computeDecorations）', () => {
  it('高亮：内层加 md-highlight、标记在非活动时隐藏', () => {
    const doc = '前 ==重点== 后';
    const items = collect(doc, 0);
    expect(items.some((item) => item.cls === 'md-highlight' && item.from === 4 && item.to === 6)).toBe(true);
    expect(items.some((item) => item.from === 2 && item.to === 4 && item.widget === undefined)).toBe(true);
  });

  it('光标落在高亮内部时保留标记', () => {
    const items = collect('==重点==', 3);
    expect(items.some((item) => item.from === 0 && item.to === 2)).toBe(false);
  });

  it('脚注引用渲染为上标 widget，序号来自定义', () => {
    const doc = '引用[^a]\n\n[^a]: 说明';
    const items = collect(doc, 0);
    const widget = items.find((item) => item.widget instanceof FootnoteRefWidget)?.widget as FootnoteRefWidget | undefined;
    expect(widget).toBeDefined();
    expect(widget!.toDOM().textContent).toBe('1');
  });

  it('Emoji 短代码在非活动时替换为字符', () => {
    const items = collect('今天 :smile: 了吗', 0);
    const widget = items.find((item) => item.widget instanceof EmojiWidget)?.widget as EmojiWidget | undefined;
    expect(widget).toBeDefined();
    expect(widget!.toDOM().textContent).toBe('😄');
  });

  it('front matter 渲染为元数据面板（跨行块）', () => {
    const doc = '---\ntitle: 示例\ntags: [a, b]\n---\n\n# 正文';
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [markdown({ base: markdownLanguage })]
    });
    const sets = computeDecorations(state, [{ from: 0, to: state.doc.length }], undefined, { onlyBlocks: true });
    let found: FrontMatterWidget | null = null;
    sets.decorations.between(0, state.doc.length, (_from, _to, value) => {
      const spec = value.spec as { widget?: unknown };
      if (spec.widget instanceof FrontMatterWidget) found = spec.widget;
    });
    expect(found).not.toBeNull();
    const dom = (found as unknown as FrontMatterWidget).toDOM();
    expect(dom.querySelectorAll('dt')).toHaveLength(2);
    expect(dom.textContent).toContain('title');
    expect(dom.textContent).toContain('a, b');
  });

  it('可能含块级 widget 的文档被快速命中', () => {
    expect(collect('---\ntitle: x\n---\ntext', 0).length).toBeGreaterThan(0);
  });
});

describe('emoji 表', () => {
  it('短代码数量达到目标（≥300）', () => {
    expect(emojiCount()).toBeGreaterThanOrEqual(300);
  });

  it('常用短代码与别名可解析', () => {
    expect(emojiFor('smile')).toBe('😄');
    expect(emojiFor('thumbsup')).toBe('👍');
    expect(emojiFor('+1')).toBe('👍');
    expect(emojiFor(':heart:')).toBe('❤️');
    expect(emojiFor('not-exist')).toBeNull();
  });

  it('replaceEmojiShortcodes 保留未知短代码', () => {
    expect(replaceEmojiShortcodes('a :smile: b :unknown_thing: c')).toBe('a 😄 b :unknown_thing: c');
  });

  it('searchEmoji 前缀优先、数量受限', () => {
    const results = searchEmoji('smil', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results.some((match) => match.char === '😄')).toBe(true);
    expect(results.some((match) => match.name.startsWith('smil'))).toBe(true);
    expect(searchEmoji('cat', 3).some((match) => match.char === '🐱')).toBe(true);
    const exact = searchEmoji('thumbsup', 3);
    expect(exact[0]!.char).toBe('👍');
  });
});
