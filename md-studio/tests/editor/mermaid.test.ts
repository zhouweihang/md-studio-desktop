import { describe, expect, it } from 'vitest';
import { findFences } from '../../src/shared/markdown-scan';
import { renderDocumentBody } from '../../src/renderer/export/render-html';

const MERMAID_DOC = ['# 图表示例', '', '```mermaid', 'graph TD', '  A[开始] --> B[结束]', '```', '', '正文'].join('\n');

describe('mermaid 围栏识别', () => {
  it('精确匹配 info=mermaid（大小写无关的常见写法）', () => {
    expect(findFences(MERMAID_DOC, 'mermaid')).toHaveLength(1);
    expect(findFences(MERMAID_DOC, 'Mermaid')).toHaveLength(0);
  });

  it('普通代码块不会被当作图表', () => {
    const doc = '```js\nconsole.log(1);\n```';
    expect(findFences(doc, 'mermaid')).toHaveLength(0);
  });

  it('多张图表按顺序返回', () => {
    const doc = '```mermaid\ngraph TD\n  A-->B\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```';
    const fences = findFences(doc, 'mermaid');
    expect(fences).toHaveLength(2);
    expect(fences[1]?.code.trim().startsWith('sequenceDiagram')).toBe(true);
  });
});

describe('导出兜底策略（渲染失败保留源码）', () => {
  it('mermaidToSvg 返回 null 时保留源码块并标注失败', async () => {
    const html = await renderDocumentBody({
      markdown: MERMAID_DOC,
      title: '图表',
      themeCss: '',
      mermaidToSvg: async () => null
    });
    expect(html).toContain('md-mermaid-error');
    expect(html).toContain('graph TD');
    expect(html).toContain('&gt;'); // 源码被转义保留（A --&gt; B）
  });

  it('mermaidToSvg 成功时输出 SVG 容器', async () => {
    const html = await renderDocumentBody({
      markdown: MERMAID_DOC,
      title: '图表',
      themeCss: '',
      mermaidToSvg: async () => '<svg data-test="ok"></svg>'
    });
    expect(html).toContain('<div class="md-mermaid"><svg data-test="ok"></svg></div>');
    expect(html).not.toContain('md-mermaid-error');
  });

  it('无 mermaidToSvg 回调时同样保留源码（静态渲染路径）', async () => {
    const html = await renderDocumentBody({ markdown: MERMAID_DOC, title: 'x', themeCss: '' });
    expect(html).toContain('md-mermaid-error');
  });
});
