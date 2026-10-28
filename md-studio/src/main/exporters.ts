import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, type BrowserWindow as Window } from 'electron';
import type { ExportImageResult, ExportResult, PrintResult } from '../shared/channels';
import type { ExportHtmlRequest, ExportPdfRequest } from '../shared/ipc';
import { buildPdfPrintOptions } from '../shared/pdf-options';
import { showSaveDialog } from './fs-service';
import { logMain } from './logger';

async function pickTarget(parent: Window | null, suggestedName: string, extension: string, title: string): Promise<string | null> {
  const result = await showSaveDialog(parent, {
    title,
    defaultPath: suggestedName,
    filters: [
      { name: extension.toUpperCase(), extensions: [extension] },
      { name: '全部文件', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

export async function exportHtml(parent: Window | null, request: ExportHtmlRequest): Promise<ExportResult> {
  try {
    let target = request.targetPath;
    if (!target) {
      target = (await pickTarget(parent, request.suggestedName, 'html', '导出 HTML')) ?? undefined;
      if (!target) return { canceled: true };
    }
    await mkdir(join(target, '..'), { recursive: true }).catch(() => undefined);
    await writeFile(target, request.html, 'utf8');
    logMain('info', `导出 HTML：${target}`);
    return { canceled: false, path: target };
  } catch (error) {
    return { canceled: false, error: `导出 HTML 失败：${(error as Error).message}` };
  }
}

/** 导出页渲染页（隐藏窗口 + 字体就绪）：PDF / 打印 / 图片共用。 */
async function withRenderPage<T>(
  html: string,
  userDataDir: string,
  run: (win: Window) => Promise<T>
): Promise<T> {
  let win: Window | null = null;
  const tempDir = join(userDataDir, 'export-tmp');
  const pagePath = join(tempDir, `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(pagePath, html, 'utf8');
    win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: false
      }
    });
    await win.loadFile(pagePath);
    // 等字体（含中文字体）就绪，避免导出首屏缺字
    await win.webContents
      .executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true')
      .catch(() => undefined);
    return await run(win);
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    await rm(pagePath, { force: true }).catch(() => undefined);
  }
}

export async function exportText(parent: Window | null, request: { content: string; suggestedName: string; targetPath?: string }): Promise<ExportResult> {
  try {
    let target = request.targetPath;
    if (!target) {
      target = (await pickTarget(parent, request.suggestedName, 'txt', '导出纯文本')) ?? undefined;
      if (!target) return { canceled: true };
    }
    await mkdir(join(target, '..'), { recursive: true }).catch(() => undefined);
    await writeFile(target, request.content, 'utf8');
    logMain('info', `导出纯文本：${target}`);
    return { canceled: false, path: target };
  } catch (error) {
    return { canceled: false, error: `导出纯文本失败：${(error as Error).message}` };
  }
}

/** 单张图片的最大像素高度（Chromium capturePage 安全上限）。 */
export const IMAGE_PAGE_MAX_HEIGHT = 8000;

/**
 * 整页导出为 PNG / JPEG（REQ-027）：隐藏窗口按内容高度调整后 capturePage；
 * 超长文档分页为多张，结果里标记 truncated。
 */
export async function exportImage(
  parent: Window | null,
  request: { html: string; suggestedName: string; format: 'png' | 'jpeg'; width?: number; targetPath?: string },
  userDataDir: string
): Promise<ExportImageResult> {
  try {
    let target = request.targetPath;
    if (!target) {
      target = (await pickTarget(parent, request.suggestedName, request.format === 'png' ? 'png' : 'jpg', '导出图片')) ?? undefined;
      if (!target) return { ok: false, canceled: true, error: '已取消' };
    }
    const width = Math.min(2400, Math.max(480, request.width ?? 900));
    const paths: string[] = [];
    let truncated = false;

    await withRenderPage(request.html, userDataDir, async (win) => {
      win.setContentSize(width, 1200);
      const height = Number(
        await win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)').catch(() => 1200)
      );
      const pageCount = Math.max(1, Math.ceil(height / IMAGE_PAGE_MAX_HEIGHT));
      for (let page = 0; page < pageCount; page++) {
        const sliceHeight = Math.min(IMAGE_PAGE_MAX_HEIGHT, height - page * IMAGE_PAGE_MAX_HEIGHT);
        win.setContentSize(width, Math.max(200, sliceHeight));
        await win.webContents.executeJavaScript(`window.scrollTo(0, ${page * IMAGE_PAGE_MAX_HEIGHT})`).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 120));
        const image = await win.webContents.capturePage();
        const buffer = request.format === 'png' ? image.toPNG() : image.toJPEG(88);
        const pagePath = pageCount === 1 ? target : target.replace(/(\.[a-z0-9]+)$/i, `-p${page + 1}$1`);
        await writeFile(pagePath, buffer);
        paths.push(pagePath);
      }
      truncated = pageCount > 1;
      if (pageCount > 20) truncated = true;
    });

    logMain('info', `导出图片：${paths.join(', ')}`);
    return { ok: true, paths, truncated };
  } catch (error) {
    logMain('error', `导出图片失败：${(error as Error).message}`);
    return { ok: false, error: `导出图片失败：${(error as Error).message}` };
  }
}

/** 打印（REQ-022）：可见预览窗口 → 系统打印对话框；取消不写任何文件。 */
export async function printDocument(
  parent: Window | null,
  request: { html: string; suggestedName: string },
  userDataDir: string
): Promise<PrintResult> {
  let win: Window | null = null;
  const tempDir = join(userDataDir, 'export-tmp');
  const pagePath = join(tempDir, `print-${Date.now()}.html`);
  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(pagePath, request.html, 'utf8');
    win = new BrowserWindow({
      show: true,
      width: 940,
      height: 1000,
      parent: parent ?? undefined,
      title: `打印预览 — ${request.suggestedName}`,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    await win.loadFile(pagePath);
    await win.webContents
      .executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true')
      .catch(() => undefined);

    const canceled = await new Promise<boolean>((resolve) => {
      win!.webContents.print({ silent: false, printBackground: true }, (_ok, reason) => {
        resolve(reason === 'cancelled' || reason === 'Print job canceled');
      });
    });
    return { ok: true, canceled };
  } catch (error) {
    logMain('error', `打印失败：${(error as Error).message}`);
    return { ok: false, error: `打印失败：${(error as Error).message}` };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    await rm(pagePath, { force: true }).catch(() => undefined);
  }
}

export async function exportPdf(
  parent: Window | null,
  request: ExportPdfRequest,
  userDataDir: string
): Promise<ExportResult> {
  let target: string | undefined;
  try {
    const pdf = await withRenderPage(request.html, userDataDir, async (win) => {
      return win.webContents.printToPDF(buildPdfPrintOptions(request.margins, request.footer !== false));
    });
    target = request.targetPath;
    if (!target) {
      target = (await pickTarget(parent, request.suggestedName, 'pdf', '导出 PDF')) ?? undefined;
      if (!target) return { canceled: true };
    }
    await writeFile(target, pdf);
    logMain('info', `导出 PDF：${target}（${pdf.length} 字节）`);
    return { canceled: false, path: target };
  } catch (error) {
    logMain('error', `导出 PDF 失败：${(error as Error).message}`);
    return { canceled: false, error: `导出 PDF 失败：${(error as Error).message}` };
  }
}
