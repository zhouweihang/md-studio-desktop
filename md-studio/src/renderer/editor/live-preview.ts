import { syntaxTree } from '@codemirror/language';
import { EditorState, RangeSet, StateField, type Extension, type Range } from '@codemirror/state';
import { tr } from '../i18n';
import type { WidgetType } from '@codemirror/view';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view';
import {
  footnoteIndexMap,
  inlineCodeSpans,
  scanDefinitionList,
  scanFootnoteDefinitions,
  scanFootnoteRefs,
  scanHighlights
} from '../../shared/extended-syntax';
import { splitFrontMatter, type FrontMatterResult } from '../../shared/front-matter';
import { scanMath } from '../../shared/math';
import { emojiFor } from '../../shared/emoji';
import { resolveAssetPath } from '../../shared/paths';
import {
  EmojiWidget,
  FenceChipWidget,
  FootnoteRefWidget,
  FrontMatterWidget,
  HrWidget,
  HtmlBlockWidget,
  ImageWidget,
  MathWidget,
  MermaidWidget,
  TableWidget,
  TaskWidget,
  renderMathHtml
} from './widgets';

export interface PreviewContext {
  getDocDir(): string | null;
  openExternal(url: string): void;
  notify(message: string, kind?: 'info' | 'warn' | 'error'): void;
}

const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText']);

function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

interface Range2 {
  from: number;
  to: number;
}

export interface PreviewSets {
  decorations: DecorationSet;
  atomicRanges: DecorationSet;
  /** 跨行块级 widget 的源码区间（插件侧只把它们标记为原子，不替换） */
  blockRanges: DecorationSet;
}

export interface PreviewComputeOptions {
  /** 插件侧：跳过跨行块替换（由 StateField 负责），仅收集 blockRanges */
  skipBlocks?: boolean;
  /** StateField 侧：只产出跨行块替换 */
  onlyBlocks?: boolean;
}

/** 快速判断文档是否可能存在块级 widget（避免大文档每次光标移动都全树遍历）。 */
export function mightContainBlocks(text: string): boolean {
  return (
    text.includes('|') ||
    text.includes('$$') ||
    text.includes('mermaid') ||
    text.startsWith('---') ||
    text.includes('<div') ||
    text.includes('<table') ||
    text.includes('<details')
  );
}

/** 前置元数据缓存：按文档版本（Text 对象）缓存，避免每次光标移动重解析。 */
const frontMatterCache = new WeakMap<object, FrontMatterResult>();

/** 文档前置元数据（REQ-017）；不存在时 present 为 false。 */
export function frontMatterOf(state: EditorState): FrontMatterResult {
  const head = state.doc.sliceString(0, 4);
  if (head !== '---\n' && head !== '---\r') {
    return { present: false, entries: [], data: {}, body: state.doc.toString(), end: 0, raw: '' };
  }
  const cached = frontMatterCache.get(state.doc);
  if (cached) return cached;
  const result = splitFrontMatter(state.doc.toString());
  frontMatterCache.set(state.doc, result);
  return result;
}

const EMPTY_FOOTNOTE_INDEX: Map<string, number> = new Map();
const footnoteIndexCache = new WeakMap<object, Map<string, number>>();

/** 脚注序号表（全文档，按文档版本缓存；可见区无 `[^` 时不做全量扫描）。 */
function footnoteIndexFor(state: EditorState, visibleText: string): Map<string, number> {
  if (!visibleText.includes('[^')) return EMPTY_FOOTNOTE_INDEX;
  const cached = footnoteIndexCache.get(state.doc);
  if (cached) return cached;
  const map = footnoteIndexMap(scanFootnoteDefinitions(state.doc.toString()));
  footnoteIndexCache.set(state.doc, map);
  return map;
}

/** 把范围扩展到整行（跨行块替换必须覆盖整行）。 */
function extendToLineEnd(state: EditorState, to: number): number {
  if (to >= state.doc.length) return to;
  const line = state.doc.lineAt(to);
  if (line.to !== to) return to;
  const next = state.doc.sliceString(to, Math.min(state.doc.length, to + 2));
  if (next.startsWith('\r\n')) return to + 2;
  if (next.startsWith('\n')) return to + 1;
  return to;
}

/**
 * 计算预览装饰。
 * - 默认（options 为空）：全量（跨行块使用 block 替换）。
 * - `skipBlocks`：ViewPlugin 路径，跳过跨行块替换并记录 blockRanges。
 * - `onlyBlocks`：StateField 路径，只产出跨行块替换（CM6 限制：插件不得替换换行）。
 */
