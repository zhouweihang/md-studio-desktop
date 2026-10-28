/**
 * 大纲抽取（REQ-012）：ATX 标题 + Setext 标题；跳过围栏代码块与行内代码行。
 * 纯文本扫描，不依赖 CodeMirror，可在 node 下测试。
 */

import { splitFrontMatter } from './front-matter';

export interface OutlineItem {
  level: number;
  text: string;
  line: number;
  pos: number;
}

const ATX_PATTERN = /^(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const SETEXT_PATTERN = /^\s*(=+|-+)\s*$/;
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

/** 去掉标题文本里的行内标记（`**粗**` → `粗`），用于大纲显示。 */
export function plainHeadingText(raw: string): string {
  return raw
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/==(.*?)==/g, '$1')
    .replace(/\[\^([^\]]*)\]/g, '')
    .trim();
}

export function extractOutline(text: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  let offset = 0;
  let fence: string | null = null;
  let previous: { text: string; line: number; pos: number; kind: 'plain' | 'heading' | 'other' } | null = null;
  // 前置元数据（REQ-017）不参与大纲：否则 `title: x` + `---` 会被误认成 Setext 标题
  const frontMatterEnd = splitFrontMatter(text).end;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const lineStart = offset;
    offset += line.length + 1;
    if (frontMatterEnd > 0 && lineStart < frontMatterEnd) {
      previous = { text: line, line: index + 1, pos: lineStart, kind: 'other' };
      continue;
    }

    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? '```';
      const char = marker[0] ?? '`';
      if (fence === null) fence = char;
      else if (fence === char) fence = null;
      previous = { text: line, line: index + 1, pos: lineStart, kind: 'other' };
      continue;
    }
    if (fence !== null) {
      previous = { text: line, line: index + 1, pos: lineStart, kind: 'other' };
      continue;
    }

    const atx = ATX_PATTERN.exec(line);
    if (atx && !/^\\/.test(line)) {
      const level = (atx[1] ?? '#').length;
      const headingText = plainHeadingText(atx[2] ?? '');
      items.push({ level, text: headingText || '(无标题)', line: index + 1, pos: lineStart });
      previous = { text: line, line: index + 1, pos: lineStart, kind: 'heading' };
      continue;
    }

    const setext = SETEXT_PATTERN.exec(line);
    if (setext && previous && previous.kind === 'plain' && previous.text.trim().length > 0) {
      const level = setext[1]?.startsWith('=') ? 1 : 2;
      items.push({
        level,
        text: plainHeadingText(previous.text),
        line: previous.line,
        pos: previous.pos
      });
      previous = { text: line, line: index + 1, pos: lineStart, kind: 'other' };
      continue;
    }

    const trimmed = line.trim();
    const kind: 'plain' | 'other' = trimmed.length > 0 ? 'plain' : 'other';
    previous = { text: line, line: index + 1, pos: lineStart, kind };
  }

  return items;
}

/** 大纲层级缩进（供侧栏渲染）：把 level 归一到相邻层级间距。 */
export function outlineDepth(item: OutlineItem, previous: OutlineItem | null): number {
  if (!previous) return 0;
  const step = item.level - previous.level;
  return step > 0 ? 1 : 0;
}
