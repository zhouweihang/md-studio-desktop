import { WidgetType, type EditorView } from '@codemirror/view';
import katex from 'katex';
import MarkdownIt from 'markdown-it';
import type { FrontMatterEntry } from '../../shared/front-matter';
import { sanitizeHtml } from '../export/html-sanitize';
import { toAssetUrl } from '../../shared/paths';
import { tr } from '../i18n';

/**
 * widget 契约（RFC §4.3）：只读渲染、不写文档、不吞键盘事件、destroy 幂等。
 * 需要交互的 widget（任务框、链接）通过 plugin 的 domEventHandlers 处理事件，
 * 事件由编辑器统一分发，widget 自身不直接改文档。
 */

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: false });

export class HrWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const node = document.createElement('div');
    node.className = 'md-hr';
    return node;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class FenceChipWidget extends WidgetType {
  constructor(private readonly lang: string) {
    super();
  }

  eq(other: FenceChipWidget): boolean {
    return other.lang === this.lang;
  }

  toDOM(): HTMLElement {
    const node = document.createElement('span');
    node.className = 'md-fence-chip';
    node.textContent = this.lang || 'code';
    return node;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class TaskWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number
  ) {
    super();
  }

  eq(other: TaskWidget): boolean {
    return other.checked === this.checked && other.from === this.from;
  }

  toDOM(): HTMLElement {
    const label = document.createElement('span');
    label.className = 'md-task';
    label.dataset.from = String(this.from);
    label.textContent = this.checked ? '☑' : '☐';
    label.title = tr('widget.taskToggle');
    return label;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class EmojiWidget extends WidgetType {
  constructor(
    private readonly char: string,
    private readonly shortcode: string
  ) {
    super();
  }

  eq(other: EmojiWidget): boolean {
    return other.char === this.char && other.shortcode === this.shortcode;
  }

  toDOM(): HTMLElement {
    const node = document.createElement('span');
    node.className = 'md-emoji';
    node.textContent = this.char;
    node.title = this.shortcode;
    return node;
  }
}

/** 脚注引用：显示为带上标序号的链接式标记（REQ-016）。 */
export class FootnoteRefWidget extends WidgetType {
  constructor(
    private readonly index: number,
    private readonly id: string
  ) {
    super();
  }

  eq(other: FootnoteRefWidget): boolean {
    return other.index === this.index && other.id === this.id;
  }

  toDOM(): HTMLElement {
    const node = document.createElement('sup');
    node.className = 'md-footnote-ref';
    node.dataset.footnote = this.id;
    node.textContent = this.index > 0 ? String(this.index) : '?';
    node.title =
      this.index > 0
        ? tr('widget.footnote', { index: this.index, id: this.id })
        : tr('widget.footnoteMissing', { id: this.id });
    return node;
  }
}

/** YAML front matter：非活动时渲染为键值面板（REQ-017）。 */
export class FrontMatterWidget extends WidgetType {
  constructor(private readonly entries: readonly FrontMatterEntry[]) {
    super();
  }

  private key(): string {
    return this.entries.map((entry) => `${entry.key}=${entry.value}`).join('\u0001');
  }

  eq(other: FrontMatterWidget): boolean {
    return other.key() === this.key();
  }

  toDOM(): HTMLElement {
    const host = document.createElement('div');
    host.className = 'md-widget-block md-front-matter';
    const head = document.createElement('div');
    head.className = 'md-front-matter-head';
    head.textContent = tr('widget.frontMatter');
    host.append(head);
    if (this.entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'md-front-matter-empty';
      empty.textContent = tr('widget.emptyValue');
      host.append(empty);
      return host;
    }
    const list = document.createElement('dl');
    list.className = 'md-front-matter-list';
    for (const entry of this.entries) {
      const key = document.createElement('dt');
      key.textContent = entry.key;
      const value = document.createElement('dd');
      value.textContent = entry.value || tr('widget.emptyValue');
      list.append(key, value);
    }
    host.append(list);
    return host;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** HTML 块：非活动时渲染（净化后）；解析失败保留源码（REQ-018）。 */
export class HtmlBlockWidget extends WidgetType {
  constructor(private readonly source: string) {
    super();
  }

  eq(other: HtmlBlockWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const host = document.createElement('div');
    host.className = 'md-widget-block md-html-block';
    try {
      const result = sanitizeHtml(this.source);
      if (result.removedTags > 0 || result.removedAttributes > 0) {
        host.title = tr('widget.sanitized', { tags: result.removedTags, attrs: result.removedAttributes });
      }
      host.innerHTML = result.html;
      if (!host.textContent?.trim() && !host.querySelector('img,svg,hr,br,input')) {
        host.textContent = this.source;
      }
    } catch {
      host.textContent = this.source;
    }
    return host;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string | null,
    private readonly alt: string
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'md-image-wrap';
    if (!this.src) {
      wrap.append(this.missing());
      return wrap;
    }
    const img = document.createElement('img');
    img.className = 'md-image';
    img.src = toAssetUrl(this.src);
    img.alt = this.alt;
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      img.replaceWith(this.missing());
    });
    wrap.append(img);
    return wrap;
  }

  private missing(): HTMLElement {
    const fallback = document.createElement('span');
    fallback.className = 'md-image-missing';
    fallback.textContent = tr('widget.imageMissing', {
      name: this.alt || tr('tabs.untitled'),
      src: this.src ? (this.src.split(/[\\/]/).pop() ?? this.src) : tr('widget.imageNoPath')
    });
    fallback.title = this.src ?? tr('widget.imageNoPathTitle');
    return fallback;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class TableWidget extends WidgetType {
  constructor(private readonly source: string) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'md-widget-block md-table-wrap';
    try {
      const html = markdown.render(this.source);
      const template = document.createElement('template');
      template.innerHTML = html;
      const table = template.content.querySelector('table');
      if (table) {
        table.classList.add('md-table');
        wrap.append(table);
      } else {
        wrap.textContent = this.source;
      }
    } catch {
      wrap.textContent = this.source;
    }
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class MathWidget extends WidgetType {
  constructor(
    private readonly html: string,
    private readonly display: boolean
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return other.html === this.html && other.display === this.display;
  }

  toDOM(): HTMLElement {
    const node = document.createElement(this.display ? 'div' : 'span');
    node.className = this.display ? 'md-math-block' : 'md-math-inline';
    node.innerHTML = this.html;
    return node;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 用 KaTeX 渲染为 HTML 字符串；失败返回 null（调用方保留源码并加错误装饰）。 */
export function renderMathHtml(tex: string, display: boolean): string | null {
  try {
    const html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      output: 'html'
    });
    if (html.includes('katex-error')) return null;
    return html;
  } catch {
    return null;
  }
}

interface MermaidCacheEntry {
  svg?: string;
  error?: string;
  promise?: Promise<void>;
}

const mermaidCache = new Map<string, MermaidCacheEntry>();
let mermaidSeq = 0;
/** widget 世代号：主题切换时自增，使已渲染的图表 DOM 失效重建。 */
let mermaidGeneration = 0;

function currentThemeMode(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

async function renderMermaid(code: string, theme: 'light' | 'dark'): Promise<{ svg?: string; error?: string }> {
  try {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: 'inherit'
    });
    mermaidSeq += 1;
    const { svg } = await mermaid.render(`mdstudio-mermaid-${mermaidSeq}`, code);
    return { svg };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export class MermaidWidget extends WidgetType {
  constructor(
    private readonly code: string,
    /** 主题代号：切换主题后自增，使同代码的 widget 不再相等，从而重建 DOM（REQ-035） */
    private readonly generation: number = mermaidGeneration
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return other.code === this.code && other.generation === this.generation;
  }

  toDOM(): HTMLElement {
    const host = document.createElement('div');
    host.className = 'md-widget-block md-mermaid';
    host.textContent = tr('widget.mermaidRendering');
    const theme = currentThemeMode();
    const key = `${theme}::${this.code}`;
    const cached = mermaidCache.get(key);
    if (cached?.svg) {
      host.innerHTML = cached.svg;
      return host;
    }
    if (cached?.error) {
      this.showError(host, cached.error);
      return host;
    }
    if (!cached?.promise) {
      const entry: MermaidCacheEntry = {};
      entry.promise = renderMermaid(this.code, theme).then(({ svg, error }) => {
        if (svg !== undefined) entry.svg = svg;
        else entry.error = error ?? tr('widget.renderFailed');
      });
      mermaidCache.set(key, entry);
    }
    void mermaidCache
      .get(key)!
      .promise?.then(() => {
        const result = mermaidCache.get(key);
        if (!host.isConnected) return;
        if (result?.svg) host.innerHTML = result.svg;
        else this.showError(host, result?.error ?? tr('widget.renderFailed'));
      });
    return host;
  }

  private showError(host: HTMLElement, message: string): void {
    host.classList.remove('md-mermaid');
    host.classList.add('md-mermaid-error');
    host.textContent = tr('widget.mermaidFailed', { message });
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** 导出用：把 mermaid 代码渲染为 SVG（失败返回 null，导出保留源码块）。 */
export async function renderMermaidToSvg(code: string): Promise<string | null> {
  const result = await renderMermaid(code, currentThemeMode());
  return result.svg ?? null;
}

/** 主题切换后清空 mermaid 缓存（暗色/明亮渲染结果不同）。 */
export function invalidateMermaidCache(): void {
  mermaidCache.clear();
  mermaidGeneration += 1;
}

/**
 * 主题变更后主动重绘可见图表（REQ-035）：清缓存 + 让块装饰重建，
 * 从而触发未变更代码的 mermaid widget 重新渲染。
 */
export function redrawMermaidWidgets(view: EditorView): void {
  invalidateMermaidCache();
  view.dispatch({ selection: view.state.selection });
}
