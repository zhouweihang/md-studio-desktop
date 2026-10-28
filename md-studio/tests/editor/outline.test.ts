import { describe, expect, it } from 'vitest';
import { extractOutline, plainHeadingText } from '../../src/shared/outline';

describe('extractOutline', () => {
  it('抽取 ATX 标题层级与行号', () => {
    const items = extractOutline('# 一级\n\n## 二级\n\n### 三级');
    expect(items.map((item) => [item.level, item.text, item.line])).toEqual([
      [1, '一级', 1],
      [2, '二级', 3],
      [3, '三级', 5]
    ]);
  });

  it('跳过围栏代码块中的伪标题', () => {
    const items = extractOutline(['# 真标题', '```md', '# 代码里的标题', '```', '## 尾标题'].join('\n'));
    expect(items.map((item) => item.text)).toEqual(['真标题', '尾标题']);
  });

  it('识别 Setext 标题', () => {
    const items = extractOutline(['标题一', '======', '', '标题二', '------'].join('\n'));
    expect(items.map((item) => [item.level, item.text, item.line])).toEqual([
      [1, '标题一', 1],
      [2, '标题二', 4]
    ]);
  });

  it('清理标题里的行内标记', () => {
    const items = extractOutline('## **加粗**与`代码`和[链接](https://x.com)');
    expect(items[0]?.text).toBe('加粗与代码和链接');
    expect(plainHeadingText('~~删除~~ *斜*')).toBe('删除 斜');
  });

  it('闭合式 ATX 与空标题', () => {
    const items = extractOutline('## 标题 ##\n###\n');
    expect(items[0]?.text).toBe('标题');
    expect(items[1]?.text).toBe('(无标题)');
  });

  it('记录 pos 位置用于跳转', () => {
    const items = extractOutline('# A\n\n## B');
    expect(items[0]?.pos).toBe(0);
    expect(items[1]?.pos).toBe(5);
  });
});
