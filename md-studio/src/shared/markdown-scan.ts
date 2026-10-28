/**
 * Markdown 围栏扫描（导出/公式跳过共用）：定位 ```lang 代码块的源码区间与内容。
 * 纯函数，可单测。
 */

export interface FenceBlock {
  /** 整个围栏块（含起止标记行）在文本中的区间 */
  from: number;
  to: number;
  info: string;
  code: string;
  codeFrom: number;
  codeTo: number;
  startLine: number;
  endLine: number;
}

const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)?.*$/;

export function findFences(text: string, infoFilter?: string): FenceBlock[] {
  const blocks: FenceBlock[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const match = FENCE_OPEN.exec(line);
    if (!match) {
      index += 1;
      continue;
    }
    const marker = match[2] ?? '```';
    const char = marker[0] ?? '`';
    const info = (match[3] ?? '').trim();
    const openLine = index;
    const openLineOffset = lineOffsets[openLine] ?? 0;
    const codeStart = openLineOffset + line.length + 1;

    let close = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const candidate = (lines[cursor] ?? '').trim();
      if (new RegExp(`^\\${char}{${marker.length},}$`).test(candidate)) {
        close = cursor;
        break;
      }
    }
    const closeLine = close === -1 ? lines.length - 1 : close;
    const codeEnd = close === -1 ? text.length : (lineOffsets[closeLine] ?? text.length) - 1;
    const blockEnd = close === -1 ? text.length : (lineOffsets[closeLine] ?? 0) + (lines[closeLine]?.length ?? 0);

    const block: FenceBlock = {
      from: openLineOffset,
      to: blockEnd,
      info,
      code: text.slice(codeStart, Math.max(codeStart, codeEnd)),
      codeFrom: codeStart,
      codeTo: Math.max(codeStart, codeEnd),
      startLine: openLine + 1,
      endLine: closeLine + 1
    };
    if (!infoFilter || info.split(/\s+/)[0] === infoFilter) blocks.push(block);
    index = closeLine + 1;
  }
  return blocks;
}

/** 围栏代码区间（供公式扫描跳过）。 */
export function codeRanges(text: string): Array<{ from: number; to: number }> {
  return findFences(text).map((block) => ({ from: block.from, to: block.to }));
}
