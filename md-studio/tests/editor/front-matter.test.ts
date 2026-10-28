import { describe, expect, it } from 'vitest';
import { frontMatterString, splitFrontMatter } from '../../src/shared/front-matter';
import { extractOutline } from '../../src/shared/outline';

describe('splitFrontMatter', () => {
  const doc = ['---', 'title: 示例文档', 'author: "张三"', 'tags: [md, 编辑器]', 'draft: true # 备注', '---', '', '# 正文'].join('\n');

  it('解析标量 / 引号 / 行内数组 / 注释', () => {
    const result = splitFrontMatter(doc);
    expect(result.present).toBe(true);
    expect(result.data.title).toBe('示例文档');
    expect(result.data.author).toBe('张三');
    expect(result.data.tags).toEqual(['md', '编辑器']);
    expect(result.data.draft).toBe('true');
    expect(result.entries.map((entry) => entry.key)).toEqual(['title', 'author', 'tags', 'draft']);
    expect(result.body.startsWith('\n# 正文')).toBe(true);
  });

  it('frontMatterString 支持数组取首项', () => {
    const result = splitFrontMatter(doc);
    expect(frontMatterString(result, 'tags')).toBe('md');
    expect(frontMatterString(result, 'missing')).toBeNull();
  });

  it('非 front matter 文档不被误判', () => {
    expect(splitFrontMatter('# 标题\n\n---\n').present).toBe(false);
    expect(splitFrontMatter('--- 没有结束分隔符\nfoo: 1').present).toBe(false);
    expect(splitFrontMatter('正文\n---\ntitle: x\n---').present).toBe(false);
  });

  it('块标量（| 与 >）拼接为字符串', () => {
    const block = ['---', 'description: |', '  第一行', '  第二行', 'note: >', '  折行一', '  折行二', '---', 'body'].join('\n');
    const result = splitFrontMatter(block);
    expect(result.data.description).toBe('第一行\n第二行');
    expect(result.data.note).toBe('折行一 折行二');
  });

  it('end 指向结束分隔行的换行之后，body 为此后的内容', () => {
    const result = splitFrontMatter(doc);
    expect(doc.slice(result.end)).toBe(result.body);
  });
});

describe('大纲与 front matter', () => {
  it('front matter 内的 `---` 与键值不产生标题', () => {
    const doc = ['---', 'title: 示例', 'subtitle: 副标题', '---', '', '# 真标题', '', '## 二级'].join('\n');
    const outline = extractOutline(doc);
    expect(outline.map((item) => item.text)).toEqual(['真标题', '二级']);
  });

  it('没有 front matter 时行为不变', () => {
    const outline = extractOutline('# A\n\ntext\n\nB\n---\n');
    expect(outline.map((item) => item.text)).toEqual(['A', 'B']);
  });
});