export function computeDecorations(
  state: EditorState,
  ranges: readonly Range2[],
  context?: Partial<PreviewContext>,
  options: PreviewComputeOptions = {}
): PreviewSets {
  const onlyBlocks = options.onlyBlocks === true;
  const skipBlocks = options.skipBlocks === true;
  const decorations: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const blocks: Range<Decoration>[] = [];
  const lineClasses = new Map<number, Set<string>>();
  const seen = new Set<string>();

  const addLine = (pos: number, className: string): void => {
    let classes = lineClasses.get(pos);
    if (!classes) {
      classes = new Set();
      lineClasses.set(pos, classes);
    }
    classes.add(className);
  };

  const addRange = (key: string, decoration: Decoration, from: number, to: number, asAtomic = false): void => {
    if (from >= to || seen.has(key)) return;
    seen.add(key);
    decorations.push(decoration.range(from, to));
    if (asAtomic) atomic.push(Decoration.replace({}).range(from, to));
  };

  const hideRange = (key: string, from: number, to: number): void => {
    addRange(key, Decoration.replace({}), from, to);
  };

  const markBlock = (from: number, to: number): void => {
    const end = extendToLineEnd(state, to);
    blocks.push(Decoration.mark({}).range(from, end));
    atomic.push(Decoration.replace({}).range(from, end));
  };

  /** 跨行块 widget：block 替换 + 原子域（光标不能落入被替换区域） */
  const addBlockWidget = (key: string, widget: WidgetType, from: number, to: number): void => {
    const end = extendToLineEnd(state, to);
    if (end <= from || seen.has(key)) return;
    seen.add(key);
    decorations.push(Decoration.replace({ widget, block: true }).range(from, end));
    atomic.push(Decoration.replace({}).range(from, end));
  };

  const docDir = context?.getDocDir?.() ?? null;

  // ---- 前置元数据（REQ-017）：跨行块替换（StateField 负责） ----
  const frontMatter = frontMatterOf(state);
  if (frontMatter.present && frontMatter.end > 0) {
    const active = selectionTouches(state, 0, frontMatter.end);
    if (!active) {
      if (skipBlocks && !onlyBlocks) {
        markBlock(0, frontMatter.end);
      } else {
        addBlockWidget(
          `fm:0:${frontMatter.end}`,
          new FrontMatterWidget(frontMatter.entries),
          0,
          frontMatter.end
        );
      }
    }
  }

  for (const visible of ranges) {
    const from = Math.max(0, visible.from);
    const to = Math.min(state.doc.length, visible.to);
    if (to <= from) continue;

    const codeRanges: Range2[] = [];
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (CODE_NODES.has(node.name)) codeRanges.push({ from: node.from, to: node.to });
      }
    });

    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const active = selectionTouches(state, node.from, node.to);

        // ---- 跨行块（StateField 职责） ----
        if (name === 'Table') {
          if (active) {
            return false;
          }
          if (skipBlocks && !onlyBlocks) {
            markBlock(node.from, node.to);
          } else {
            const source = state.doc.sliceString(node.from, node.to);
            addBlockWidget(`tb:${node.from}:${node.to}`, new TableWidget(source), node.from, node.to);
          }
          return false;
        }

        if (name === 'FencedCode') {
          const infoNode = node.node.getChild('CodeInfo');
          const info = infoNode ? state.doc.sliceString(infoNode.from, infoNode.to).trim() : '';
          const isMermaid = info === 'mermaid';
          if (isMermaid) {
            if (active) return false;
            if (skipBlocks && !onlyBlocks) {
              markBlock(node.from, node.to);
            } else {
              const codeNode = node.node.getChild('CodeText');
              const code = codeNode ? state.doc.sliceString(codeNode.from, codeNode.to) : '';
              addBlockWidget(`mm:${node.from}:${node.to}`, new MermaidWidget(code.trim()), node.from, node.to);
            }
            return false;
          }
        }

        if (name === 'HTMLBlock') {
          if (active) return false;
          if (skipBlocks && !onlyBlocks) {
            markBlock(node.from, node.to);
          } else {
            const source = state.doc.sliceString(node.from, node.to).trim();
            addBlockWidget(
              `html:${node.from}:${node.to}`,
              new HtmlBlockWidget(source),
              node.from,
              node.to
            );
          }
          return false;
        }

        if (onlyBlocks) return;

        // ---- 普通装饰（ViewPlugin 职责） ----
        if (name.startsWith('ATXHeading')) {
          const level = Number(name.slice('ATXHeading'.length)) || 1;
          const line = state.doc.lineAt(node.from);
          addLine(line.from, `md-h md-h${level}`);
          if (!active) {
            const mark = node.node.getChild('HeaderMark');
            if (mark) {
              const extendsToSpace = mark.to < line.to && state.doc.sliceString(mark.to, mark.to + 1) === ' ';
              const end = extendsToSpace ? mark.to + 1 : mark.to;
              hideRange(`h:${mark.from}:${end}`, mark.from, end);
            }
          }
          return;
        }

        if (name === 'SetextHeading1' || name === 'SetextHeading2') {
          const level = name.endsWith('1') ? 1 : 2;
          const line = state.doc.lineAt(node.from);
          addLine(line.from, `md-h md-h${level}`);
          if (!active) {
            const mark = node.node.getChild('HeaderMark');
            if (mark) {
              const underlineLine = state.doc.lineAt(mark.from);
              hideRange(`sh:${underlineLine.from}:${underlineLine.to}`, underlineLine.from, underlineLine.to);
            }
          }
          return;
        }

        if (name === 'Blockquote') {
          const start = state.doc.lineAt(node.from).number;
          const end = state.doc.lineAt(Math.min(node.to, state.doc.length)).number;
          for (let n = start; n <= end; n++) addLine(state.doc.line(n).from, 'md-quote');
          return;
        }

        if (name === 'StrongEmphasis') {
          decorations.push(Decoration.mark({ class: 'md-strong' }).range(node.from, node.to));
          if (!active) {
            for (const mark of childrenNamed(node.node, 'EmphasisMark')) {
              hideRange(`sm:${mark.from}:${mark.to}`, mark.from, mark.to);
            }
          }
          return;
        }

        if (name === 'Emphasis') {
          decorations.push(Decoration.mark({ class: 'md-em' }).range(node.from, node.to));
          if (!active) {
            for (const mark of childrenNamed(node.node, 'EmphasisMark')) {
              hideRange(`em:${mark.from}:${mark.to}`, mark.from, mark.to);
            }
          }
          return;
        }

        if (name === 'Strikethrough') {
          decorations.push(Decoration.mark({ class: 'md-strike' }).range(node.from, node.to));
          if (!active) {
            for (const mark of childrenNamed(node.node, 'StrikethroughMark')) {
              hideRange(`st:${mark.from}:${mark.to}`, mark.from, mark.to);
            }
          }
          return;
        }

        if (name === 'InlineCode') {
          decorations.push(Decoration.mark({ class: 'md-code' }).range(node.from, node.to));
          if (!active) {
            for (const mark of childrenNamed(node.node, 'CodeMark')) {
              hideRange(`cm:${mark.from}:${mark.to}:${mark.from > node.from ? 1 : 0}`, mark.from, mark.to);
            }
          }
          return;
        }

        if (name === 'Link') {
          const urlNode = node.node.getChild('URL');
          const href = urlNode ? state.doc.sliceString(urlNode.from, urlNode.to) : '';
          const marks = childrenNamed(node.node, 'LinkMark');
          const firstMark = marks[0];
          const secondMark = marks[1];
          if (firstMark && secondMark) {
            decorations.push(
              Decoration.mark({
                class: 'md-link',
                attributes: href ? { 'data-href': href, title: href } : {}
              }).range(firstMark.to, secondMark.from)
            );
          }
          if (!active) {
            for (const mark of marks) hideRange(`lk:${mark.from}:${mark.to}`, mark.from, mark.to);
            if (urlNode) hideRange(`lu:${urlNode.from}:${urlNode.to}`, urlNode.from, urlNode.to);
          }
          return false;
        }

        if (name === 'Image') {
          if (!active) {
            const urlNode = node.node.getChild('URL');
            const raw = urlNode ? state.doc.sliceString(urlNode.from, urlNode.to) : '';
            const altNode = node.node.getChild('Alt');
            const alt = altNode ? state.doc.sliceString(altNode.from, altNode.to) : '';
            const resolved = resolveAssetPath(raw, docDir);
            addRange(
              `img:${node.from}:${node.to}`,
              Decoration.replace({ widget: new ImageWidget(resolved, alt) }),
              node.from,
              node.to,
              true
            );
            return false;
          }
          return;
        }

        if (name === 'FencedCode') {
          const infoNode = node.node.getChild('CodeInfo');
          const info = infoNode ? state.doc.sliceString(infoNode.from, infoNode.to).trim() : '';
          const startLine = state.doc.lineAt(node.from).number;
          const endLine = state.doc.lineAt(Math.min(node.to, state.doc.length)).number;
          for (let n = startLine; n <= endLine; n++) addLine(state.doc.line(n).from, 'md-codeblock');

          if (!active) {
            const marks = childrenNamed(node.node, 'CodeMark');
            const openMark = marks[0];
            const closeMark = marks[marks.length - 1];
            if (openMark) {
              const end = infoNode ? infoNode.to : openMark.to;
              addRange(
                `fc:${openMark.from}:${end}`,
                Decoration.replace({ widget: new FenceChipWidget(info) }),
                openMark.from,
                end
              );
            }
            if (closeMark && closeMark !== openMark) {
              hideRange(`fcx:${closeMark.from}:${closeMark.to}`, closeMark.from, closeMark.to);
            }
          }
          return false;
        }

        if (name === 'HorizontalRule') {
          const line = state.doc.lineAt(node.from);
          addLine(line.from, 'md-hr');
          if (!active) {
            const start = line.from;
            const end = line.to > line.from ? line.to : start + 1;
            addRange(`hr:${start}:${end}`, Decoration.replace({ widget: new HrWidget() }), start, end, true);
          }
          return;
        }

        if (name === 'TaskMarker') {
          if (!active) {
            const text = state.doc.sliceString(node.from, node.to);
            const checked = /\[[xX]\]/.test(text);
            addRange(
              `tk:${node.from}:${node.to}`,
              Decoration.replace({ widget: new TaskWidget(checked, node.from) }),
              node.from,
              node.to,
              true
            );
          }
          return;
        }

        if (name === 'Emoji') {
          const raw = state.doc.sliceString(node.from, node.to);
          const char = emojiFor(raw.replace(/^:|:$/g, ''));
          if (char && !active) {
            addRange(
              `emoji:${node.from}:${node.to}`,
              Decoration.replace({ widget: new EmojiWidget(char, raw) }),
              node.from,
              node.to,
              true
            );
          } else if (char) {
            decorations.push(Decoration.mark({ class: 'md-emoji' }).range(node.from, node.to));
          }
          return;
        }

        if ((name === 'ListMark' || name === 'QuoteMark') && !active) {
          hideRange(`m:${node.from}:${node.to}:${name}`, node.from, node.to);
        }
        return;
      }
    });

    // ---- 公式 ----
    const slice = state.doc.sliceString(from, to);
    const skip = codeRanges
      .map((range) => ({ from: range.from - from, to: range.to - from }))
      .filter((range) => range.to > 0 && range.from < slice.length);
    for (const span of scanMath(slice, { skip })) {
      const absFrom = from + span.from;
      const absTo = from + span.to;
      if (selectionTouches(state, absFrom, absTo)) continue;
      if (span.kind === 'block') {
        if (skipBlocks && !onlyBlocks) {
          markBlock(absFrom, absTo);
        } else {
          const html = renderMathHtml(span.body.trim(), true);
          if (html) {
            addBlockWidget(`mb:${absFrom}:${absTo}`, new MathWidget(html, true), absFrom, absTo);
          } else {
            decorations.push(Decoration.mark({ class: 'md-math-error' }).range(absFrom, absTo));
          }
        }
        continue;
      }
      if (onlyBlocks) continue;
      const html = renderMathHtml(span.body.trim(), false);
      if (html) {
        addRange(`math:${absFrom}:${absTo}`, Decoration.replace({ widget: new MathWidget(html, false) }), absFrom, absTo, true);
      } else {
        decorations.push(
          Decoration.mark({
            class: 'md-math-error',
            attributes: { title: tr('editor.mathErrorHint') }
          }).range(absFrom, absTo)
        );
      }
    }

    if (onlyBlocks) continue;

    // ---- 扩展行内语法：==高亮== / [^脚注]（REQ-016） ----
    const relativeSkip = [
      ...codeRanges
        .map((range) => ({ from: range.from - from, to: range.to - from }))
        .filter((range) => range.to > 0 && range.from < slice.length),
      ...inlineCodeSpans(slice)
    ];

    for (const span of scanHighlights(slice, relativeSkip)) {
      const absFrom = from + span.from;
      const absInnerFrom = from + span.innerFrom;
      const absInnerTo = from + span.innerTo;
      const absTo = from + span.to;
      const active = selectionTouches(state, absFrom, absTo);
      decorations.push(Decoration.mark({ class: 'md-highlight' }).range(absInnerFrom, absInnerTo));
      if (!active) {
        hideRange(`hl:${absFrom}:${absInnerFrom}`, absFrom, absInnerFrom);
        hideRange(`hl2:${absInnerTo}:${absTo}`, absInnerTo, absTo);
      }
    }

    const footnoteIndex = footnoteIndexFor(state, slice);
    for (const ref of scanFootnoteRefs(slice, relativeSkip)) {
      const absFrom = from + ref.from;
      const absTo = from + ref.to;
      if (selectionTouches(state, absFrom, absTo)) continue;
      const index = footnoteIndex.get(ref.id) ?? 0;
      addRange(
        `fn:${absFrom}:${absTo}`,
        Decoration.replace({ widget: new FootnoteRefWidget(index, ref.id) }),
        absFrom,
        absTo,
        true
      );
    }

    // ---- 脚注定义 / 定义列表：行类与标记隐藏（可见区扫描） ----
    const windowFrom = from > 0 ? state.doc.lineAt(from - 1).from : 0;
    const windowSlice = state.doc.sliceString(windowFrom, to);
    const windowStartLine = state.doc.lineAt(windowFrom).number;

    for (const definition of scanFootnoteDefinitions(windowSlice)) {
      const absoluteLine = windowStartLine + definition.line - 1;
      const lineInfo = state.doc.line(Math.min(absoluteLine, state.doc.lines));
      const active = selectionTouches(state, lineInfo.from, lineInfo.to);
      addLine(lineInfo.from, 'md-footnote-def');
      if (!active) {
        const markerFrom = windowFrom + definition.markerFrom;
        const markerTo = windowFrom + definition.markerTo;
        hideRange(`fndef:${markerFrom}:${markerTo}`, markerFrom, markerTo);
      }
    }

    for (const item of scanDefinitionList(windowSlice)) {
      const absoluteLine = windowStartLine + item.line - 1;
      const absoluteTermLine = windowStartLine + item.termLine - 1;
      if (absoluteLine < 1 || absoluteLine > state.doc.lines) continue;
      const lineInfo = state.doc.line(absoluteLine);
      addLine(lineInfo.from, 'md-dd');
      if (absoluteTermLine >= 1 && absoluteTermLine <= state.doc.lines) {
        addLine(state.doc.line(absoluteTermLine).from, 'md-dt');
      }
      if (!selectionTouches(state, lineInfo.from, lineInfo.to)) {
        const markFrom = windowFrom + item.from;
        const markTo = windowFrom + item.to;
        hideRange(`dd:${markFrom}:${markTo}`, markFrom, markTo);
      }
    }
  }

  for (const [pos, classes] of lineClasses) {
    decorations.push(Decoration.line({ class: [...classes].join(' ') }).range(pos));
  }

  return {
    decorations: Decoration.set(decorations, true),
    atomicRanges: Decoration.set(atomic, true),
    blockRanges: Decoration.set(blocks, true)
  };
}

