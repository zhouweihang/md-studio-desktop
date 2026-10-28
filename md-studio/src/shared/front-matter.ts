/**
 * YAML front matter（REQ-017）：解析文首 `---` 元数据块。
 * 只支持 Typora/常见静态站点用到的子集：`key: value`、引号值、行内数组 `[a, b]`、
 * 块标量 `key: |` / `key: >`（按行拼接为字符串）、`#` 注释。复杂 YAML（嵌套映射、
 * 多文档、锚点）不支持，遇到时按字符串保留并标注。
 *
 * 纯函数，可单测。
 */

export interface FrontMatterEntry {
  key: string;
  /** 归一化后的值（数组用 `, ` 连接） */
  value: string;
  /** 值是否为数组 */
  list: boolean;
  line: number;
}

export interface FrontMatterResult {
  present: boolean;
  entries: FrontMatterEntry[];
  data: Record<string, string | string[]>;
  /** 去掉 front matter 之后的正文 */
  body: string;
  /** front matter（含结束行换行）在原文中的结束偏移；无 front matter 时为 0 */
  end: number;
  /** front matter 原文（不含首尾 `---` 行） */
  raw: string;
}

const DELIMITER = /^---\s*$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).replace(/\\"/g, '"');
    }
  }
  return trimmed;
}

function parseInlineList(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((part) => unquote(part));
}

/**
 * 解析 front matter。仅当文档以 `---` 开头且后续存在结束 `---` 时视为 front matter。
 */
export function splitFrontMatter(text: string): FrontMatterResult {
  const empty: FrontMatterResult = { present: false, entries: [], data: {}, body: text, end: 0, raw: '' };
  if (!text.startsWith('---')) return empty;
  const firstLineEnd = text.indexOf('\n');
  if (firstLineEnd < 0 || !DELIMITER.test(text.slice(0, firstLineEnd).trimEnd())) return empty;

  let cursor = firstLineEnd + 1;
  const rawLines: string[] = [];
  let end = -1;
  while (cursor <= text.length) {
    const nextBreak = text.indexOf('\n', cursor);
    const lineEnd = nextBreak < 0 ? text.length : nextBreak;
    const line = text.slice(cursor, lineEnd);
    if (DELIMITER.test(line.trimEnd())) {
      end = nextBreak < 0 ? text.length : nextBreak + 1;
      break;
    }
    rawLines.push(line);
    if (nextBreak < 0) break;
    cursor = nextBreak + 1;
  }
  if (end < 0) return empty;

  const entries: FrontMatterEntry[] = [];
  const data: Record<string, string | string[]> = {};
  let index = 0;
  while (index < rawLines.length) {
    const line = rawLines[index] ?? '';
    index += 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let rest = line.slice(separator + 1).trim();
    if (!key) continue;

    // 多行标量：`key: |` / `key: >`
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      const parts: string[] = [];
      while (index < rawLines.length) {
        const candidate = rawLines[index] ?? '';
        if (candidate.trim() && !/^\s/.test(candidate) && candidate.includes(':')) break;
        parts.push(candidate.replace(/^\s+/, ''));
        index += 1;
      }
      const joined = rest.startsWith('|') ? parts.join('\n').replace(/\s+$/, '') : parts.join(' ').trim();
      entries.push({ key, value: joined, list: false, line: index });
      data[key] = joined;
      continue;
    }

    // 值内注释（`#` 前有空白才算注释）
    const commentAt = rest.search(/\s#/);
    if (commentAt >= 0) rest = rest.slice(0, commentAt).trim();

    const list = parseInlineList(rest);
    if (list) {
      entries.push({ key, value: list.join(', '), list: true, line: index });
      data[key] = list;
      continue;
    }
    const value = unquote(rest);
    entries.push({ key, value, list: false, line: index });
    data[key] = value;
  }

  return {
    present: true,
    entries,
    data,
    body: text.slice(end),
    end,
    raw: rawLines.join('\n')
  };
}

/** 取字符串型元数据（数组取第一项）。 */
export function frontMatterString(result: FrontMatterResult, key: string): string | null {
  const value = result.data[key];
  if (value === undefined) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value || null;
}
