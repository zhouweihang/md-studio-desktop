/**
 * 扩展语法扫描（REQ-016）：`==高亮==`、`[^脚注]`、脚注定义、定义列表。
 *
 * 这些语法在编辑态以「装饰叠加」的方式实现（不改写文档、不新增解析器节点），
 * 因此这里给出与预览、大纲、导出共用的纯扫描函数；导出侧另有 markdown-it 插件
 * 承担同样语义的渲染（见 `renderer/export/md-extended.ts`）。
 */

export interface TextRange {
  from: number;
  to: number;
}

export interface HighlightSpan {
  /** `==…==` 整体 */
  from: number;
  to: number;
  /** 内层内容区间（装饰高亮色用） */
  innerFrom: number;
  innerTo: number;
}

export interface FootnoteRef {
  from: number;
  to: number;
  id: string;
}

export interface FootnoteDefinition {
  id: string;
  /** 整行（含 `[^id]:` 前缀）的区间 */
  from: number;
  to: number;
  /** `[^id]:` 标记区间 */
  markerFrom: number;
  markerTo: number;
  line: number;
  /** 内容（去掉标记与首尾空白） */
  text: string;
}

export interface DefinitionItem {
  /** 定义项所在行（1 基） */
  line: number;
  /** `: ` 标记区间 */
  from: number;
  to: number;
  /** 所属术语行（1 基）；连续的 `: ` 行共享同一术语 */
  termLine: number;
}

const INLINE_CODE = /(`+)([^`]*?)\1/g;

/** 行内代码区间（扫描要跳过，避免把代码里的 `==` 当高亮）。 */
export function inlineCodeSpans(text: string): TextRange[] {
  const spans: TextRange[] = [];
  let match: RegExpExecArray | null;
  INLINE_CODE.lastIndex = 0;
  while ((match = INLINE_CODE.exec(text)) !== null) {
    spans.push({ from: match.index, to: match.index + match[0].length });
  }
  return spans;
}

function overlaps(skip: readonly TextRange[], from: number, to: number): boolean {
  return skip.some((range) => from < range.to && to > range.from);
}

const MAX_INLINE_SPAN = 500;

/** 扫描 `==高亮==`（不跨行、跳过行内代码、允许内部包含其它行内标记）。 */
export function scanHighlights(text: string, skip: readonly TextRange[] = []): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  let index = 0;
  while (index < text.length) {
    // 前一个字符是 `=` 说明属于更长的等号串（如 `===x===`），不当作高亮标记
    if (text.startsWith('==', index) && text[index - 1] !== '=' && text[index + 2] !== '=') {
      const close = findHighlightClose(text, index + 2);
      if (close > 0) {
        const span: HighlightSpan = { from: index, to: close + 2, innerFrom: index + 2, innerTo: close };
        if (!overlaps(skip, span.from, span.to)) spans.push(span);
        index = close + 2;
        continue;
      }
    }
    index += 1;
  }
  return spans;
}

function findHighlightClose(text: string, from: number): number {
  const limit = Math.min(text.length - 1, from + MAX_INLINE_SPAN);
  for (let i = from; i < limit; i++) {
    const ch = text[i];
    if (ch === '\n') return -1;
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '=' && text[i + 1] === '=' && i > from && text[i - 1] !== ' ') return i;
  }
  return -1;
}

const FOOTNOTE_ID = /^[^\s\]^]+$/;

/** 扫描 `[^id]` 引用（跳过行内代码与脚注定义自身的标记）。 */
export function scanFootnoteRefs(text: string, skip: readonly TextRange[] = []): FootnoteRef[] {
  const refs: FootnoteRef[] = [];
  const guard = new Set<number>();
  for (const definition of scanFootnoteDefinitions(text)) {
    for (let i = definition.markerFrom; i < definition.markerTo; i++) guard.add(i);
  }
  let index = 0;
  while (index < text.length) {
    if (text.startsWith('[^', index)) {
      const close = text.indexOf(']', index + 2);
      if (close > index + 2 && close - index <= 80) {
        const id = text.slice(index + 2, close);
        if (FOOTNOTE_ID.test(id) && !guard.has(index) && !overlaps(skip, index, close + 1)) {
          refs.push({ from: index, to: close + 1, id });
          index = close + 1;
          continue;
        }
      }
    }
    index += 1;
  }
  return refs;
}

const FOOTNOTE_DEF_LINE = /^\[\^([^\s\]]+)\]:[ \t]?/;

/** 扫描脚注定义（`[^id]: 内容`，可多行缩进续写，区间只覆盖首行）。 */
export function scanFootnoteDefinitions(text: string): FootnoteDefinition[] {
  const definitions: FootnoteDefinition[] = [];
  const lines = text.split('\n');
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const match = FOOTNOTE_DEF_LINE.exec(line);
    if (match) {
      const markerText = match[0];
      definitions.push({
        id: match[1] ?? '',
        from: offset,
        to: offset + line.length,
        markerFrom: offset,
        markerTo: offset + markerText.length,
        line: index + 1,
        text: line.slice(markerText.length).trim()
      });
    }
    offset += line.length + 1;
  }
  return definitions;
}

/** 脚注序号表：按定义出现顺序编号（引用未定义时为 0）。 */
export function footnoteIndexMap(definitions: readonly FootnoteDefinition[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const definition of definitions) {
    if (!map.has(definition.id)) map.set(definition.id, map.size + 1);
  }
  return map;
}

const DEFINITION_MARK = /^ {0,3}([:~])[ \t]+/;

/**
 * 扫描定义列表：上一行是普通段落、当前行以 `: ` 开头（连续多行各自成项）。
 * 返回被当作术语的行与定义行标记区间（供预览装饰与大纲跳过）。
 */
export function scanDefinitionList(text: string): DefinitionItem[] {
  const items: DefinitionItem[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let previousIsTerm = false;
  let activeTermLine = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const match = DEFINITION_MARK.exec(line);
    if (match) {
      // 术语行后的首个 `: ` 开启定义组；连续的 `: ` 行属于同一术语
      if (previousIsTerm) activeTermLine = index;
      if (activeTermLine > 0) {
        items.push({
          line: index + 1,
          from: offset + (match[0].length - match[0].trimStart().length),
          to: offset + match[0].length,
          termLine: activeTermLine
        });
      }
      previousIsTerm = false;
    } else {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        activeTermLine = 0;
        previousIsTerm = false;
      } else {
        const isListItem = /^([-*+]|\d+[.)])\s/.test(trimmed);
        const isHeading = /^#{1,6}\s/.test(trimmed);
        const isQuote = trimmed.startsWith('>');
        const isTableRow = trimmed.startsWith('|');
        previousIsTerm = !isListItem && !isHeading && !isQuote && !isTableRow;
        if (previousIsTerm) activeTermLine = 0;
      }
    }
    offset += line.length + 1;
  }
  return items;
}

/** 术语行（定义列表的前置行号集合）。 */
export function definitionTermLines(items: readonly DefinitionItem[]): Set<number> {
  const lines = new Set<number>();
  for (const item of items) lines.add(item.termLine);
  return lines;
}
