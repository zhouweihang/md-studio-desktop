import { describe, expect, it } from 'vitest';
import { markdownToPlainText, stripInlineMarkup } from '../../src/shared/plain-text';
import { htmlToMarkdown, htmlToPlain, htmlToPlainTextFallback } from '../../src/renderer/export/html-to-md';

describe('stripInlineMarkup', () => {
  it('去掉强调/代码/链接/图片/高亮标记', () => {
    expect(stripInlineMarkup('**粗** 与 *斜* 与 `代码`')).toBe('粗 与 斜 与 代码');
    expect(stripInlineMarkup('==高亮== 与 ~~删除~~ 与 ~下标~')).toBe('高亮 与 删除 与 ~下标~');
    expect(stripInlineMarkup('[文字](https://x.com) 与 ![图](./a.png)')).toBe('文字 与 图');
    expect(stripInlineMarkup('<u>下划线</u>')).toBe('下划线');
  });

  it('还原转义字符', () => {
    expect(stripInlineMarkup('\\*不是斜体\\*')).toBe('*不是斜体*');
  });
});

describe('markdownToPlainText', () => {
  it('去掉标题/列表/引用前缀', () => {
    const text = ['# 标题', '', '- 项目', '- [x] 完成', '', '> 引用', '', '1. 第一'].join('\n');
    expect(markdownToPlainText(text)).toBe(['标题', '', '项目', '完成', '', '引用', '', '第一'].join('\n'));
  });

  it('围栏代码保留内容去掉围栏', () => {
    const text = ['```js', 'const a = 1;', '```'].join('\n');
    expect(markdownToPlainText(text)).toBe('const a = 1;');
  });

  it('表格转为制表符分隔并跳过分隔行', () => {
    const text = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    expect(markdownToPlainText(text)).toBe(['A\tB', '1\t2'].join('\n'));
  });

  it('公式与 HTML 标签被去掉', () => {
    expect(markdownToPlainText('行内 $a^2$ 与 <b>粗</b>')).toBe('行内 $a^2$ 与 粗');
  });
});

describe('htmlToMarkdown', () => {
  it('标题/列表/链接/代码转换', () => {
    const html = '<h1>标题</h1><ul><li>一</li><li>二</li></ul><p><a href="https://x.com">链接</a> 与 <code>code</code></p>';
    const markdown = htmlToMarkdown(html);
    expect(markdown).toContain('# 标题');
    expect(markdown).toMatch(/-\s+一/);
    expect(markdown).toMatch(/-\s+二/);
    expect(markdown).toContain('[链接](https://x.com)');
    expect(markdown).toContain('`code`');
  });

  it('删除线转 ~~、br 转换行、script 被忽略', () => {
    const html = '<p>a<br>b<s>c</s></p><script>alert(1)</script>';
    const markdown = htmlToMarkdown(html);
    expect(markdown).toContain('~~c~~');
    expect(markdown).toContain('a\nb');
    expect(markdown).not.toContain('alert');
  });

  it('非 HTML 输入原样返回', () => {
    expect(htmlToMarkdown('纯文本')).toBe('纯文本');
    expect(htmlToMarkdown('')).toBe('');
  });
});

describe('htmlToPlain / htmlToPlainTextFallback', () => {
  it('保底实现去掉标签并解码实体', () => {
    expect(htmlToPlainTextFallback('<p>a&amp;b</p><p>c</p>')).toBe('a&b\nc');
  });

  it('htmlToPlain 走 turndown 后去标记', () => {
    const plain = htmlToPlain('<h2>标题</h2><p><strong>粗</strong>文字</p>');
    expect(plain).toContain('标题');
    expect(plain).toContain('粗文字');
    expect(plain).not.toContain('**');
  });
});
