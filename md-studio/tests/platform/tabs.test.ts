// @vitest-environment happy-dom
/**
 * 多标签会话池（REQ-032）：标签隔离、切换、关闭、会话快照与恢复过滤。
 * 会话池不含 DOM，测试直接驱动；`EditorState` 用真实 CM 状态，验证撤销栈与游标隔离。
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { SessionPool } from '../../src/renderer/session';
import { sanitizeSettings } from '../../src/shared/settings';

function pool(): SessionPool {
  return new SessionPool((content, anchor = 0) =>
    EditorState.create({ doc: content, selection: { anchor: Math.min(anchor, content.length) } })
  );
}

describe('SessionPool 标签隔离', () => {
  it('每个标签持有独立状态与游标', () => {
    const sessions = pool();
    const first = sessions.add({ content: '第一个文档', name: '未命名' });
    const second = sessions.add({ content: '第二个文档\n第二行', path: 'C:/w/笔记.md' });

    expect(sessions.size).toBe(2);
    expect(sessions.active?.id).toBe(second.id);
    expect(second.name).toBe('笔记.md');
    expect(sessions.find(first.id)?.state.doc.toString()).toBe('第一个文档');
  });

  it('切换标签回存状态：撤销栈随 EditorState 保留', () => {
    const sessions = pool();
    const first = sessions.add({ content: 'a', name: '未命名' });
    const second = sessions.add({ content: 'b', name: '未命名' });

    // 模拟视图：载入 first 的状态后编辑并回存
    const edited = sessions.find(first.id)!.state.update({ changes: { from: 1, insert: 'bc' } }).state;
    sessions.storeState(first.id, edited, 120);
    sessions.activate(second.id);
    expect(sessions.find(first.id)?.state.doc.toString()).toBe('abc');
    expect(sessions.find(first.id)?.scrollTop).toBe(120);

    // 回切后状态仍然保留（未被激活标签的编辑覆盖）
    sessions.activate(first.id);
    expect(sessions.active?.state.doc.toString()).toBe('abc');
    expect(sessions.find(second.id)?.state.doc.toString()).toBe('b');
  });

  it('按路径去重：同一文件只开一个标签', () => {
    const sessions = pool();
    sessions.add({ content: 'x', path: 'C:/w/a.md' });
    expect(sessions.findByPath('C:/w/a.md')).not.toBeNull();
    expect(sessions.findByPath('C:/w/b.md')).toBeNull();
  });

  it('脏状态只影响目标标签', () => {
    const sessions = pool();
    const first = sessions.add({ content: 'x', name: '未命名' });
    const second = sessions.add({ content: 'y', name: '未命名' });
    sessions.setDirty(first.id, true);
    expect(sessions.find(first.id)?.dirty).toBe(true);
    expect(sessions.find(second.id)?.dirty).toBe(false);
    expect(sessions.metas().filter((meta) => meta.dirty).map((meta) => meta.id)).toEqual([first.id]);
  });

  it('相对切换循环（Ctrl+Tab / Ctrl+Shift+Tab）', () => {
    const sessions = pool();
    const a = sessions.add({ content: 'a', name: 'a' });
    const b = sessions.add({ content: 'b', name: 'b' });
    const c = sessions.add({ content: 'c', name: 'c' });
    expect(sessions.active?.id).toBe(c.id);
    sessions.activateRelative(1);
    expect(sessions.active?.id).toBe(a.id);
    sessions.activateRelative(-1);
    expect(sessions.active?.id).toBe(c.id);
    sessions.activateRelative(-1);
    expect(sessions.active?.id).toBe(b.id);
  });
});

describe('未保存标记（B5-7：显示名按语言实时计算）', () => {
  it('新建标签标记为未保存，绑定路径后清除', () => {
    const sessions = pool();
    const untitled = sessions.add({ content: 'x', name: '未命名' });
    expect(untitled.untitled).toBe(true);
    expect(sessions.metas()[0]?.untitled).toBe(true);

    sessions.setPath(untitled.id, 'C:/w/保存后.md');
    expect(untitled.untitled).toBe(false);
    expect(untitled.name).toBe('保存后.md');
    expect(sessions.metas()[0]?.untitled).toBe(false);
  });

  it('删除磁盘文件后回到未保存状态，并保留旧名作为兜底', () => {
    const sessions = pool();
    const tab = sessions.add({ content: 'x', path: 'C:/w/待删.md' });
    expect(tab.untitled).toBe(false);
    sessions.setPath(tab.id, null);
    expect(tab.untitled).toBe(true);
    expect(tab.path).toBeNull();
    expect(tab.name).toBe('待删.md');
  });

  it('已编辑的未保存标签不依赖存储名称：名称变化不影响显示逻辑', () => {
    const sessions = pool();
    const tab = sessions.add({ content: 'x', name: 'Untitled' });
    sessions.setDirty(tab.id, true);
    // 语言切换不再改写存储名；显示层用 tr('tabs.untitled') 覆盖
    expect(tab.untitled).toBe(true);
    expect(tab.dirty).toBe(true);
    expect(tab.name).toBe('Untitled');
  });
});

describe('SessionPool 关闭语义', () => {
  it('关闭活动标签后激活相邻标签', () => {
    const sessions = pool();
    const a = sessions.add({ content: 'a', name: 'a' });
    const b = sessions.add({ content: 'b', name: 'b' });
    const c = sessions.add({ content: 'c', name: 'c' });
    sessions.activate(b.id);
    const next = sessions.close(b.id);
    expect(next).toBe(c.id);
    expect(sessions.size).toBe(2);
    expect(sessions.metas().map((meta) => meta.id)).toEqual([a.id, c.id]);
  });

  it('关闭后台标签不影响活动标签', () => {
    const sessions = pool();
    const a = sessions.add({ content: 'a', name: 'a' });
    const b = sessions.add({ content: 'b', name: 'b' });
    expect(sessions.close(a.id)).toBe(b.id);
    expect(sessions.active?.id).toBe(b.id);
  });

  it('关掉最后一个标签后池为空（由上层补空标签）', () => {
    const sessions = pool();
    const only = sessions.add({ content: 'x', name: '未命名' });
    expect(sessions.close(only.id)).toBeNull();
    expect(sessions.size).toBe(0);
    expect(sessions.active).toBeNull();
  });

  it('关闭其他 / 关闭右侧', () => {
    const sessions = pool();
    const a = sessions.add({ content: 'a', name: 'a' });
    const b = sessions.add({ content: 'b', name: 'b' });
    const c = sessions.add({ content: 'c', name: 'c' });

    expect(sessions.closeRight(a.id).map((tab) => tab.id)).toEqual([b.id, c.id]);
    expect(sessions.size).toBe(1);
    expect(sessions.active?.id).toBe(a.id);

    sessions.add({ content: 'd', name: 'd' });
    sessions.add({ content: 'e', name: 'e' });
    sessions.closeOthers(a.id);
    expect(sessions.size).toBe(1);
    expect(sessions.active?.id).toBe(a.id);
  });
});

describe('切换性能（REQ-032 验收：10 个标签 <100 ms）', () => {
  it('10 个 200 行文档来回切换不超预算，内容不串扰', () => {
    const sessions = pool();
    for (let index = 0; index < 10; index++) {
      const body = Array.from({ length: 200 }, (_, line) => `第 ${index} 个标签的第 ${line} 行`).join('\n');
      sessions.add({ content: `# 标签 ${index}\n\n${body}`, path: `C:/w/tab-${index}.md` });
    }
    const host = document.createElement('div');
    document.body.append(host);
    const view = new EditorView({ parent: host, state: sessions.active!.state });

    const started = performance.now();
    for (let step = 0; step < 10; step++) {
      const current = sessions.active!;
      sessions.storeState(current.id, view.state, 0);
      const targetId = sessions.metas()[(step + 1) % 10]!.id;
      sessions.activate(targetId);
      view.setState(sessions.active!.state);
    }
    const elapsed = performance.now() - started;
    console.log(`[perf] 10 标签切换：${elapsed.toFixed(1)} ms`);

    expect(elapsed).toBeLessThan(100);
    // 每个标签仍是自己的文档（没有状态串扰）
    for (const meta of sessions.metas()) {
      const tab = sessions.find(meta.id)!;
      const index = Number(meta.path!.match(/tab-(\d+)\.md$/)![1]);
      expect(tab.state.doc.toString()).toContain(`第 ${index} 个标签的第 199 行`);
      expect(tab.state.doc.toString()).toContain(`# 标签 ${index}`);
    }
    view.destroy();
  });
});

describe('会话快照与启动恢复契约', () => {
  it('快照记录路径、名称与游标，只含路径项可恢复', () => {
    const sessions = pool();
    sessions.add({ content: 'aaa', path: 'C:/w/a.md', anchor: 2 });
    sessions.add({ content: '', name: '未命名' });
    const snapshot = sessions.snapshot();

    expect(snapshot.open).toHaveLength(2);
    expect(snapshot.open[0]).toMatchObject({ path: 'C:/w/a.md', name: 'a.md', anchor: 2 });
    expect(snapshot.open[1]?.path).toBeNull();
    expect(snapshot.active).toBe(1);
    expect(snapshot.open.filter((entry) => entry.path)).toHaveLength(1);
  });

  it('settings.tabs 走 sanitize：非法项被丢弃、上限 32', () => {
    const settings = sanitizeSettings({
      tabs: {
        open: [
          { path: 'C:/w/a.md', name: 'a.md', anchor: 4 },
          { path: '', name: '未命名', anchor: 0 },
          { path: 42, name: null, anchor: 'x' },
          ...Array.from({ length: 40 }, (_, index) => ({ path: `C:/w/${index}.md`, name: `${index}.md`, anchor: 0 }))
        ],
        active: 999
      }
    });
    expect(settings.tabs.open).toHaveLength(32);
    expect(settings.tabs.open[0]).toMatchObject({ path: 'C:/w/a.md', anchor: 4 });
    expect(settings.tabs.open.every((entry) => entry.path !== null)).toBe(true);
    expect(settings.tabs.active).toBeLessThanOrEqual(64);
  });

  it('会话快照经设置往返后仍可定位到原路径与游标', () => {
    const sessions = pool();
    sessions.add({ content: 'one', path: 'C:/w/one.md', anchor: 3 });
    sessions.add({ content: 'two', path: 'C:/w/two.md', anchor: 0 });
    const restored = sanitizeSettings({ tabs: sessions.snapshot() });
    expect(restored.tabs.open.map((entry) => entry.path)).toEqual(['C:/w/one.md', 'C:/w/two.md']);
    expect(restored.tabs.open[0]?.anchor).toBe(3);
  });
});
