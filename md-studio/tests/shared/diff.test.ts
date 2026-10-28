import { describe, expect, it } from 'vitest';
import { diffLines, diffSummary, similarity } from '../../src/shared/diff';

describe('diffLines', () => {
  it('识别新增行', () => {
    const lines = diffLines('a\nb\n', 'a\nb\nc\n');
    expect(diffSummary(lines)).toEqual({ added: 1, removed: 0 });
    const added = lines.find((line) => line.kind === 'added');
    expect(added?.text).toBe('c');
    expect(added?.toLine).toBe(3);
    expect(added?.fromLine).toBeNull();
  });

  it('识别删除行', () => {
    const lines = diffLines('a\nb\nc\n', 'a\nc\n');
    expect(diffSummary(lines)).toEqual({ added: 0, removed: 1 });
    expect(lines.find((line) => line.kind === 'removed')?.text).toBe('b');
  });

  it('修改行表现为删 + 增，相同行为 same', () => {
    const lines = diffLines('# 标题\n一\n二', '# 标题\n一\n三');
    expect(summaryKinds(lines)).toEqual(['same', 'same', 'removed', 'added']);
    expect(lines[3]?.text).toBe('三');
  });

  it('完全相同时全部为 same', () => {
    const lines = diffLines('a\nb', 'a\nb');
    expect(lines.every((line) => line.kind === 'same')).toBe(true);
    expect(similarity('a\nb', 'a\nb')).toBe(1);
  });

  it('空文档对比', () => {
    expect(diffLines('', '')[0]).toMatchObject({ kind: 'same', text: '' });
    const added = diffLines('', 'x');
    expect(diffSummary(added)).toEqual({ added: 1, removed: 1 });
  });

  it('超大改动退化为整体标记（不卡死）', () => {
    const before = Array.from({ length: 3000 }, (_, index) => `old-${index}`).join('\n');
    const after = Array.from({ length: 3000 }, (_, index) => `new-${index}`).join('\n');
    const started = Date.now();
    const lines = diffLines(before, after);
    const summary = diffSummary(lines);
    expect(summary.added).toBeGreaterThan(2000);
    expect(summary.removed).toBeGreaterThan(2000);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('相似度在 0~1 之间', () => {
    const value = similarity('a\nb\nc', 'a\nx\nc');
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });
});

function summaryKinds(lines: ReturnType<typeof diffLines>): string[] {
  return lines.map((line) => line.kind);
}
