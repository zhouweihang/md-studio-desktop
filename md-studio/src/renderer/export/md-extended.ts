/**
 * 导出侧扩展语法（REQ-016/019/020）：把编辑器里能看到的语法，在导出的 HTML 中渲染出来。
 *
 * - `==高亮==`、`~下标~`、`^上标^`：行内规则（内层内容递归解析，支持嵌套强调）；
 * - `:emoji:`：短代码 → 字符（与编辑器共用 `shared/emoji` 表）；
 * - 定义列表：`markdown-it-deflist`；
 * - 脚注：由 markdown-it 内置支持（见 render-html 的 html 选项）；
 * - 标题锚点 + 目录：core 规则一次性分配 id 并生成目录 HTML（与标题严格同源）。
 *
 * 内联 HTML 由 markdown-it 的 `html: true` 渲染，随后统一净化（见 renderer/export/html-sanitize）。
 */

import type { MarkdownIt, StateInline, Token } from 'markdown-it';
import deflist from 'markdown-it-deflist';
import footnote from 'markdown-it-footnote';
import { emojiFor } from '../../shared/emoji';
import { plainHeadingText } from '../../shared/outline';
import { renderTocHtmlFromItems, tocItemsFrom, type TocItem } from '../../shared/toc';

export const TOC_TOKEN = '@@MDSTOC@@';

interface ExtendedEnv {
  headings?: TocItem[];
  tocHtml?: string;
}

type InlineRule = (state: StateInline, silent: boolean) => boolean;

function findClosingMarker(src: string, from: number, marker: string): number {
  for (let index = from; index < src.length; index++) {
    const ch = src[index];
    if (ch === '\n') return -1;
    if (ch === '\\') {
      index += 1;
      continue;
    }
    if (marker.length === 1 && (ch === ' ' || ch === '\t')) return -1;
    if (src.startsWith(marker, index)) {
      if (marker === '==' && src[index - 1] === ' ') return -1;
      if (marker.length === 1 && src.startsWith(marker, index + 1)) return -1;
      if (index > from) return index;
      return -1;
    }
  }
  return -1;
}

/** 生成 `==x==`（tag=mark）、`~x~`（tag=sub）、`^x^`（tag=sup）的行内规则。 */
function makeDelimitedRule(marker: string, tag: string): InlineRule {
  return (state, silent) => {
    const { src } = state;
    const start = state.pos;
    if (!src.startsWith(marker, start)) return false;
    if (marker.length === 1 && src.startsWith(marker, start + 1)) return false;
    const close = findClosingMarker(src, start + marker.length, marker);
    if (close < 0) return false;
    if (!silent) {
      const open = state.push(`${tag}_open`, tag, 1);
      open.markup = marker;
      const inner = src.slice(start + marker.length, close);
      const innerTokens: Token[] = [];
      state.md.inline.parse(inner, state.md, state.env, innerTokens);
      state.tokens.push(...innerTokens);
      const closeToken = state.push(`${tag}_close`, tag, -1);
      closeToken.markup = marker;
    }
    state.pos = close + marker.length;
    return true;
  };
}

/** `:smile:` → 😄（未知短代码保持原样）。 */
const emojiRule: InlineRule = (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x3a /* : */) return false;
  const match = /^:([a-zA-Z0-9_+-]+):/.exec(state.src.slice(state.pos, state.pos + 48));
  if (!match) return false;
  const char = emojiFor(match[1] ?? '');
  if (!char) return false;
  if (!silent) {
    const token = state.push('text', '', 0);
    token.content = char;
  }
  state.pos += match[0].length;
  return true;
};

interface RulerLike {
  before(beforeName: string, ruleName: string, fn: InlineRule): void;
}

/** 注册全部扩展（幂等：同一实例重复调用不会重复注册）。 */
const extended = new WeakSet<object>();

export function extendMarkdown(md: MarkdownIt): void {
  if (extended.has(md)) return;
  extended.add(md);

  deflist(md as never);
  footnote(md as never);

  const ruler = md.inline.ruler as unknown as RulerLike;
  ruler.before('emphasis', 'mdstudio_mark', makeDelimitedRule('==', 'mark'));
  ruler.before('emphasis', 'mdstudio_sub', makeDelimitedRule('~', 'sub'));
  ruler.before('emphasis', 'mdstudio_sup', makeDelimitedRule('^', 'sup'));
  ruler.before('text', 'mdstudio_emoji', emojiRule);

  // 标题锚点 + 目录：单次遍历分配 id，保证目录链接与标题 id 同源
  md.core.ruler.push('mdstudio_headings', (state) => {
    const env = state.env as ExtendedEnv;
    const headings: TocItem[] = [];
    const raw: Array<{ level: number; text: string }> = [];
    const headingTokens: Array<{ open: Token; index: number }> = [];
    for (let index = 0; index < state.tokens.length; index++) {
      const token = state.tokens[index]!;
      if (token.type !== 'heading_open') continue;
      const level = Number(token.tag.slice(1));
      const inline = state.tokens[index + 1];
      const text = inline?.type === 'inline' ? plainHeadingText(inline.content) : '';
      raw.push({ level, text });
      headingTokens.push({ open: token, index: raw.length - 1 });
    }
    const assigned = tocItemsFrom(raw);
    for (const item of assigned) {
      headings.push(item);
    }
    for (const entry of headingTokens) {
      const item = headings[entry.index];
      if (item) entry.open.attrSet('id', item.id);
    }
    env.headings = headings;
    env.tocHtml = headings.length > 0 ? renderTocHtmlFromItems(headings) : '';
  });
}
