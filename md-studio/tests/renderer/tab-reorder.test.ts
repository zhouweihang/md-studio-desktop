import { describe, expect, it } from 'vitest';
import { SessionPool } from '../../src/renderer/session';
import { resolveDropIndex } from '../../src/renderer/shell/tab-bar';
import { EditorState } from '@codemirror/state';

const pool = (count: number): SessionPool => {
  const session = new SessionPool((content) => EditorState.create({ doc: content }));
  for (let index = 0; index < count; index++) session.add({ name: `t${index}`, content: '' });
  return session;
};

const order = (session: SessionPool): number[] => session.all.map((tab) => tab.id);

describe('resolveDropIndex', () => {
  const metas = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

  it('向右跨过目标时扣除自身占位', () => {
    // 1 拖到 3 的右半区 → 最终索引 2（顺序 2,3,1,4）
    expect(resolveDropIndex(metas, 1, 3, true)).toBe(2);
    // 1 拖到 3 的左半区 → 最终索引 1（顺序 2,1,3,4）
    expect(resolveDropIndex(metas, 1, 3, false)).toBe(1);
  });

  it('向左拖动不需要补偿', () => {
    expect(resolveDropIndex(metas, 4, 1, false)).toBe(0);
    expect(resolveDropIndex(metas, 4, 1, true)).toBe(1);
  });

  it('原地放置返回自身索引，未知 id 返回 null', () => {
    expect(resolveDropIndex(metas, 2, 2, false)).toBe(1);
    expect(resolveDropIndex(metas, 2, 2, true)).toBe(1);
    expect(resolveDropIndex(metas, 99, 2, false)).toBeNull();
  });
});

describe('SessionPool.moveTo', () => {
  it('把标签移到目标索引，激活项与内容不变', () => {
    const session = pool(4);
    const [first, second, third, fourth] = session.all.map((tab) => tab.id);
    session.activate(second);
    expect(order(session)).toEqual([first, second, third, fourth]);

    expect(session.moveTo(first, 2)).toBe(true);
    expect(order(session)).toEqual([second, third, first, fourth]);
    expect(session.currentId).toBe(second);
    expect(session.find(first)?.name).toBe('t0');

    expect(session.moveTo(fourth, 0)).toBe(true);
    expect(order(session)).toEqual([fourth, second, third, first]);
  });

  it('越界索引收拢到两端，原地移动返回 false', () => {
    const session = pool(3);
    const [first, second, third] = session.all.map((tab) => tab.id);
    expect(session.moveTo(second, 99)).toBe(true);
    expect(order(session)).toEqual([first, third, second]);
    expect(session.moveTo(second, -5)).toBe(true);
    expect(order(session)).toEqual([second, first, third]);
    expect(session.moveTo(second, 0)).toBe(false);
    expect(session.moveTo(999, 0)).toBe(false);
  });

  it('顺序进入会话快照（settings.tabs.open 的持久化来源）', () => {
    const session = pool(3);
    const [first, second, third] = session.all.map((tab) => tab.id);
    session.moveTo(third, 0);
    const snapshot = session.snapshot();
    expect(snapshot.open.map((entry) => entry.name)).toEqual(['t2', 't0', 't1']);
    // 激活的是被拖动的标签，它随顺序移动 → 活动索引跟着变
    expect(snapshot.active).toBe(0);
    expect(order(session)).toEqual([third, first, second]);
  });
});
