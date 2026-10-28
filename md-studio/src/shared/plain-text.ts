/**
 * Markdown → 纯文本（REQ-027/028）：导出 .txt、复制为纯文本、粘贴为纯文本共用。
 * 纯函数，可单测；只做「去标记」，不做排版重排。
 */

const FENCE = /^\s*(`{3,}|~{3,})/;

/** 去掉行内标记，保留可读文字。 */
export function stripInlineMarkup(text: string): string {
  // 转义字符先换成占位符，避免 `\*` 被当作强调标记；最后再还原为原字符
  const literals: string[] = [];
  const guarded = text.replace(/\\([\\`*_{}\[\]()#+\-.!>~=|])/g, (_match, char: string) => {
    literals.push(char);
    return `\u0000${literals.length - 1}\u0000`;
  });
  const stripped = guarded
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/==(.*?)==/g, '$1')
    .replace(/<[^>]+>/g, '');
  return stripped.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => literals[Number(index)] ?? '');
}

/** 还原 Markdown 转义字符。 */
export function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\`*_{}\[\]()#+\-.!>~=|])/g, '$1');
}

/**
 * 把 Markdown 转成纯文本：
 * - 围栏代码块保留代码内容（去掉围栏行）；
 * - 标题/列表/引用/表格前缀去掉；
 * - 链接保留文字、图片保留 alt；行内标记去掉。
 */
export function markdownToPlainText(markdown: string): string {
  const lines = markdown.split(/\r\n|\r|\n/);
  const output: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      output.push(line);
      continue;
    }
    // front matter 分隔线与键值保留（导出纯文本时用户通常想要元数据）
    let text = line;
    text = text.replace(/^\s{0,3}#{1,6}\s+/, '');
    text = text.replace(/^\s{0,3}>\s?/, '');
    text = text.replace(/^\s{0,3}([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '');
    text = text.replace(/^\s{0,3}(=+|-{3,})\s*$/, '');
    if (/^\s*\|/.test(text)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(text)) continue;
      text = text
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((cell) => stripInlineMarkup(cell).trim())
        .join('\t');
    } else {
      text = stripInlineMarkup(text);
    }
    output.push(text);
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** 选中文本为空时返回整篇，便于「复制为纯文本」的两种语义共用。 */
export function plainTextOf(markdown: string): string {
  return markdownToPlainText(markdown);
}
