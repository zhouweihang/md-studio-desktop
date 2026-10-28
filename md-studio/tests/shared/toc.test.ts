import { describe, expect, it } from 'vitest';
import { extractOutline } from '../../src/shared/outline';
import {
  TOC_MARKER,
  assignHeadingIds,
  buildTocHtml,
  buildTocMarkdown,
  buildTocTree,
  replaceTocPlaceholder,
  slugifyHeading
} from '../../src/shared/toc';

const DOC = ['# 一级标题', '', '## 二级 A', '', '### 三级', '', '## 二级 B', '', '## 二级 A'].join('\n');

describe('slugifyHeading', () => {
  it('小写、空格转连字符、去标点', () => {
    expect(slugifyHeading('Hello World!')).toBe('hello-world');
    expect(slugifyHeading('A/B (test)')).toBe('ab-test');
  });

  it('保留中文并处理空白与空标题', () => {
    expect(slugifyHeading('中文 标题')).toBe('中文-标题');
    expect(slugifyHeading('!!!')).toBe('section');
  });
});

describe('assignHeadingIds', () => {
  it('重复标题追加序号', () => {
    const ids = assignHeadingIds([
      { level: 1, text: 'A' },
      { level: 2, text: 'A' },
      { level: 2, text: 'A' }
    ]);
    expect(ids.map((item) => item.id)).toEqual(['a', 'a-2', 'a-3']);
  });
});

describe('buildTocMarkdown', () => {
  it('按层级缩进并生成链接', () => {
    const outline = extractOutline(DOC);
    const toc = buildTocMarkdown(outline);
    expect(toc).toContain('- [一级标题](#一级标题)');
    expect(toc).toContain('  - [二级 A](#二级-a)');
    expect(toc).toContain('    - [三级](#三级)');
    expect(toc).toContain('  - [二级 A](#二级-a-2)');
  });

  it('minLevel 过滤与无链接模式', () => {
    const outline = extractOutline(DOC);
    const toc = buildTocMarkdown(outline, { minLevel: 3, linked: false });
    expect(toc.trim()).toBe('- 三级');
  });

  it('无标题时返回空串', () => {
    expect(buildTocMarkdown(extractOutline('只有正文'))).toBe('');
  });
});

describe('buildTocHtml', () => {
  it('生成嵌套 ul 与锚点链接', () => {
    const html = buildTocHtml(extractOutline(DOC));
    expect(html.startsWith('<nav class="md-toc">')).toBe(true);
    expect(html).toContain('<a href="#一级标题">一级标题</a>');
    expect(html).toContain('<ul>');
    // 二级 A 下应嵌套三级
    expect(html).toMatch(/<a href="#二级-a">二级 A<\/a><ul><li><a href="#三级">/);
    expect(buildTocHtml([])).toBe('');
  });

  it('buildTocTree 在同一层级的重复标题下不丢项', () => {
    const tree = buildTocTree(extractOutline(DOC));
    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0]?.children).toHaveLength(3);
  });
});

describe('replaceTocPlaceholder', () => {
  it('替换独立 [TOC] 行为目录', () => {
    const doc = `${TOC_MARKER}\n\n# 标题\n`;
    const replaced = replaceTocPlaceholder(doc, extractOutline(doc));
    expect(replaced).toContain('- [标题](#标题)');
    expect(replaced.includes(TOC_MARKER)).toBe(false);
  });

  it('无占位符或占位符在代码块内时不改变文本', () => {
    expect(replaceTocPlaceholder('# 标题', extractOutline('# 标题'))).toBe('# 标题');
  });
});
