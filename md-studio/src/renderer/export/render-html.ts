import MarkdownIt from 'markdown-it';
import katex from 'katex';
import { frontMatterString, splitFrontMatter } from '../../shared/front-matter';
import { sanitizeHtml } from './html-sanitize';
import { scanMath } from '../../shared/math';
import { findFences } from '../../shared/markdown-scan';
import { escapeHtml, highlightCode } from './highlight';
import { TOC_TOKEN, extendMarkdown } from './md-extended';
import { tr } from '../i18n';
import type { InlineMathFontsScope } from '../../shared/settings';

export interface RenderDocumentOptions {
  markdown: string;
  title: string;
  /** 主题 CSS（内置或用户主题的变量表），导出件与编辑器所见一致 */
  themeCss: string;
  /** KaTeX 样式文本（可选；用于公式排版） */
  katexCss?: string;
  /** KaTeX 字体内联范围（REQ-035 / B5-5；默认不内联） */
  inlineMathFonts?: InlineMathFontsScope;
  /** Mermaid → SVG；缺失时保留源码块 */
  mermaidToSvg?: (code: string) => Promise<string | null>;
  /** 图片 src 重写（默认原样保留相对路径） */
  resolveImageSrc?: (src: string) => string;
  /** 是否对渲染结果做白名单净化（默认开启；测试可关） */
  sanitize?: boolean;
  /** 是否把 front matter 从正文剔除（默认开启） */
  stripFrontMatter?: boolean;
  /** 净化统计回调（导出后可观测） */
  onSanitize?: (stats: { removedTags: number; removedAttributes: number }) => void;
}

interface Edit {
  from: number;
  to: number;
  insert: string;
}

const PRINT_CSS = `
  html { background: #fff; }
  body.md-export { margin: 0; }
  article.md-document { max-width: 780px; margin: 0 auto; padding: 40px 24px 64px; }
  .md-document img { max-width: 100%; height: auto; }
  .md-document pre.md-codeblock { background: var(--md-color-code-bg, #f5f5f5); border-radius: 6px; padding: 12px 14px; overflow-x: auto; }
  .md-document code { font-family: var(--md-font-mono, monospace); font-size: 0.92em; }
  .md-document table { border-collapse: collapse; margin: 12px 0; }
  .md-document th, .md-document td { border: 1px solid var(--md-color-line, #ddd); padding: 5px 12px; }
  .md-document blockquote { border-left: 3px solid var(--md-color-line, #ddd); margin: 12px 0; padding: 2px 16px; color: var(--md-color-muted, #666); }
  .md-document .md-math-block { text-align: center; margin: 12px 0; overflow-x: auto; }
  .md-document .md-mermaid { display: flex; justify-content: center; margin: 12px 0; }
  .md-document .md-mermaid-error { color: #b3301f; white-space: pre-wrap; }
  .md-document li.md-task-item { list-style: none; }
  .md-document mark { background: var(--md-color-highlight, #fff3a3); color: inherit; }
  .md-document .md-toc { background: var(--md-color-surface-alt, #f7f7f7); border-radius: 8px; padding: 12px 18px; }
  .md-document .md-toc ul { margin: 4px 0; padding-left: 20px; }
  .md-document dl { margin: 12px 0; }
  .md-document dt { font-weight: 600; }
  .md-document dd { margin: 0 0 6px 22px; color: var(--md-color-ink-secondary, #444); }
  .md-document section.footnotes { margin-top: 32px; font-size: 0.92em; color: var(--md-color-ink-secondary, #444); }
  @media print {
    article.md-document { max-width: none; padding: 0; }
    pre, table, .md-mermaid, blockquote { break-inside: avoid; }
    h1, h2, h3, h4 { break-after: avoid; }
  }
`;

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;

function createMarkdownIt(): MarkdownItInstance {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: false, typographer: false });
  extendMarkdown(md as never);
  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index]!;
    const info = token.info.trim();
    const language = info.split(/\s+/)[0] ?? '';
    const highlighted = highlightCode(token.content, info);
    const languageClass = language ? ` class="language-${escapeHtml(language)}"` : '';
    return `<pre class="md-codeblock hljs"><code${languageClass}>${highlighted}</code></pre>\n`;
  };
  md.renderer.rules.image = (tokens, index, options, _env, self) => {
    const token = tokens[index]!;
    token.attrSet('loading', 'lazy');
    return self.renderToken(tokens, index, options);
  };
  return md;
}

const markdownIt = createMarkdownIt();

/** 行内代码区间（公式扫描要跳过）。 */
function inlineCodeRanges(text: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  const pattern = /(`+)([^`]*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  return ranges;
}

function renderMath(tex: string, display: boolean): string | null {
  try {
    const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: false, output: 'html' });
    if (html.includes('katex-error')) return null;
    return html;
  } catch {
    return null;
  }
}

/** `[TOC]` 独立段落 → 占位符（渲染后再替换为目录 HTML）。 */
function tocEdits(source: string): Edit[] {
  const edits: Edit[] = [];
  const pattern = /^[ \t]*\[TOC\][ \t]*$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    edits.push({ from: match.index, to: match.index + match[0].length, insert: TOC_TOKEN });
  }
  return edits;
}

