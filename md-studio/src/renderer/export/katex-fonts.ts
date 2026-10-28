/**
 * KaTeX 字体内联（REQ-035 / B4-3 / B5-5）：把导出件用到的 woff2 字体内联为 base64，
 * 让公式在未安装 KaTeX 字体的机器上也能像素级还原。
 *
 * 两档范围：
 * - `common`：常用字重/字形（正体、粗体、斜体、数学、AMS、花体、尺寸 1–4、等宽），约 300–400 KB；
 * - `all`：全部 20 个 woff2（含 Fraktur、SansSerif 粗斜体、Script），体积约翻倍，自包含程度最高。
 *
 * 默认关闭，由 `settings.exportOptions.inlineMathFonts`（`off | common | all`）控制。
 */

import amsRegular from 'katex/dist/fonts/KaTeX_AMS-Regular.woff2?inline';
import caligraphicBold from 'katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?inline';
import caligraphicRegular from 'katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?inline';
import frakturBold from 'katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?inline';
import frakturRegular from 'katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?inline';
import mainBold from 'katex/dist/fonts/KaTeX_Main-Bold.woff2?inline';
import mainBoldItalic from 'katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?inline';
import mainItalic from 'katex/dist/fonts/KaTeX_Main-Italic.woff2?inline';
import mainRegular from 'katex/dist/fonts/KaTeX_Main-Regular.woff2?inline';
import mathBoldItalic from 'katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?inline';
import mathItalic from 'katex/dist/fonts/KaTeX_Math-Italic.woff2?inline';
import sansSerifBold from 'katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?inline';
import sansSerifItalic from 'katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?inline';
import sansSerifRegular from 'katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?inline';
import scriptRegular from 'katex/dist/fonts/KaTeX_Script-Regular.woff2?inline';
import size1 from 'katex/dist/fonts/KaTeX_Size1-Regular.woff2?inline';
import size2 from 'katex/dist/fonts/KaTeX_Size2-Regular.woff2?inline';
import size3 from 'katex/dist/fonts/KaTeX_Size3-Regular.woff2?inline';
import size4 from 'katex/dist/fonts/KaTeX_Size4-Regular.woff2?inline';
import typewriterRegular from 'katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?inline';

/** 内联范围：关闭 / 常用 / 全量。 */
export type InlineFontScope = 'off' | 'common' | 'all';

const FONT_DATA: Record<string, string> = {
  'KaTeX_AMS-Regular.woff2': amsRegular,
  'KaTeX_Caligraphic-Bold.woff2': caligraphicBold,
  'KaTeX_Caligraphic-Regular.woff2': caligraphicRegular,
  'KaTeX_Fraktur-Bold.woff2': frakturBold,
  'KaTeX_Fraktur-Regular.woff2': frakturRegular,
  'KaTeX_Main-Bold.woff2': mainBold,
  'KaTeX_Main-BoldItalic.woff2': mainBoldItalic,
  'KaTeX_Main-Italic.woff2': mainItalic,
  'KaTeX_Main-Regular.woff2': mainRegular,
  'KaTeX_Math-BoldItalic.woff2': mathBoldItalic,
  'KaTeX_Math-Italic.woff2': mathItalic,
  'KaTeX_SansSerif-Bold.woff2': sansSerifBold,
  'KaTeX_SansSerif-Italic.woff2': sansSerifItalic,
  'KaTeX_SansSerif-Regular.woff2': sansSerifRegular,
  'KaTeX_Script-Regular.woff2': scriptRegular,
  'KaTeX_Size1-Regular.woff2': size1,
  'KaTeX_Size2-Regular.woff2': size2,
  'KaTeX_Size3-Regular.woff2': size3,
  'KaTeX_Size4-Regular.woff2': size4,
  'KaTeX_Typewriter-Regular.woff2': typewriterRegular
};

/** `common` 档收录的字形；其余（Fraktur/SansSerif 粗斜体/Script）只在 `all` 档内联。 */
const COMMON_FONTS = new Set([
  'KaTeX_AMS-Regular.woff2',
  'KaTeX_Caligraphic-Bold.woff2',
  'KaTeX_Caligraphic-Regular.woff2',
  'KaTeX_Main-Bold.woff2',
  'KaTeX_Main-BoldItalic.woff2',
  'KaTeX_Main-Italic.woff2',
  'KaTeX_Main-Regular.woff2',
  'KaTeX_Math-BoldItalic.woff2',
  'KaTeX_Math-Italic.woff2',
  'KaTeX_SansSerif-Regular.woff2',
  'KaTeX_Size1-Regular.woff2',
  'KaTeX_Size2-Regular.woff2',
  'KaTeX_Size3-Regular.woff2',
  'KaTeX_Size4-Regular.woff2',
  'KaTeX_Typewriter-Regular.woff2'
]);

export interface InlineFontResult {
  css: string;
  /** 内联进去的 base64 字符数（≈ 体积增量） */
  inlinedChars: number;
  /** 实际替换的字体文件数 */
  replaced: number;
}

/** 把 CSS 里 `url(fonts/X.woff2)` 替换成 base64 data URI（未收录的字体保持原样）。 */
export function inlineKatexFonts(css: string, scope: InlineFontScope = 'common'): InlineFontResult {
  if (scope === 'off') return { css, inlinedChars: 0, replaced: 0 };
  let inlinedChars = 0;
  let replaced = 0;
  const allowed = scope === 'all' ? null : COMMON_FONTS;
  const result = css.replace(/url\((['"]?)fonts\/([^)'"]+)\1\)/g, (match, _quote: string, file: string) => {
    if (allowed && !allowed.has(file)) return match;
    const data = FONT_DATA[file];
    if (!data) return match;
    inlinedChars += data.length;
    replaced += 1;
    return `url("${data}")`;
  });
  return { css: result, inlinedChars, replaced };
}

/** 可内联的字体文件名（测试与诊断用；`all` 档即全部收录项）。 */
export function inlinableFonts(scope: InlineFontScope = 'all'): string[] {
  if (scope === 'off') return [];
  const names = Object.keys(FONT_DATA);
  return scope === 'all' ? names : names.filter((name) => COMMON_FONTS.has(name));
}
