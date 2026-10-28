import { describe, expect, it } from 'vitest';
import { shouldRebuild } from '../../src/renderer/editor/live-preview';

const base = { composing: false, docChanged: false, viewportChanged: false, selectionSet: false };

describe('IME 组合期间的装饰重建抑制（REQ-008）', () => {
  it('组合期间即使文档变化也不重建（候选框不被装饰打断）', () => {
    expect(shouldRebuild({ ...base, composing: true, docChanged: true })).toBe(false);
  });

  it('组合期间的选择/视口变化同样抑制', () => {
    expect(shouldRebuild({ ...base, composing: true, selectionSet: true })).toBe(false);
    expect(shouldRebuild({ ...base, composing: true, viewportChanged: true })).toBe(false);
  });

  it('组合结束后恢复重建', () => {
    expect(shouldRebuild({ ...base, composing: false, docChanged: true })).toBe(true);
  });

  it('无任何变化时不重建（避免无谓工作）', () => {
    expect(shouldRebuild(base)).toBe(false);
  });

  it('五组典型 IME 时序（组合中 docChanged + selectionSet）全部抑制', () => {
    const sequences = [
      { docChanged: true, selectionSet: true },
      { docChanged: false, selectionSet: true },
      { docChanged: true, selectionSet: false },
      { docChanged: false, selectionSet: false },
      { docChanged: true, selectionSet: true, viewportChanged: true }
    ];
    for (const step of sequences) {
      expect(shouldRebuild({ ...base, ...step, composing: true })).toBe(false);
    }
  });
});
