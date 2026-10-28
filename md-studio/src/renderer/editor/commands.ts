import { syntaxTree } from '@codemirror/language';
import type { EditorState, Line } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { scanFootnoteDefinitions } from '../../shared/extended-syntax';
import { wrapMath } from '../../shared/math';
import { extractOutline } from '../../shared/outline';
import { tr } from '../i18n';
import {
  addColumn,
  addRow,
  createTableTemplate,
  deleteColumn,
  deleteRow,
  parseTableSource,
  serializeTable,
  setColumnAlign,
  type ColumnAlign
} from '../../shared/table';
import { buildTocMarkdown } from '../../shared/toc';

function selectedLines(state: EditorState): Line[] {
  const range = state.selection.main;
  const start = state.doc.lineAt(range.from);
  const end = state.doc.lineAt(range.to);
  const lines: Line[] = [];
  for (let number = start.number; number <= end.number; number++) lines.push(state.doc.line(number));
  return lines;
}

function replaceLines(view: EditorView, lines: Line[], transform: (line: Line, index: number) => string | null): void {
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  lines.forEach((line, index) => {
    const next = transform(line, index);
    if (next !== null && next !== line.text) {
      changes.push({ from: line.from, to: line.to, insert: next });
    }
  });
  if (changes.length > 0) view.dispatch({ changes });
}

function wrapSelection(view: EditorView, marker: string): void {
  const state = view.state;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  const before = state.sliceDoc(Math.max(0, range.from - marker.length), range.from);
  const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + marker.length));

  // 选中内容两侧已有标记 → 一起移除
  if (before === marker && after === marker) {
    view.dispatch({
      changes: [
        { from: range.from - marker.length, to: range.from },
        { from: range.to, to: range.to + marker.length }
      ],
      selection: { anchor: range.from - marker.length, head: range.to - marker.length }
    });
    return;
  }
  // 选中内容自带标记 → 去掉内部标记
  if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: inner },
      selection: { anchor: range.from, head: range.from + inner.length }
    });
    return;
  }
  if (selected.length === 0) {
    view.dispatch({
      changes: { from: range.from, insert: marker + marker },
      selection: { anchor: range.from + marker.length }
    });
    return;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `${marker}${selected}${marker}` },
    selection: { anchor: range.from + marker.length, head: range.from + marker.length + selected.length }
  });
}

export function toggleBold(view: EditorView): void {
  wrapSelection(view, '**');
}

export function toggleItalic(view: EditorView): void {
  wrapSelection(view, '*');
}

export function toggleStrikethrough(view: EditorView): void {
  wrapSelection(view, '~~');
}

/** `==高亮==`（REQ-016）。 */
export function toggleHighlight(view: EditorView): void {
  wrapSelection(view, '==');
}

/** 在光标处插入 `[^n]`，并在文末追加对应脚注定义（REQ-016）。 */
export function insertFootnote(view: EditorView): void {
  const state = view.state;
  const text = state.doc.toString();
  const existing = scanFootnoteDefinitions(text);
  const numbers = existing
    .map((definition) => Number(definition.id))
    .filter((value) => Number.isFinite(value));
  const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  const id = String(next);
  const range = state.selection.main;
  const atEnd = state.doc.length;
  const prefix = atEnd > 0 && !text.endsWith('\n') ? '\n' : '';
  view.dispatch({
    changes: [
      { from: range.from, to: range.from, insert: `[^${id}]` },
      { from: atEnd, to: atEnd, insert: `${prefix}\n[^${id}]: ${tr('editor.footnoteText')}\n` }
    ],
    selection: { anchor: range.from + id.length + 3 },
    scrollIntoView: true
  });
}

/** 按当前文档标题生成目录并插入光标处（REQ-020）。 */
export function insertToc(view: EditorView): string | null {
  const outline = extractOutline(view.state.doc.toString());
  const toc = buildTocMarkdown(outline);
  if (!toc) return null;
  const range = view.state.selection.main;
  const line = view.state.doc.lineAt(range.from);
  const prefix = line.text.trim().length > 0 ? '\n' : '';
  const insert = `${prefix}${toc}`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length }
  });
  return toc;
}

export function toggleInlineCode(view: EditorView): void {
  wrapSelection(view, '`');
}

