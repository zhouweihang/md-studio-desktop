/**
 * 导出件 KaTeX 字体内联（REQ-035 / B5-5）：`common` 覆盖常用字形、`all` 覆盖全部 woff2，
 * 未内联的字形保持相对 URL；两档体积增量在这里实测并打印，供选择档位时参考。
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inlineKatexFonts, inlinableFonts } from '../../src/renderer/export/katex-fonts';
import { renderDocumentHtml } from '../../src/renderer/export/render-html';

// Vitest 默认不处理 CSS 导入（返回空串），这里直接读磁盘上的真实 CSS
const katexCss = readFileSync('node_modules/katex/dist/katex.min.css', 'utf8');
const THEME_CSS = ':root { --md-color-ink: #111; }';

function countDataUris(css: string): number {
  return (css.match(/data:font\/woff2;base64,/g) ?? []).length;
}

describe('inlineKatexFonts', () => {
  it('common 档收录常用字体，且能替换 CSS 里的 woff2 引用', () => {
    const fonts = inlinableFonts('common');
    expect(fonts).toContain('KaTeX_Main-Regular.woff2');
    expect(fonts).toContain('KaTeX_Math-Italic.woff2');
    expect(fonts).not.toContain('KaTeX_Fraktur-Regular.woff2');
    expect(fonts.length).toBeGreaterThanOrEqual(10);

    const result = inlineKatexFonts(katexCss, 'common');
    expect(result.replaced).toBeGreaterThan(0);
    expect(result.inlinedChars).toBeGreaterThan(0);
    expect(result.css).toContain('data:font/woff2;base64,');
    expect(countDataUris(result.css)).toBe(result.replaced);
    // 未收录的字形（Fraktur/Script）保留相对路径
    expect(result.css.includes('url(fonts/KaTeX_Fraktur-Regular.woff2)')).toBe(true);
  });

  it('all 档覆盖全部 20 个 woff2，CSS 里不再有相对字体路径', () => {
    const all = inlinableFonts('all');
    expect(all).toHaveLength(20);
    for (const name of ['KaTeX_Fraktur-Regular.woff2', 'KaTeX_Script-Regular.woff2', 'KaTeX_SansSerif-Italic.woff2']) {
      expect(all).toContain(name);
    }

    const common = inlineKatexFonts(katexCss, 'common');
    const full = inlineKatexFonts(katexCss, 'all');
    console.log(
      `[perf] 字体内联体积：common ≈ ${(common.inlinedChars / 1024).toFixed(0)} KB / ${common.replaced} 个，` +
        `all ≈ ${(full.inlinedChars / 1024).toFixed(0)} KB / ${full.replaced} 个`
    );
    expect(full.replaced).toBe(20);
    expect(full.inlinedChars).toBeGreaterThan(common.inlinedChars);
    // woff2 全部内联；KaTeX 的 woff/ttf 回退链保持相对路径（浏览器优先用 data URI 的 woff2）
    expect(/url\((['"]?)fonts\/[^)'"]+\.woff2\1\)/.test(full.css)).toBe(false);
  });

  it('off 档原样返回', () => {
    const result = inlineKatexFonts(katexCss, 'off');
    expect(result.css).toBe(katexCss);
    expect(result.replaced).toBe(0);
    expect(inlinableFonts('off')).toEqual([]);
  });

  it('幂等且不误伤非字体的 url()', () => {
    const once = inlineKatexFonts(katexCss, 'all');
    const twice = inlineKatexFonts(once.css, 'all');
    expect(twice.css).toBe(once.css);
    const plain = 'body { background: url(images/bg.png); }';
    expect(inlineKatexFonts(plain, 'all').css).toBe(plain);
  });
});

describe('renderDocumentHtml 字体内联选项', () => {
  const markdown = ['正文：$E = mc^2$', '', '$$', '\\int_0^1 x^2 dx', '$$'].join('\n');

  it('默认（off）不内联字体', async () => {
    const html = await renderDocumentHtml({ markdown, title: 't', themeCss: THEME_CSS, katexCss });
    expect(countDataUris(html)).toBe(0);
    expect(html).toContain('katex');
  });

  it('common / all 两档都内联，且 all 体积更大', async () => {
    const common = await renderDocumentHtml({
      markdown,
      title: 't',
      themeCss: THEME_CSS,
      katexCss,
      inlineMathFonts: 'common'
    });
    const full = await renderDocumentHtml({
      markdown,
      title: 't',
      themeCss: THEME_CSS,
      katexCss,
      inlineMathFonts: 'all'
    });
    expect(countDataUris(common)).toBeGreaterThan(0);
    expect(countDataUris(full)).toBeGreaterThan(countDataUris(common));
    expect(full.length).toBeGreaterThan(common.length);
    expect(full).toContain('katex');
  });
});
