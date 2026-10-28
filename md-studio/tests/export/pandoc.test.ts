import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_READER,
  buildPandocExportArgs,
  buildPandocImportArgs,
  buildPandocVersionArgs,
  pandocExtensionFor,
  pandocReaderForExtension,
  pandocWriterFor
} from '../../src/shared/pandoc-args';

describe('扩展名与读写器', () => {
  it('导出扩展名映射', () => {
    expect(pandocExtensionFor('docx')).toBe('docx');
    expect(pandocExtensionFor('latex')).toBe('tex');
    expect(pandocExtensionFor('epub')).toBe('epub');
    expect(pandocExtensionFor('rtf')).toBe('rtf');
    expect(pandocExtensionFor('odt')).toBe('odt');
  });

  it('writer 名称（latex → latex）', () => {
    expect(pandocWriterFor('latex')).toBe('latex');
    expect(pandocWriterFor('docx')).toBe('docx');
  });

  it('导入读取器按扩展名判定，未知返回 null', () => {
    expect(pandocReaderForExtension('.docx')).toBe('docx');
    expect(pandocReaderForExtension('HTML')).toBe('html');
    expect(pandocReaderForExtension('htm')).toBe('html');
    expect(pandocReaderForExtension('md')).toBe('gfm');
    expect(pandocReaderForExtension('xyz')).toBeNull();
  });
});

describe('buildPandocExportArgs', () => {
  it('包含读取器、writer、standalone 与输出路径', () => {
    const args = buildPandocExportArgs({
      format: 'docx',
      inputPath: 'C:/tmp/in.md',
      outputPath: 'C:/out/a.docx',
      docDir: null
    });
    expect(args).toContain('--from');
    expect(args[args.indexOf('--from') + 1]).toBe(MARKDOWN_READER);
    expect(args[args.indexOf('--to') + 1]).toBe('docx');
    expect(args).toContain('--standalone');
    expect(args.slice(-3)).toEqual(['--output', 'C:/out/a.docx', 'C:/tmp/in.md']);
  });

  it('标题与 resource-path 可选，ePub 追加目录', () => {
    const args = buildPandocExportArgs({
      format: 'epub',
      inputPath: 'in.md',
      outputPath: 'out.epub',
      docDir: 'C:/docs',
      title: '我的文档'
    });
    expect(args).toContain('--toc');
    expect(args).toContain('--metadata');
    expect(args).toContain('title=我的文档');
    expect(args).toContain('--resource-path=C:/docs');
  });

  it('latex 使用 latex writer', () => {
    const args = buildPandocExportArgs({ format: 'latex', inputPath: 'i.md', outputPath: 'o.tex', docDir: null });
    expect(args[args.indexOf('--to') + 1]).toBe('latex');
  });
});

describe('buildPandocImportArgs / version', () => {
  it('导入参数：指定 reader、输出 gfm', () => {
    const args = buildPandocImportArgs('C:/docs/a.docx', 'docx');
    expect(args).toEqual(['--from', 'docx', '--to', 'gfm', '--wrap=none', 'C:/docs/a.docx']);
  });

  it('版本探测参数', () => {
    expect(buildPandocVersionArgs()).toEqual(['--version']);
  });
});