export function setHeadingLevel(view: EditorView, level: 0 | 1 | 2 | 3 | 4 | 5 | 6): void {
  const lines = selectedLines(view.state);
  replaceLines(view, lines, (line) => {
    const indent = /^\s*/.exec(line.text)?.[0] ?? '';
    const body = line.text
      .slice(indent.length)
      .replace(/^#{1,6}\s+/, '')
      .replace(/^#{1,6}$/, '');
    if (level === 0) return `${indent}${body}`;
    return `${indent}${'#'.repeat(level)} ${body}`;
  });
}

export function changeHeadingLevel(view: EditorView, delta: number): void {
  const first = selectedLines(view.state)[0];
  const current = /^(\s*)(#{1,6})\s/.exec(first?.text ?? '');
  const currentLevel = current ? current[2]!.length : 0;
  const next = Math.min(6, Math.max(0, currentLevel + delta));
  setHeadingLevel(view, next as 0 | 1 | 2 | 3 | 4 | 5 | 6);
}

type ListKind = 'bullet' | 'ordered' | 'task';

const LIST_PATTERN = /^(\s*)(?:([-*+])|(\d+)\.)\s+(?:\[([ xX])\]\s+)?/;

function listKindOf(text: string): ListKind | null {
  const match = LIST_PATTERN.exec(text);
  if (!match) return null;
  if (match[3] !== undefined) return 'ordered';
  if (match[4] !== undefined) return 'task';
  return 'bullet';
}

export function toggleList(view: EditorView, kind: ListKind): void {
  const lines = selectedLines(view.state);
  const allSame = lines.every((line) => listKindOf(line.text) === kind);
  let orderedIndex = 1;
  replaceLines(view, lines, (line) => {
    const match = LIST_PATTERN.exec(line.text);
    const rest = match ? line.text.slice(match[0].length) : line.text;
    if (allSame) {
      return rest;
    }
    if (kind === 'bullet') return `- ${rest}`;
    if (kind === 'task') return `- [ ] ${rest}`;
    const value = `${orderedIndex}. ${rest}`;
    orderedIndex += 1;
    return value;
  });
}

export function toggleQuote(view: EditorView): void {
  const lines = selectedLines(view.state);
  const allQuoted = lines.every((line) => /^\s*>\s?/.test(line.text));
  replaceLines(view, lines, (line) => {
    if (allQuoted) return line.text.replace(/^(\s*)>\s?/, '$1');
    return `> ${line.text}`;
  });
}

export function insertCodeBlock(view: EditorView): void {
  const state = view.state;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  if (selected.length > 0) {
    const text = `\`\`\`\n${selected}\n\`\`\``;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: { anchor: range.from, head: range.from + text.length }
    });
    return;
  }
  const insert = '```\n\n```';
  view.dispatch({
    changes: { from: range.from, insert },
    selection: { anchor: range.from + 4 }
  });
}

export function insertMathBlock(view: EditorView): void {
  const state = view.state;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  if (selected.trim().length > 0) {
    const text = wrapMath(selected, true);
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: { anchor: range.from, head: range.from + text.length }
    });
    return;
  }
  const insert = '$$\n\n$$';
  view.dispatch({
    changes: { from: range.from, insert },
    selection: { anchor: range.from + 3 }
  });
}

export function insertMermaidBlock(view: EditorView): void {
  const state = view.state;
  const range = state.selection.main;
  const insert = `\`\`\`mermaid\n${tr('editor.mermaidSample')}\n\`\`\``;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from, head: range.from + insert.length }
  });
}

export function insertHorizontalRule(view: EditorView): void {
  const state = view.state;
  const range = state.selection.main;
  const insert = '---\n';
  view.dispatch({ changes: { from: range.from, to: range.to, insert } });
}

export function insertTable(view: EditorView): void {
  const state = view.state;
  const range = state.selection.main;
  const table = serializeTable(createTableTemplate(3, 1));
  const prefix = state.doc.lineAt(range.from).text.length > 0 && range.from === range.to ? '\n' : '';
  const insert = `${prefix}${table}\n`;
  view.dispatch({ changes: { from: range.from, to: range.to, insert } });
}

export function insertLink(view: EditorView, url: string, text?: string): void {
  const state = view.state;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  const label = text ?? (selected.length > 0 ? selected : url);
  const insert = `[${label}](${url})`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from, head: range.from + insert.length }
  });
}

export function insertImage(view: EditorView, relativePath: string, alt = ''): void {
  const state = view.state;
  const range = state.selection.main;
  const insert = `![${alt}](${relativePath})`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length }
  });
}

export function insertText(view: EditorView, text: string): void {
  const state = view.state;
  const range = state.selection.main;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length }
  });
}

