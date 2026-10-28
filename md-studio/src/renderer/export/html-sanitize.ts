/**
 * 导出 HTML 白名单净化（REQ-018）：文档里的内联/块级 HTML 会被渲染进导出件，
 * 这里用真实 DOM 解析后按白名单裁剪（不用正则），并给出被移除的计数（可观测）。
 *
 * 设计取舍：
 * - 脚本类容器（script/style/iframe/object/embed/form/base/meta/link）整体删除（连带子节点）；
 * - 未在白名单但无害的标签「脱壳」保留文本（如 <custom>文字</custom> → 文字）；
 * - 属性按白名单保留，`on*` 事件属性与 `javascript:` 类协议一律去掉；
 * - 允许 SVG（Mermaid 产出的图表）但与其它标签同样受属性白名单约束。
 */

export interface SanitizeResult {
  html: string;
  removedTags: number;
  removedAttributes: number;
}

const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'base',
  'meta',
  'link',
  'template',
  'noscript',
  'math'
]);

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'aside', 'article', 'b', 'big', 'blockquote', 'br', 'caption', 'center', 'cite', 'code',
  'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'input', 'ins', 'kbd', 'li',
  'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'span', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
  // SVG（Mermaid / KaTeX 产物）
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath',
  'defs', 'marker', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'stop', 'use', 'symbol',
  'title', 'desc', 'foreignObject'
]);

const GLOBAL_ATTRS = new Set([
  'class', 'id', 'title', 'style', 'dir', 'lang', 'align', 'role', 'translate', 'loading'
]);

const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel', 'name']),
  img: new Set(['src', 'alt', 'width', 'height', 'srcset']),
  input: new Set(['type', 'checked', 'disabled']),
  td: new Set(['colspan', 'rowspan', 'width', 'height']),
  th: new Set(['colspan', 'rowspan', 'width', 'height', 'scope']),
  ol: new Set(['start', 'type']),
  li: new Set(['value']),
  time: new Set(['datetime']),
  col: new Set(['span', 'width']),
  colgroup: new Set(['span']),
  q: new Set(['cite']),
  blockquote: new Set(['cite']),
  // SVG 常用属性
  svg: new Set(['xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke', 'version', 'preserveAspectRatio', 'aria-roledescription']),
  path: new Set(['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'transform', 'marker-end', 'marker-start', 'opacity', 'fill-rule', 'clip-rule']),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'transform', 'opacity']),
  circle: new Set(['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'opacity']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity']),
  line: new Set(['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'marker-end', 'marker-start']),
  polyline: new Set(['points', 'fill', 'stroke', 'stroke-width', 'marker-end']),
  polygon: new Set(['points', 'fill', 'stroke', 'stroke-width']),
  text: new Set(['x', 'y', 'dx', 'dy', 'text-anchor', 'font-size', 'font-family', 'font-weight', 'fill', 'transform', 'dominant-baseline', 'lengthAdjust', 'textLength']),
  tspan: new Set(['x', 'y', 'dx', 'dy', 'text-anchor', 'font-size', 'font-family', 'fill', 'dominant-baseline']),
  g: new Set(['transform', 'fill', 'stroke', 'stroke-width', 'opacity', 'class']),
  defs: new Set([]),
  marker: new Set(['id', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'viewBox']),
  clipPath: new Set(['id', 'transform']),
  mask: new Set(['id', 'x', 'y', 'width', 'height']),
  pattern: new Set(['id', 'width', 'height', 'patternUnits', 'patternContentUnits', 'viewBox']),
  linearGradient: new Set(['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform']),
  radialGradient: new Set(['id', 'cx', 'cy', 'r', 'gradientUnits', 'gradientTransform']),
  stop: new Set(['offset', 'stop-color', 'stop-opacity']),
  use: new Set(['href', 'x', 'y', 'width', 'height', 'transform']),
  foreignObject: new Set(['x', 'y', 'width', 'height']),
  textPath: new Set(['href', 'startOffset']),
  symbol: new Set(['id', 'viewBox'])
};

const SAFE_URL = /^(https?:|mailto:|tel:|file:|mdstudio-asset:|\.{0,2}\/|#)/i;
const SAFE_DATA = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i;
const DANGEROUS_STYLE = /expression\s*\(|javascript:|url\s*\(\s*['"]?\s*javascript:/i;

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return true;
  if (SAFE_DATA.test(trimmed)) return true;
  // 带协议头的（javascript:、vbscript:、data:text/html …）只允许白名单
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return SAFE_URL.test(trimmed);
  return true;
}

function cleanAttributes(element: Element, stats: SanitizeResult): void {
  const tag = element.tagName.toLowerCase();
  const allowed = TAG_ATTRS[tag];
  for (const attr of [...element.attributes]) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('data-') || name.startsWith('aria-') || name === 'data-href') continue;
    if (GLOBAL_ATTRS.has(name)) {
      if (name === 'style' && DANGEROUS_STYLE.test(attr.value)) {
        element.removeAttribute(attr.name);
        stats.removedAttributes += 1;
      }
      continue;
    }
    if (!allowed?.has(attr.name) && !allowed?.has(name)) {
      element.removeAttribute(attr.name);
      stats.removedAttributes += 1;
      continue;
    }
    if ((name === 'href' || name === 'src' || name === 'srcset') && !isSafeUrl(attr.value)) {
      element.removeAttribute(attr.name);
      stats.removedAttributes += 1;
    }
  }
  if (tag === 'input' && element.getAttribute('type')?.toLowerCase() !== 'checkbox') {
    element.remove();
    stats.removedTags += 1;
  }
}

function sanitizeElement(element: Element, stats: SanitizeResult): void {
  for (const child of [...element.children]) {
    const tag = child.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) {
      child.remove();
      stats.removedTags += 1;
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // 脱壳：保留子内容，去掉标签本身
      stats.removedTags += 1;
      sanitizeElement(child, stats);
      while (child.firstChild) element.insertBefore(child.firstChild, child);
      child.remove();
      continue;
    }
    cleanAttributes(child, stats);
    sanitizeElement(child, stats);
  }
}

/** 净化一段 HTML；`document` 缺省用当前全局（浏览器/编辑器渲染层）。 */
export function sanitizeHtml(html: string, doc?: Document): SanitizeResult {
  const stats: SanitizeResult = { html, removedTags: 0, removedAttributes: 0 };
  const documentRef = doc ?? (typeof document !== 'undefined' ? document : null);
  if (!documentRef) return stats;
  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<body>${html}</body>`, 'text/html');
  const body = parsed.body;
  sanitizeElement(body, stats);
  return { html: body.innerHTML, removedTags: stats.removedTags, removedAttributes: stats.removedAttributes };
}