interface TreeNodeLike {
  from: number;
  to: number;
  getChildren?: (name: string) => Array<{ from: number; to: number }>;
}

function childrenNamed(node: unknown, name: string): Range2[] {
  const typed = node as TreeNodeLike;
  const children = typed.getChildren?.(name) ?? [];
  return children.map((child) => ({ from: child.from, to: child.to }));
}

export function toggleTaskAt(view: EditorView, from: number): void {
  const state = view.state;
  if (from < 0 || from + 3 > state.doc.length) return;
  const current = state.doc.sliceString(from, from + 3);
  const checked = /\[[xX]\]/.test(current);
  const replacement = checked ? '[ ]' : '[x]';
  view.dispatch({
    changes: { from, to: from + 3, insert: replacement },
    selection: { anchor: from + 3 }
  });
}

interface FenceLocation {
  from: number;
  to: number;
  info: string;
  infoFrom: number;
  markerEnd: number;
}

function findFenceAt(state: EditorState, from: number): FenceLocation | null {
  const tree = syntaxTree(state);
  let node = tree.resolveInner(from, 1);
  while (node.parent) {
    if (node.name === 'FencedCode') {
      const infoNode = node.getChild('CodeInfo');
      const openMark = node.getChild('CodeMark');
      return {
        from: node.from,
        to: node.to,
        info: infoNode ? state.doc.sliceString(infoNode.from, infoNode.to).trim() : '',
        infoFrom: infoNode ? infoNode.from : openMark?.to ?? node.from + 3,
        markerEnd: openMark?.to ?? node.from + 3
      };
    }
    node = node.parent;
  }
  return null;
}

