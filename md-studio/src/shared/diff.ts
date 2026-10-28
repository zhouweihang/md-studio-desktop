/**
 * 行级 diff（REQ-030）：历史版本对比用。
 * LCS 动态规划；对超大文件（>4000 行）退化为「首尾裁剪 + 前缀/后缀匹配」，
 * 保证界面不会被 O(n²) 卡住。纯函数，可单测。
 */

export type DiffKind = 'same' | 'added' | 'removed';

export interface DiffLine {
  kind: DiffKind;
  /** 行号（旧文件为 fromLine，新文件为 toLine；缺失为 null） */
  fromLine: number | null;
  toLine: number | null;
  text: string;
}

export interface DiffSummary {
  added: number;
  removed: number;
}

const MAX_MATRIX_LINES = 2500;

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** 行级 diff（顺序：旧文件与新文件交错，same 行合并）。 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);

  // 前缀 / 后缀裁剪，缩小矩阵规模
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const middleA = a.slice(prefix, a.length - suffix);
  const middleB = b.slice(prefix, b.length - suffix);
  const result: DiffLine[] = [];

  for (let index = 0; index < prefix; index++) {
    result.push({ kind: 'same', fromLine: index + 1, toLine: index + 1, text: a[index] ?? '' });
  }

  if (middleA.length + middleB.length > MAX_MATRIX_LINES * 2) {
    // 超大改动：不逐行比对，直接整体标记
    for (let index = 0; index < middleA.length; index++) {
      result.push({ kind: 'removed', fromLine: prefix + index + 1, toLine: null, text: middleA[index] ?? '' });
    }
    for (let index = 0; index < middleB.length; index++) {
      result.push({ kind: 'added', fromLine: null, toLine: prefix + index + 1, text: middleB[index] ?? '' });
    }
  } else {
    const operations = lcsDiff(middleA, middleB);
    let fromIndex = prefix;
    let toIndex = prefix;
    for (const operation of operations) {
      if (operation.kind === 'same') {
        result.push({ kind: 'same', fromLine: fromIndex + 1, toLine: toIndex + 1, text: operation.text });
        fromIndex += 1;
        toIndex += 1;
      } else if (operation.kind === 'removed') {
        result.push({ kind: 'removed', fromLine: fromIndex + 1, toLine: null, text: operation.text });
        fromIndex += 1;
      } else {
        result.push({ kind: 'added', fromLine: null, toLine: toIndex + 1, text: operation.text });
        toIndex += 1;
      }
    }
  }

  for (let index = 0; index < suffix; index++) {
    const fromLine = a.length - suffix + index + 1;
    const toLine = b.length - suffix + index + 1;
    result.push({ kind: 'same', fromLine, toLine, text: a[fromLine - 1] ?? '' });
  }

  return result;
}

interface Operation {
  kind: DiffKind;
  text: string;
}

function lcsDiff(a: string[], b: string[]): Operation[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const operations: Operation[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      operations.push({ kind: 'same', text: a[i] ?? '' });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      operations.push({ kind: 'removed', text: a[i] ?? '' });
      i += 1;
    } else {
      operations.push({ kind: 'added', text: b[j] ?? '' });
      j += 1;
    }
  }
  while (i < n) {
    operations.push({ kind: 'removed', text: a[i] ?? '' });
    i += 1;
  }
  while (j < m) {
    operations.push({ kind: 'added', text: b[j] ?? '' });
    j += 1;
  }
  return operations;
}

export function diffSummary(lines: readonly DiffLine[]): DiffSummary {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === 'added') added += 1;
    else if (line.kind === 'removed') removed += 1;
  }
  return { added, removed };
}

/** 相同行占比（0~1），用于历史列表显示「变化程度」。 */
export function similarity(before: string, after: string): number {
  const lines = diffLines(before, after);
  if (lines.length === 0) return 1;
  const same = lines.filter((line) => line.kind === 'same').length;
  return same / lines.length;
}
