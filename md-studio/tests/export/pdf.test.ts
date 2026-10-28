import { describe, expect, it } from 'vitest';
import { buildPdfPrintOptions, DEFAULT_PDF_MARGINS, normalizeMargins, PDF_PAGE_FOOTER } from '../../src/shared/pdf-options';

describe('buildPdfPrintOptions', () => {
  it('默认 A4、打印背景、页码页脚', () => {
    const options = buildPdfPrintOptions();
    expect(options.pageSize).toBe('A4');
    expect(options.printBackground).toBe(true);
    expect(options.displayHeaderFooter).toBe(true);
    expect(options.footerTemplate).toBe(PDF_PAGE_FOOTER);
    expect(options.footerTemplate).toContain('class="pageNumber"');
    expect(options.footerTemplate).toContain('class="totalPages"');
    expect(options.margins).toEqual(DEFAULT_PDF_MARGINS);
  });

  it('自定义页边距生效', () => {
    const options = buildPdfPrintOptions({ top: 1, bottom: 1.2, left: 0.5, right: 0.5 });
    expect(options.margins).toEqual({ top: 1, bottom: 1.2, left: 0.5, right: 0.5 });
  });

  it('越界与非法值被夹取到安全区间', () => {
    const options = buildPdfPrintOptions({ top: 99, bottom: -3, left: Number.NaN, right: 0.5 });
    expect(options.margins.top).toBe(2);
    expect(options.margins.bottom).toBe(0.2);
    expect(options.margins.left).toBe(DEFAULT_PDF_MARGINS.left);
    expect(options.margins.right).toBe(0.5);
  });

  it('可关闭页码页脚', () => {
    const options = buildPdfPrintOptions(undefined, false);
    expect(options.displayHeaderFooter).toBe(false);
    expect(options.footerTemplate).toBe('<div></div>');
  });

  it('normalizeMargins 缺省回退默认值', () => {
    expect(normalizeMargins({})).toEqual(DEFAULT_PDF_MARGINS);
  });
});
