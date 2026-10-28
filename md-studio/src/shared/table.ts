/**
 * GFM 表格（REQ-003）：解析源码、规范化序列化、增删行列。
 * 纯函数；编辑器命令基于语法树定位表格块后调用这里。
 */

export type ColumnAlign = 'left' | 'center' | 'right' | null;

export interface TableModel {
  /** 第一行为表头；之后为数据行 */
  rows: string[][];
  aligns: ColumnAlign[];
}

/** 分隔行：| :--- | :--: | ---: |（≥1 个破折号） */
const SEPARATOR_CELL = /^\s*:?-{1,}:?\s*$/;

/** 按未转义的 | 切分一行。 */
export function splitRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index] ?? '';
    if (char === '\\' && trimmed[index + 1] === '|') {
      current += '\\|';
      index += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function parseTableSource(source: string): TableModel | null {
  const lines = source.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return null;
  const header = splitRow(lines[0] ?? '');
  const separator = splitRow(lines[1] ?? '');
  if (header.length === 0 || separator.length === 0) return null;
  if (!separator.every((cell) => SEPARATOR_CELL.test(cell))) return null;

  const columnCount = Math.max(header.length, separator.length);
  const aligns: ColumnAlign[] = [];
  for (let index = 0; index < columnCount; index++) {
    const cell = (separator[index] ?? '---').trim();
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
  }

  const normalize = (cells: string[]): string[] => {
    const result = cells.slice(0, columnCount);
    while (result.length < columnCount) result.push('');
    return result;
  };

  const rows: string[][] = [normalize(header)];
  for (let index = 2; index < lines.length; index++) {
    rows.push(normalize(splitRow(lines[index] ?? '')));
  }
  return { rows, aligns };
}

/** 展示宽度：CJK 与全角字符按 2 计。 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f);
    width += wide ? 2 : 1;
  }
  return width;
}

function padTo(text: string, width: number): string {
  const padding = Math.max(0, width - displayWidth(text));
  return `${text}${' '.repeat(padding)}`;
}

function separatorCell(align: ColumnAlign, width: number): string {
  const minWidth = Math.max(3, width);
  if (align === 'center') return `:${'-'.repeat(minWidth - 2)}:`;
  if (align === 'right') return `${'-'.repeat(minWidth - 1)}:`;
  if (align === 'left') return `:${'-'.repeat(minWidth - 1)}`;
  return '-'.repeat(minWidth);
}

/** 规范化序列化：单元格对齐填充，分隔行带对齐标记。 */
export function serializeTable(model: TableModel): string {
  const columnCount = model.aligns.length;
  const widths: number[] = [];
  for (let index = 0; index < columnCount; index++) {
    let width = 3;
    for (const row of model.rows) {
      width = Math.max(width, displayWidth(row[index] ?? ''));
    }
    widths.push(width);
  }

  const renderRow = (row: string[]): string =>
    `| ${row.map((cell, index) => padTo(cell, widths[index] ?? 3)).join(' | ')} |`;

  const lines: string[] = [];
  lines.push(renderRow(model.rows[0] ?? []));
  lines.push(`| ${model.aligns.map((align, index) => separatorCell(align, widths[index] ?? 3)).join(' | ')} |`);
  for (let index = 1; index < model.rows.length; index++) {
    lines.push(renderRow(model.rows[index] ?? []));
  }
  return lines.join('\n');
}

/** 设置某一列的对齐方式（REQ-024 表格工具条）。 */
export function setColumnAlign(model: TableModel, atIndex: number, align: ColumnAlign): TableModel {
  if (atIndex < 0 || atIndex >= model.aligns.length) return model;
  const aligns = [...model.aligns];
  aligns[atIndex] = align;
  return { rows: model.rows.map((row) => [...row]), aligns };
}

export function addRow(model: TableModel, atIndex: number): TableModel {
  const columnCount = model.aligns.length;
  const row = Array.from({ length: columnCount }, () => '');
  const target = Math.min(Math.max(atIndex, 1), model.rows.length);
  const rows = [...model.rows];
  rows.splice(target, 0, row);
  return { rows, aligns: [...model.aligns] };
}

export function deleteRow(model: TableModel, atIndex: number): TableModel {
  if (model.rows.length <= 2) return model;
  const target = Math.min(Math.max(atIndex, 1), model.rows.length - 1);
  const rows = model.rows.filter((_, index) => index !== target);
  return { rows, aligns: [...model.aligns] };
}

export function addColumn(model: TableModel, atIndex: number): TableModel {
  const target = Math.min(Math.max(atIndex, 0), model.aligns.length);
  const rows = model.rows.map((row) => {
    const next = [...row];
    next.splice(target, 0, '');
    return next;
  });
  const aligns = [...model.aligns];
  aligns.splice(target, 0, null);
  return { rows, aligns };
}

export function deleteColumn(model: TableModel, atIndex: number): TableModel {
  if (model.aligns.length <= 1) return model;
  const target = Math.min(Math.max(atIndex, 0), model.aligns.length - 1);
  const rows = model.rows.map((row) => row.filter((_, index) => index !== target));
  const aligns = model.aligns.filter((_, index) => index !== target);
  return { rows, aligns };
}

/** 常用模板：3 列 × 2 行（表头 + 1 数据行）。 */
export function createTableTemplate(columns = 3, dataRows = 1): TableModel {
  const rows: string[][] = [Array.from({ length: columns }, (_, index) => `列${index + 1}`)];
  for (let index = 0; index < dataRows; index++) {
    rows.push(Array.from({ length: columns }, () => ''));
  }
  return { rows, aligns: Array.from({ length: columns }, () => null) };
}
