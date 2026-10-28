// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderDocumentBody, renderDocumentHtml } from '../../src/renderer/export/render-html';

const DOC = [
  '---',
  'title: 元数据标题',
  'author: 张三',
  '---',
  '',
  '# 一级标题',
  '',
  '[TOC]',
  '',
  '高亮 ==重点== 与下标 ~x~ 与上标 ^2^ 与 :smile: 表情。',
  '',
  '脚注引用[^1]。',
  '',
  '[^1]: 脚注内容',
  '',
  'Apple',
  ': 一种水果',
  '',
  '<div class="custom">HTML <b>块</b><script>alert(1)</script></div>'
].join('\n');

describe('扩展语法导出渲染', () => {
  it('mark / sub / sup / emoji', async () => {
    const html = await renderDocumentBody({ markdown: DOC, title: 'x', themeCss: '' });
    expect(html).toContain('<mark>重点</mark>');
    expect(html).toContain('<sub>x</sub>');
    expect(html).toContain('<sup>2</sup>');
    expect(html).toContain('😄');
    expect(html).not.toContain(':smile:');
  });

  it('脚注引用与定义渲染为脚注区块', async () => {
    const html = await renderDocumentBody({ markdown: DOC, title: 'x', themeCss: '' });
    expect(html).toContain('footnote-ref');
    expect(html).toContain('脚注内容');
  });

  it('定义列表渲染为 dl/dt/dd', async () => {
    const html = await renderDocumentBody({ markdown: DOC, title: 'x', themeCss: '' });
    expect(html).toContain('<dl>');
    expect(html).toContain('<dt>Apple</dt>');
    expect(html).toContain('<dd>一种水果</dd>');
  });

  it('[TOC] 展开为目录，标题带锚点且与目录一致', async () => {
    const html = await renderDocumentBody({ markdown: DOC, title: 'x', themeCss: '' });
    expect(html).toContain('<h1 id="一级标题">');
    expect(html).toContain('<nav class="md-toc">');
    expect(html).toContain('<a href="#一级标题">一级标题</a>');
    expect(html).not.toContain('[TOC]');
  });

  it('HTML 块渲染但脚本被净化', async () => {
    const html = await renderDocumentBody({ markdown: DOC, title: 'x', themeCss: '' });
    expect(html).toContain('<div class="custom">');
    expect(html).toContain('<b>块</b>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('front matter 不入正文；元信息进入 head', async () => {
    const html = await renderDocumentHtml({ markdown: DOC, title: '', themeCss: '' });
    expect(html).not.toContain('title: 元数据标题');
    expect(html).toContain('<title>元数据标题</title>');
    expect(html).toContain('<meta name="author" content="张三" />');
  });

  it('可关闭净化（stripFrontMatter 同理）', async () => {
    const html = await renderDocumentBody({ markdown: 'a<script>x</script>', title: 'x', themeCss: '', sanitize: false });
    expect(html).toContain('<script>x</script>');
    const kept = await renderDocumentBody({
      markdown: '---\ntitle: t\n---\n正文',
      title: 'x',
      themeCss: '',
      stripFrontMatter: false
    });
    expect(kept).toContain('title: t');
  });
});
