export interface TextStats {
  chars: number;
  words: number;
  lines: number;
  minutes: number;
}

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;
const LATIN_WORD_PATTERN = /[A-Za-z0-9_'-]+/g;

/** 中文按字计、拉丁按词计；阅读时间按 300 字/分钟估算（非空至少 1 分钟）。 */
export function countText(text: string): TextStats {
  const chars = [...text].length;
  const cjkCount = (text.match(CJK_PATTERN) ?? []).length;
  const latinCount = (text.replace(CJK_PATTERN, ' ').match(LATIN_WORD_PATTERN) ?? []).length;
  const words = cjkCount + latinCount;
  const lines = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
  const minutes = words === 0 ? 0 : Math.max(1, Math.round(words / 300));
  return { chars, words, lines, minutes };
}
