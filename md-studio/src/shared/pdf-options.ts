/**
 * PDF 打印选项（REQ-014）：页边距与页码页脚。
 * 纯函数，主进程 printToPDF 与单测共用。
 */

export interface PdfMargins {
  /** 单位：英寸（Electron printToPDF 约定） */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const DEFAULT_PDF_MARGINS: PdfMargins = { top: 0.6, bottom: 0.75, left: 0.75, right: 0.75 };

export const PDF_PAGE_FOOTER =
  '<div style="font-size:9px;width:100%;text-align:center;color:#999;font-family:sans-serif">' +
  '<span class="pageNumber"></span> / <span class="totalPages"></span></div>';

export interface PdfPrintOptions {
  printBackground: boolean;
  pageSize: 'A4';
  margins: PdfMargins;
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
}

const MARGIN_MIN = 0.2;
const MARGIN_MAX = 2;

function clampMargin(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MARGIN_MAX, Math.max(MARGIN_MIN, value));
}

export function normalizeMargins(margins?: Partial<PdfMargins>): PdfMargins {
  return {
    top: clampMargin(margins?.top, DEFAULT_PDF_MARGINS.top),
    bottom: clampMargin(margins?.bottom, DEFAULT_PDF_MARGINS.bottom),
    left: clampMargin(margins?.left, DEFAULT_PDF_MARGINS.left),
    right: clampMargin(margins?.right, DEFAULT_PDF_MARGINS.right)
  };
}

/** 组装 printToPDF 参数：A4、打印背景、页码页脚。 */
export function buildPdfPrintOptions(margins?: Partial<PdfMargins>, footer = true): PdfPrintOptions {
  return {
    printBackground: true,
    pageSize: 'A4',
    margins: normalizeMargins(margins),
    displayHeaderFooter: footer,
    headerTemplate: '<div></div>',
    footerTemplate: footer ? PDF_PAGE_FOOTER : '<div></div>'
  };
}
