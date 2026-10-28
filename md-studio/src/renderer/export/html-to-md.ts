/**
 * HTML → Markdown（REQ-028）：从 Word/浏览器复制的内容粘贴为 Markdown。
 * 用 turndown 做转换，额外支持删除线（`~~`）与常见 Office 标记的清理。
 */

import TurndownService from 'turndown';
import { markdownToPlainText } from '../../shared/plain-text';

let service: TurndownService | null = null;

function getService(): TurndownService {
  if (service) return service;
  const instance = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined'
  });
  instance.addRule('strikethrough', {
    filter: (node) => ['DEL', 'S', 'STRIKE'].includes(node.nodeName),
    replacement: (content) => (content.trim() ? `~~${content.trim()}~~` : '')
  });
  instance.addRule('keepLineBreaks', {
    filter: ['br'],
    replacement: () => '\n'
  });
  instance.remove(['script', 'style', 'head', 'meta', 'title']);
  service = instance;
  return instance;
}

/** HTML → Markdown；输入不是 HTML 时原样返回。 */
export function htmlToMarkdown(html: string): string {
  const trimmed = html.trim();
  if (!trimmed || !/<[a-z!/]/i.test(trimmed)) return trimmed;
  try {
    return getService().turndown(trimmed).replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return htmlToPlainTextFallback(trimmed);
  }
}

/** HTML → 纯文本（粘贴为纯文本用）：无 DOM 依赖的保守实现。 */
export function htmlToPlainTextFallback(html: string): string {
  const withoutBlocks = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(withoutBlocks).replace(/\n{3,}/g, '\n\n').trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/** HTML → 纯文本（优先 turndown，保底用保守实现）。 */
export function htmlToPlain(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return '';
  try {
    return markdownToPlainText(htmlToMarkdown(trimmed));
  } catch {
    return htmlToPlainTextFallback(trimmed);
  }
}
