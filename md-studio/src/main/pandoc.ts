/**
 * Pandoc 互操作（REQ-031）：探测可执行文件、导出（docx/LaTeX/ePub/RTF/ODT/HTML）、
 * 导入（docx/html/odt/rtf/epub/tex → Markdown）。
 *
 * 约定：
 * - 未安装时**不产生任何半成品文件**（临时目录清理后返回错误）；
 * - 目标路径缺省时弹保存对话框；
 * - 失败时把 stderr 摘要回给渲染层，由界面展示。
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import type { BrowserWindow as Window } from 'electron';
import type { ExportResult, PandocFormat, PandocImportResult, PandocStatusResult } from '../shared/channels';
import {
  buildPandocExportArgs,
  buildPandocImportArgs,
  buildPandocVersionArgs,
  pandocExtensionFor,
  pandocReaderForExtension
} from '../shared/pandoc-args';
import { showOpenDialog, showSaveDialog } from './fs-service';
import { logMain } from './logger';
import { settingsStore } from './settings';

const run = promisify(execFile);
const CACHE_MS = 30_000;

let cache: { at: number; status: PandocStatusResult } | null = null;

/** 让下一次探测重新执行（设置变更或导出失败后调用）。 */
export function invalidatePandocCache(): void {
  cache = null;
}

function executable(): string {
  const configured = settingsStore.get().pandoc.path;
  return configured && configured.trim().length > 0 ? configured.trim() : 'pandoc';
}

export async function detectPandoc(force = false): Promise<PandocStatusResult> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.status;
  const bin = executable();
  let status: PandocStatusResult = { available: false, version: null, path: null };
  try {
    const { stdout } = await run(bin, buildPandocVersionArgs(), { windowsHide: true, timeout: 8000 });
    const first = String(stdout).split(/\r?\n/)[0] ?? '';
    const matched = /pandoc(?:\.exe)?\s+v?([\d.]+)/i.exec(first)?.[1];
    const version = matched ?? (first.trim() ? first.trim() : null);
    status = { available: true, version, path: bin };
  } catch (error) {
    status = { available: false, version: null, path: null, error: (error as Error).message };
  }
  cache = { at: Date.now(), status };
  return status;
}

async function pickExportTarget(parent: Window | null, docName: string, extension: string): Promise<string | null> {
  const result = await showSaveDialog(parent, {
    title: 'Pandoc 导出',
    defaultPath: `${docName}.${extension}`,
    filters: [
      { name: extension.toUpperCase(), extensions: [extension] },
      { name: '全部文件', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

async function ensurePandoc<T>(fallback: T): Promise<PandocStatusResult | T> {
  const status = await detectPandoc();
  if (!status.available) return fallback;
  return status;
}

export interface PandocExportInput {
  markdown: string;
  docName: string;
  format: PandocFormat;
  targetPath?: string;
  docDir: string | null;
  title?: string;
}

export async function pandocExport(
  parent: Window | null,
  request: PandocExportInput,
  userDataDir: string
): Promise<ExportResult> {
  const status = await detectPandoc();
  if (!status.available) {
    return {
      canceled: false,
      error: '未检测到 Pandoc：请在设置里指定 pandoc 路径，或安装后重试（winget install JohnMacFarlane.Pandoc）'
    };
  }

  const extension = pandocExtensionFor(request.format);
  let target = request.targetPath;
  if (!target) {
    target = (await pickExportTarget(parent, request.docName, extension)) ?? undefined;
    if (!target) return { canceled: true };
  }

  const tempDir = join(userDataDir, 'pandoc-tmp');
  const inputPath = join(tempDir, `input-${Date.now()}.md`);
  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(inputPath, request.markdown, 'utf8');
    const args = buildPandocExportArgs({
      format: request.format,
      inputPath,
      outputPath: target,
      docDir: request.docDir,
      title: request.title
    });
    await run(executable(), args, { windowsHide: true, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    logMain('info', `Pandoc 导出成功：${target}`);
    return { canceled: false, path: target };
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr ?? (error as Error).message;
    logMain('error', `Pandoc 导出失败：${detail}`);
    await rm(target, { force: true }).catch(() => undefined);
    return { canceled: false, error: `Pandoc 导出失败：${summarize(detail)}` };
  } finally {
    await rm(inputPath, { force: true }).catch(() => undefined);
  }
}

export async function pandocImport(
  parent: Window | null,
  request: { path?: string },
  userDataDir: string
): Promise<PandocImportResult> {
  const status = await detectPandoc();
  if (!status.available) {
    return {
      ok: false,
      error: '未检测到 Pandoc：请在设置里指定 pandoc 路径，或安装后重试（winget install JohnMacFarlane.Pandoc）'
    };
  }

  let source = request.path;
  if (!source) {
    const picked = await showOpenDialog(parent, {
      title: '导入 Word / HTML / ODT / RTF',
      properties: ['openFile'],
      filters: [
        { name: '文档', extensions: ['docx', 'html', 'htm', 'odt', 'rtf', 'epub', 'tex', 'md'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true, error: '已取消' };
    source = picked.filePaths[0];
  }

  const reader = pandocReaderForExtension(extname(source ?? ''));
  if (!reader) return { ok: false, error: `不支持的导入格式：${extname(source ?? '')}` };

  const tempDir = join(userDataDir, 'pandoc-tmp');
  const outputPath = join(tempDir, `import-${Date.now()}.md`);
  try {
    await mkdir(tempDir, { recursive: true });
    const args = buildPandocImportArgs(source, reader);
    const { stdout } = await run(executable(), args, { windowsHide: true, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    const markdown = String(stdout);
    if (!markdown.trim()) return { ok: false, error: 'Pandoc 没有输出内容（源文件可能是空的）' };
    await writeFile(outputPath, markdown, 'utf8');
    const base = source.split(/[\\/]/).pop() ?? 'imported';
    const name = `${base.replace(/\.[^.]+$/, '')}.md`;
    logMain('info', `Pandoc 导入成功：${source} → ${outputPath}`);
    return { ok: true, markdown, name, path: source.replace(/\.[^.]+$/, '.md') };
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr ?? (error as Error).message;
    logMain('error', `Pandoc 导入失败：${detail}`);
    return { ok: false, error: `Pandoc 导入失败：${summarize(detail)}` };
  } finally {
    await rm(outputPath, { force: true }).catch(() => undefined);
  }
}

function summarize(text: string, limit = 400): string {
  const trimmed = text.trim().replace(/\s+\n/g, '\n');
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

export async function readImportedFile(path: string): Promise<string> {
  return readFile(path, 'utf8');
}
