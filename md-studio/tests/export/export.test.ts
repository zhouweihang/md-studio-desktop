import { describe, expect, it } from 'vitest';
import { renderDocumentBody, renderDocumentHtml } from '../../src/renderer/export/render-html';

const DOC = [
  '# 导出测试',
  '',
  '**粗体** 与 `行内代码` 与 ~~删除~~。',
  '',
  '- [x] 已完成',
  '- [ ] 未完成',
  '',
  '| 列 A | 列 B |',
  '| --- | :--: |',
  '| 1 | 2 |',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  '行内公式 $a^2 + b^2 = c^2$。',
  '',
  '$$',
  '\\int_0^1 x dx',
  '$$'
].join('\n');

describe('renderDocumentBody', () => {
  it('渲染标题/强调/表格/任务列表', async () => {
    const html = await renderDocumentBody({ markdown: DOC, title: '导出测试', themeCss: '' });
    expect(html).toContain('<h1 id="导出测试">导出测试</h1>');
    expect(html).toContain('<strong>粗体</strong>');
    expect(html).toContain('<code>行内代码</code>');
    expect(html).toContain('<s>删除</s>');
    expect(html).toContain('<table>');
    expect(html).toContain('<li class="md-task-item"><input type="checkbox" checked disabled>');
    expect(html).toContain('<li class="md-task-item"><input type="checkbox" disabled>');
  });

  it('代码块经 highlight.js 高亮', async () => {
    const html = await renderDocumentBody({ markdown: DOC, title: 'x', themeCss: '' });
    expect(html).toContain('class="md-codeblock hljs"');
    expect(html).toContain('class="language-js"');
    expect(html).toContain('hljs-keyword');
  });

  it('公式渲染为 KaTeX 结构', async () => {
    const html = await renderDocumentBody({ markdown: DOC, title: 'x', themeCss: '' });
    expect(html).toContain('katex');
    expect(html).toContain('md-math-block');
    expect(html).not.toContain('md-math-error');
  });

  it('非法公式保留源码并标注错误', async () => {
    const html = await renderDocumentBody({ markdown: '公式：$\\frac{1}{$', title: 'x', themeCss: '' });
    expect(html).toContain('md-math-error');
  });

  it('图片保留相对路径且加懒加载', async () => {
    const html = await renderDocumentBody({ markdown: '![图](./assets/a.png)', title: 'x', themeCss: '' });
    expect(html).toContain('src="./assets/a.png"');
    expect(html).toContain('loading="lazy"');
  });

  it('resolveImageSrc 可重写图片地址', async () => {
    const html = await renderDocumentBody({
      markdown: '![图](./assets/a.png)',
      title: 'x',
      themeCss: '',
      resolveImageSrc: (src) => `file:///proj/${src.replace('./', '')}`
    });
    expect(html).toContain('file:///proj/assets/a.png');
  });
});

describe('renderDocumentHtml', () => {
  it('输出自包含文档：内联主题 CSS、标题转义、打印规则', async () => {
    const html = await renderDocumentHtml({
      markdown: '# T',
      title: '标题 <危险>',
      themeCss: ':root { --md-color-paper: #fff; }',
      katexCss: '.katex { font-size: 1em; }'
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>标题 &lt;危险&gt;</title>');
    expect(html).toContain('--md-color-paper: #fff;');
    expect(html).toContain('.katex { font-size: 1em; }');
    expect(html).toContain('@media print');
    expect(html).toContain('<article class="md-document">');
  });
});