/** 当前光标所在围栏代码块的语言信息（状态栏语言选择器用）。 */
export function fenceInfoAt(view: EditorView): { from: number; to: number; info: string; infoFrom: number } | null {
  return findFenceAt(view.state, view.state.selection.main.head);
}

/** 设置当前围栏代码块的语言（只改信息串，不动代码内容）。 */
export function setFenceLanguage(view: EditorView, language: string): boolean {
  const fence = findFenceAt(view.state, view.state.selection.main.head);
  if (!fence) return false;
  const from = fence.info ? fence.infoFrom : fence.markerEnd;
  const to = fence.info ? fence.infoFrom + fence.info.length : fence.markerEnd;
  view.dispatch({ changes: { from, to, insert: language } });
  return true;
}

export interface RebuildInput {
  composing: boolean;
  docChanged: boolean;
  viewportChanged: boolean;
  selectionSet: boolean;
}

/** 是否重建预览装饰：中文 IME 组合期间一律不重建（REQ-008）。 */
export function shouldRebuild(input: RebuildInput): boolean {
  if (input.composing) return false;
  return input.docChanged || input.viewportChanged || input.selectionSet;
}

/** 跨行块级 widget 的 StateField（CM6 限制：插件不得替换换行）。 */
export function blockWidgetsExtension(context: PreviewContext): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => {
      if (!mightContainBlocks(state.doc.toString())) return Decoration.none;
      return computeDecorations(state, [{ from: 0, to: state.doc.length }], context, { onlyBlocks: true }).decorations;
    },
    update: (value, transaction) => {
      if (!transaction.docChanged && transaction.selection === undefined) return value;
      if (!mightContainBlocks(transaction.state.doc.toString())) return Decoration.none;
      return computeDecorations(
        transaction.state,
        [{ from: 0, to: transaction.state.doc.length }],
        context,
        { onlyBlocks: true }
      ).decorations;
    },
    provide: (field) => EditorView.decorations.from(field)
  });
}

