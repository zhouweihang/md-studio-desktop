/**
 * Pandoc 参数构造（REQ-031）：纯函数，主进程执行、单测校验。
 * 输入输出路径由调用方给定，这里只负责「参数正确」。
 */

export type PandocFormatName = 'docx' | 'latex' | 'epub' | 'rtf' | 'odt' | 'html';

/** Markdown 读取器：GFM + 公式 + 脚注 + 高亮/上下标（与编辑器语法面一致）。 */
export const MARKDOWN_READER = 'gfm+tex_math_dollars+footnotes+mark+subscript+superscript+definition_lists';

export function pandocExtensionFor(format: PandocFormatName): string {
  switch (format) {
    case 'docx':
      return 'docx';
    case 'latex':
      return 'tex';
    case 'epub':
      return 'epub';
    case 'rtf':
      return 'rtf';
    case 'odt':
      return 'odt';
    default:
      return 'html';
  }
}

export function pandocWriterFor(format: PandocFormatName): string {
  return format === 'latex' ? 'latex' : format;
}

/** 导入用的读取器：按扩展名判定。 */
export function pandocReaderForExtension(extension: string): string | null {
  const ext = extension.replace(/^\./, '').toLowerCase();
  if (ext === 'docx') return 'docx';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'odt') return 'odt';
  if (ext === 'rtf') return 'rtf';
  if (ext === 'epub') return 'epub';
  if (ext === 'tex' || ext === 'latex') return 'latex';
  if (ext === 'md' || ext === 'markdown') return 'gfm';
  return null;
}

export interface PandocExportArgsOptions {
  format: PandocFormatName;
  inputPath: string;
  outputPath: string;
  /** 文档目录（图片相对路径的 resource-path） */
  docDir: string | null;
  title?: string;
}

/** 导出参数（`pandoc <args>`）。 */
export function buildPandocExportArgs(options: PandocExportArgsOptions): string[] {
  const args: string[] = [
    '--from',
    MARKDOWN_READER,
    '--to',
    pandocWriterFor(options.format),
    '--standalone',
    '--wrap=none'
  ];
  if (options.format === 'epub') args.push('--toc');
  if (options.title) args.push('--metadata', `title=${options.title}`);
  if (options.docDir) args.push(`--resource-path=${options.docDir}`);
  args.push('--output', options.outputPath, options.inputPath);
  return args;
}

/** 导入参数（读取文件 → stdout 输出 Markdown）。 */
export function buildPandocImportArgs(inputPath: string, reader: string): string[] {
  return ['--from', reader, '--to', 'gfm', '--wrap=none', inputPath];
}

export function buildPandocVersionArgs(): string[] {
  return ['--version'];
}
