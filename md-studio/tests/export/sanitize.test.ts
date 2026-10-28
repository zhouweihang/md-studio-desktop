// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../../src/renderer/export/html-sanitize';

describe('sanitizeHtml', () => {
  it('保留常规标签与属性', () => {
    const result = sanitizeHtml('<p class="a">文字 <strong>粗</strong><br></p><table><tr><td colspan="2">x</td></tr></table>');
    expect(result.removedTags).toBe(0);
    expect(result.html).toContain('<p class="a">');
    expect(result.html).toContain('<strong>粗</strong>');
    expect(result.html).toContain('colspan="2"');
  });

  it('script / iframe / style / form 整体删除（连同内容）', () => {
    const result = sanitizeHtml('<div>ok<script>alert(1)</script><iframe src="x"></iframe><style>p{}</style></div>');
    expect(result.html).not.toContain('script');
    expect(result.html).not.toContain('alert(1)');
    expect(result.html).not.toContain('iframe');
    expect(result.html).not.toContain('<style>');
    expect(result.html).toContain('ok');
    expect(result.removedTags).toBeGreaterThanOrEqual(3);
  });

  it('事件属性与 javascript: 协议被移除', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)" onclick="alert(2)">点我</a><img src="javascript:x">');
    expect(result.html).not.toContain('javascript:');
    expect(result.html).not.toContain('onclick');
    expect(result.html).toContain('点我');
    expect(result.removedAttributes).toBeGreaterThanOrEqual(2);
  });

  it('未在白名单的标签脱壳保留文本', () => {
    const result = sanitizeHtml('<custom-tag attr="1">保留我</custom-tag>');
    expect(result.html).toBe('保留我');
    expect(result.removedTags).toBe(1);
  });

  it('安全协议与 data:image 保留', () => {
    const result = sanitizeHtml('<a href="https://example.com">x</a><img src="data:image/png;base64,AAA"><img src="./assets/a.png">');
    expect(result.html).toContain('https://example.com');
    expect(result.html).toContain('data:image/png;base64,AAA');
    expect(result.html).toContain('./assets/a.png');
  });

  it('SVG（Mermaid 产物）保留结构，样式表达式被移除', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10" fill="none" stroke="#333"/><text x="1" y="9">A</text></svg>';
    const result = sanitizeHtml(svg);
    expect(result.html).toContain('<path');
    expect(result.html).toContain('d="M0 0L10 10"');
    expect(result.html).toContain('<text');
    const styled = sanitizeHtml('<div style="width: expression(alert(1))">x</div>');
    expect(styled.html).not.toContain('expression(');
  });

  it('非复选框 input 被移除', () => {
    const result = sanitizeHtml('<input type="checkbox" checked disabled><input type="text" value="x">');
    expect(result.html).toContain('type="checkbox"');
    expect(result.html).not.toContain('type="text"');
  });
});