export function createLivePreview(context: PreviewContext) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      atomicRanges: DecorationSet;

      constructor(view: EditorView) {
        const sets = computeDecorations(view.state, view.visibleRanges, context, { skipBlocks: true });
        this.decorations = sets.decorations;
        this.atomicRanges = RangeSet.join<Decoration>([sets.atomicRanges, sets.blockRanges]);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) {
          // 组合期间会跳过重建，但旧装饰必须先映射到新文档坐标：
          // 否则装饰区间会落在旧位置上，产生跨行替换（CM6 直接抛错）
          this.decorations = this.decorations.map(update.changes);
          this.atomicRanges = this.atomicRanges.map(update.changes);
        }
        if (
          !shouldRebuild({
            composing: update.view.composing,
            docChanged: update.docChanged,
            viewportChanged: update.viewportChanged,
            selectionSet: update.selectionSet
          })
        ) {
          return;
        }
        const sets = computeDecorations(update.view.state, update.view.visibleRanges, context, { skipBlocks: true });
        this.decorations = sets.decorations;
        this.atomicRanges = RangeSet.join<Decoration>([sets.atomicRanges, sets.blockRanges]);
      }
    },
    {
      decorations: (value) => value.decorations,
      provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomicRanges ?? Decoration.none)
    }
  );

  const handlers: Extension = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const target = event.target as HTMLElement | null;
      const task = target?.closest?.('.md-task') as HTMLElement | null;
      if (task) {
        event.preventDefault();
        toggleTaskAt(view, Number(task.dataset.from ?? 0));
        return true;
      }
      const link = target?.closest?.('.md-link[data-href]') as HTMLElement | null;
      if (link) {
        event.preventDefault();
        context.openExternal(link.dataset.href ?? '');
        return true;
      }
      return false;
    }
  });

  return [plugin, handlers];
}