/** 生成正文 HTML（不套完整文档骨架，供测试与复用）。 */
export async function renderDocumentBody(options: RenderDocumentOptions): Promise<string> {
  const frontMatter = splitFrontMatter(options.markdown);
  const source = options.stripFrontMatter === false || !frontMatter.present ? options.markdown : frontMatter.body;
  const edits: Edit[] = tocEdits(source);
  const placeholders = new Map<string, string>();
  let blockSeq = 0;
  let inlineSeq = 0;

  const fences = findFences(source);

  // 1) Mermaid 预渲染为 SVG（失败保留源码块）
  for (const fence of fences) {
    if (fence.info.split(/\s+/)[0] !== 'mermaid') continue;
    const token = `@@MDSMMD${blockSeq}@@`;
    blockSeq += 1;
    let replacement: string;
    const svg = options.mermaidToSvg ? await options.mermaidToSvg(fence.code.trim()) : null;
    if (svg) {
      replacement = `\n\n${token}\n\n`;
      placeholders.set(token, `<div class="md-mermaid">${svg}</div>`);
    } else {
      replacement = `\n\n${token}\n\n`;
      placeholders.set(
        token,
        `<div class="md-mermaid-error">${escapeHtml(tr('widget.mermaidFailed', { message: '' }))}\n${escapeHtml(fence.code.trim())}</div>`
      );
    }
    edits.push({ from: fence.from, to: fence.to, insert: replacement });
  }

  // 2) 公式：块级与行内（跳过代码区间）
  const skip = [
    ...fences.map((fence) => ({ from: fence.from, to: fence.to })),
    ...inlineCodeRanges(source)
  ].sort((left, right) => left.from - right.from);
  for (const span of scanMath(source, { skip })) {
    if (span.kind === 'block') {
      const token = `@@MDSBLK${blockSeq}@@`;
      blockSeq += 1;
      const html = renderMath(span.body.trim(), true);
      edits.push({ from: span.from, to: span.to, insert: `\n\n${token}\n\n` });
      placeholders.set(
        token,
        html ? `<div class="md-math-block">${html}</div>` : `<pre class="md-math-error">${escapeHtml(span.body)}</pre>`
      );
    } else {
      const token = `@@MDSINL${inlineSeq}@@`;
      inlineSeq += 1;
      const html = renderMath(span.body.trim(), false);
      edits.push({ from: span.from, to: span.to, insert: token });
      placeholders.set(token, html ?? `<code class="md-math-error">${escapeHtml(span.body)}</code>`);
    }
  }

  // 逆序套用，保证偏移不漂移
  edits.sort((left, right) => right.from - left.from);
  let working = source;
  for (const edit of edits) {
    working = `${working.slice(0, edit.from)}${edit.insert}${working.slice(edit.to)}`;
  }

  const env: Record<string, unknown> = {};
  let html = markdownIt.render(working, env);

  // 3) 净化（脚本类标签与事件属性在此被移除；我们自行生成的内容随后注入）
  if (options.sanitize !== false) {
    const result = sanitizeHtml(html);
    html = result.html;
    options.onSanitize?.({ removedTags: result.removedTags, removedAttributes: result.removedAttributes });
  }

  // 4) 任务列表：`<li>[ ] …` → 复选框
  html = html
    .replace(/<li>\s*\[ \]\s*/g, '<li class="md-task-item"><input type="checkbox" disabled> ')
    .replace(/<li>\s*\[[xX]\]\s*/g, '<li class="md-task-item"><input type="checkbox" checked disabled> ');

  // 5) 目录占位符 → 目录 HTML（与标题 id 同源）
  const tocHtml = typeof env.tocHtml === 'string' ? env.tocHtml : '';
  html = html.replace(new RegExp(`<p>\\s*${TOC_TOKEN}\\s*</p>`, 'g'), () => tocHtml || '');
  html = html.split(TOC_TOKEN).join(tocHtml);

  // 6) 占位符回填（块级会包在 <p>…</p> 里）
  for (const [token, replacement] of placeholders) {
    html = html.replace(new RegExp(`<p>\\s*${token}\\s*</p>`, 'g'), replacement);
    html = html.split(token).join(replacement);
  }

  if (options.resolveImageSrc) {
    html = html.replace(/(<img[^>]+src=")([^"]+)(")/g, (_match: string, prefix: string, src: string, suffix: string) => {
      return `${prefix}${escapeHtml(options.resolveImageSrc!(src))}${suffix}`;
    });
  }

  return html;
}

/** 生成完整自包含 HTML 文档（REQ-014 + REQ-017 元信息）。 */
export async function renderDocumentHtml(options: RenderDocumentOptions): Promise<string> {
  const frontMatter = splitFrontMatter(options.markdown);
  const body = await renderDocumentBody(options);
  const title = escapeHtml(options.title || frontMatterString(frontMatter, 'title') || tr('tabs.untitled'));
  const author = frontMatterString(frontMatter, 'author');
  const description = frontMatterString(frontMatter, 'description');
  const metaLines = [
    `<meta name="generator" content="MD-Studio" />`,
    author ? `<meta name="author" content="${escapeHtml(author)}" />` : '',
    description ? `<meta name="description" content="${escapeHtml(description)}" />` : ''
  ]
    .filter(Boolean)
    .join('\n');
  let katexCss = options.katexCss ?? '';
  if (katexCss && options.inlineMathFonts && options.inlineMathFonts !== 'off') {
    // 动态引入：未开启选项时不把字体 chunk 进主包
    const { inlineKatexFonts } = await import('./katex-fonts');
    katexCss = inlineKatexFonts(katexCss, options.inlineMathFonts).css;
  }
  const katexStyle = katexCss ? `<style>${katexCss}</style>` : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
${metaLines}
<title>${title}</title>
<style>${options.themeCss}</style>
${katexStyle}
<style>${PRINT_CSS}</style>
</head>
<body class="md-export">
<article class="md-document">
${body}
</article>
</body>
</html>
`;
}