/** 清除选区格式：行内标记 + 行首块级前缀。 */
export function clearFormatting(view: EditorView): void {
  const lines = selectedLines(view.state);
  replaceLines(view, lines, (line) => {
    let text = line.text.replace(/^(\s*)(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/, '$1');
    text = text
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/`([^`]*)`/g, '$1');
    return text;
  });
}

export type TableOperation = 'addRow' | 'addColumn' | 'deleteRow' | 'deleteColumn' | 'alignLeft' | 'alignCenter' | 'alignRight' | 'alignNone';

/** 当前光标所在的表格行列（供表格工具条与对齐命令共用）。 */
function tablePositionAt(view: EditorView): { from: number; to: number; rowIndex: number; columnIndex: number } | null {
  const state = view.state;
  const head = state.selection.main.head;
  let node = syntaxTree(state).resolveInner(head, 1);
  while (node) {
    if (node.name === 'Table') {
      const model = parseTableSource(state.doc.sliceString(node.from, node.to));
      if (!model) return null;
      const startLine = state.doc.lineAt(node.from);
      const currentLine = state.doc.lineAt(head);
      const lineOffset = currentLine.number - startLine.number;
      const posInLine = head - currentLine.from;
      const before = currentLine.text.slice(0, posInLine);
      const pipes = (before.match(/\|/g) ?? []).length;
      const leadingPipe = currentLine.text.trimStart().startsWith('|') ? 1 : 0;
      return {
        from: node.from,
        to: node.to,
        rowIndex: Math.max(1, Math.min(lineOffset, model.rows.length - 1)),
        columnIndex: Math.max(0, Math.min(pipes - leadingPipe, model.aligns.length - 1))
      };
    }
    node = node.parent as typeof node;
  }
  return null;
}

/** 光标是否位于表格内（表格工具条显示条件）。 */
export function isInsideTable(view: EditorView): boolean {
  return tablePositionAt(view) !== null;
}

/** 当前列的对齐方式与列数（工具条按钮状态）。 */
export function tableAlignAt(view: EditorView): { align: ColumnAlign; columns: number } | null {
  const position = tablePositionAt(view);
  if (!position) return null;
  const model = parseTableSource(view.state.doc.sliceString(position.from, position.to));
  if (!model) return null;
  return { align: model.aligns[position.columnIndex] ?? null, columns: model.aligns.length };
}

/** 设置当前列对齐（REQ-024 表格工具条）。 */
export function setTableAlign(view: EditorView, align: ColumnAlign): boolean {
  const position = tablePositionAt(view);
  if (!position) return false;
  const model = parseTableSource(view.state.doc.sliceString(position.from, position.to));
  if (!model) return false;
  const next = setColumnAlign(model, position.columnIndex, align);
  view.dispatch({
    changes: { from: position.from, to: position.to, insert: serializeTable(next) },
    selection: { anchor: position.from + 2 }
  });
  return true;
}

/** 表格操作（REQ-003）：按光标所在行/列增删。 */
export function tableOperation(view: EditorView, operation: TableOperation): boolean {
  const state = view.state;
  const head = state.selection.main.head;
  let node = syntaxTree(state).resolveInner(head, 1);
  let tableFrom = -1;
  let tableTo = -1;
  while (node) {
    if (node.name === 'Table') {
      tableFrom = node.from;
      tableTo = node.to;
      break;
    }
    node = node.parent as typeof node;
  }
  if (tableFrom < 0) return false;

  const source = state.doc.sliceString(tableFrom, tableTo);
  const model = parseTableSource(source);
  if (!model) return false;

  const startLine = state.doc.lineAt(tableFrom);
  const currentLine = state.doc.lineAt(head);
  const lineOffset = currentLine.number - startLine.number;
  const rowIndex = Math.max(1, Math.min(lineOffset, model.rows.length - 1));
  const lineText = currentLine.text;
  const posInLine = head - currentLine.from;
  const before = lineText.slice(0, posInLine);
  const pipes = (before.match(/\|/g) ?? []).length;
  const leadingPipe = lineText.trimStart().startsWith('|') ? 1 : 0;
  const columnIndex = Math.max(0, Math.min(pipes - leadingPipe, model.aligns.length - 1));

  if (operation === 'alignLeft' || operation === 'alignCenter' || operation === 'alignRight' || operation === 'alignNone') {
    const align: ColumnAlign =
      operation === 'alignLeft' ? 'left' : operation === 'alignCenter' ? 'center' : operation === 'alignRight' ? 'right' : null;
    return setTableAlign(view, align);
  }

  let next = model;
  if (operation === 'addRow') next = addRow(model, lineOffset <= 0 ? 1 : lineOffset + 1);
  else if (operation === 'deleteRow') {
    if (lineOffset <= 0) return false;
    next = deleteRow(model, lineOffset);
  } else if (operation === 'addColumn') next = addColumn(model, columnIndex + 1);
  else next = deleteColumn(model, columnIndex);

  const serialized = serializeTable(next);
  const cursorLine = Math.min(lineOffset, next.rows.length - 1);
  const cursorLineStart = serialized.split('\n').slice(0, Math.max(0, cursorLine)).join('\n').length + (cursorLine > 0 ? 1 : 0);
  view.dispatch({
    changes: { from: tableFrom, to: tableTo, insert: serialized },
    selection: { anchor: tableFrom + cursorLineStart + 2 }
  });
  return true;
}
