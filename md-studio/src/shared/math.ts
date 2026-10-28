/**
 * 数学公式扫描（REQ-004）：块级 `$$…$$` 与行内 `$…$`。
 * 规则（参考 KaTeX auto-render 的保守判定）：
 * - 转义 `\$` 不算定界符；
 * - 行内公式不跨行；开定界符后不能是空白，闭定界符前不能是空白、后不能接数字；
 * - 公式体长度上限（默认 500）避免把大段文本误判为公式；
 * - `skip` 区间（代码块/行内代码）内的 `$` 一律忽略。
 */

export interface MathSpan {
  from: number;
  to: number;
  kind: 'inline' | 'block';
  body: string;
}

export interface MathScanOptions {
  /** 需要跳过的区间（升序、互不重叠），如代码块范围 */
  skip?: Array<{ from: number; to: number }>;
  maxBodyLength?: number;
}

function inSkip(pos: number, skip: Array<{ from: number; to: number }>): boolean {
  for (const range of skip) {
    if (pos >= range.from && pos < range.to) return true;
    if (range.from > pos) break;
  }
  return false;
}

export function scanMath(text: string, options: MathScanOptions = {}): MathSpan[] {
  const skip = [...(options.skip ?? [])].sort((a, b) => a.from - b.from);
  const maxBody = options.maxBodyLength ?? 500;
  const spans: MathSpan[] = [];
  const length = text.length;
  let index = 0;

  while (index < length) {
    const char = text[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char !== '$' || inSkip(index, skip)) {
      index += 1;
      continue;
    }

    const isBlock = text[index + 1] === '$';
    if (isBlock) {
      const bodyStart = index + 2;
      let cursor = bodyStart;
      let end = -1;
      while (cursor < length) {
        if (text[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (text[cursor] === '$' && text[cursor + 1] === '$') {
          end = cursor;
          break;
        }
        cursor += 1;
      }
      if (end === -1 || inSkip(index, skip)) break;
      const body = text.slice(bodyStart, end);
      if (body.length <= maxBody * 4) {
        spans.push({ from: index, to: end + 2, kind: 'block', body });
      }
      index = end + 2;
      continue;
    }

    // 行内：在同一行内找闭定界符
    const bodyStart = index + 1;
    if (text[bodyStart] === undefined || /\s/.test(text[bodyStart] ?? '')) {
      index += 1;
      continue;
    }
    let cursor = bodyStart;
    let end = -1;
    while (cursor < length) {
      const current = text[cursor] ?? '';
      if (current === '\n') break;
      if (current === '\\') {
        cursor += 2;
        continue;
      }
      if (current === '$') {
        const before = text[cursor - 1] ?? '';
        const after = text[cursor + 1] ?? '';
        if (!/\s/.test(before) && !/\d/.test(after) && cursor > bodyStart) {
          end = cursor;
          break;
        }
      }
      cursor += 1;
    }
    if (end === -1) {
      index += 1;
      continue;
    }
    const body = text.slice(bodyStart, end);
    if (body.length > 0 && body.length <= maxBody && !inSkip(end, skip)) {
      spans.push({ from: index, to: end + 1, kind: 'inline', body });
      index = end + 1;
      continue;
    }
    index += 1;
  }

  return spans;
}

/** 供命令使用：把选区文本包成公式（已有 `$` 包裹则原样返回）。 */
export function wrapMath(source: string, display: boolean): string {
  const trimmed = source.trim();
  if (!trimmed) return display ? '$$\n\n$$' : '$$';
  if (display) {
    if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) return trimmed;
    return `$$\n${trimmed}\n$$`;
  }
  if (trimmed.startsWith('$') && trimmed.endsWith('$')) return trimmed;
  return `$${trimmed}$`;
}
