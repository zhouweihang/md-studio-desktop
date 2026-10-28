/**
 * 目录（TOC）生成（REQ-020）：从大纲条目生成 Markdown / HTML 目录，并提供稳定的标题锚点。
 * 纯函数，可单测；编辑器命令与导出管线共用。
 */

import type { OutlineItem } from './outline';

export const TOC_MARKER = '[TOC]';

export interface TocItem {
  level: number;
  text: string;
  /** 去重后的锚点 id（不含 `#`） */
  id: string;
}

/**
 * GitHub 风格 slug：小写、空白转 `-`、去掉标点，保留中日韩字符与数字/字母。
 * 与常见 Markdown 渲染器一致，便于导出件被外链引用。
 */
export function slugifyHeading(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/** 为标题序列分配唯一锚点（重复标题追加 `-2`、`-3`）。 */
export function assignHeadingIds(items: ReadonlyArray<{ level: number; text: string }>): TocItem[] {
  const used = new Map<string, number>();
  return items.map((item) => {
    const base = slugifyHeading(item.text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return { level: item.level, text: item.text, id: count === 0 ? base : `${base}-${count + 1}` };
  });
}

export interface TocOptions {
  /** 参与目录的最小/最大标题级别（默认 1~6） */
  minLevel?: number;
  maxLevel?: number;
  bullet?: string;
  /** 是否输出为可点击链接（Markdown 目录默认为链接） */
  linked?: boolean;
}

/** 过滤层级并分配锚点 id（导出与编辑器命令共用同一算法）。 */
export function tocItemsFrom(
  items: ReadonlyArray<{ level: number; text: string }>,
  options: TocOptions = {}
): TocItem[] {
  const minLevel = options.minLevel ?? 1;
  const maxLevel = options.maxLevel ?? 6;
  const kept = items.filter((item) => item.level >= minLevel && item.level <= maxLevel);
  return assignHeadingIds(kept.map((item) => ({ level: item.level, text: item.text })));
}

function filterItems(items: ReadonlyArray<OutlineItem>, options: TocOptions): TocItem[] {
  return tocItemsFrom(items, options);
}

/** 生成插入到文档中的 Markdown 目录（层级用缩进表示）。 */
export function buildTocMarkdown(items: ReadonlyArray<OutlineItem>, options: TocOptions = {}): string {
  const toc = filterItems(items, options);
  if (toc.length === 0) return '';
  const bullet = options.bullet ?? '-';
  const linked = options.linked !== false;
  const baseLevel = Math.min(...toc.map((item) => item.level));
  const lines = toc.map((item) => {
    const indent = '  '.repeat(Math.max(0, item.level - baseLevel));
    const label = linked ? `[${item.text}](#${item.id})` : item.text;
    return `${indent}${bullet} ${label}`;
  });
  return `${lines.join('\n')}\n`;
}

interface TocNode {
  item: TocItem | null;
  children: TocNode[];
}

/** 按标题级别把线性条目折成树（级别跳跃时向上一层挂载）。 */
export function buildTocTreeFromItems(toc: readonly TocItem[]): TocNode | null {
  if (toc.length === 0) return null;
  const root: TocNode = { item: null, children: [] };
  const stack: Array<{ level: number; node: TocNode }> = [{ level: 0, node: root }];
  for (const item of toc) {
    while (stack.length > 1 && stack[stack.length - 1]!.level >= item.level) stack.pop();
    const node: TocNode = { item, children: [] };
    stack[stack.length - 1]!.node.children.push(node);
    stack.push({ level: item.level, node });
  }
  return root;
}

/** 由大纲条目折叠目录树（编辑器/导出便利入口）。 */
export function buildTocTree(items: ReadonlyArray<OutlineItem>, options: TocOptions = {}): TocNode | null {
  return buildTocTreeFromItems(tocItemsFrom(items, options));
}

function renderNodes(nodes: readonly TocNode[]): string {
  if (nodes.length === 0) return '';
  const inner = nodes
    .map((node) => {
      const label = node.item ? `<a href="#${node.item.id}">${escapeHtml(node.item.text)}</a>` : '';
      return `<li>${label}${renderNodes(node.children)}</li>`;
    })
    .join('');
  return `<ul>${inner}</ul>`;
}

/** 由已分配 id 的条目生成 HTML 目录（与导出标题 id 严格同源）。 */
export function renderTocHtmlFromItems(toc: readonly TocItem[]): string {
  const tree = buildTocTreeFromItems(toc);
  if (!tree) return '';
  return `<nav class="md-toc">${renderNodes(tree.children)}</nav>`;
}

/** 生成导出用 HTML 目录（嵌套 `<ul>`，与标题 id 对应）。 */
export function buildTocHtml(items: ReadonlyArray<OutlineItem>, options: TocOptions = {}): string {
  return renderTocHtmlFromItems(tocItemsFrom(items, options));
}

/** 把文档中的 `[TOC]` 行替换为生成的 Markdown 目录。 */
export function replaceTocPlaceholder(markdown: string, items: ReadonlyArray<OutlineItem>, options: TocOptions = {}): string {
  if (!markdown.includes(TOC_MARKER)) return markdown;
  const toc = buildTocMarkdown(items, options);
  if (!toc) return markdown;
  return markdown
    .split(/\r?\n/)
    .map((line) => (line.trim() === TOC_MARKER ? toc.trimEnd() : line))
    .join('\n');
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
