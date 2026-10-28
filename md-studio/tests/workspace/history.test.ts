import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, HistoryStore } from '../../src/main/history';

let dir: string;
let store: HistoryStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mdstudio-history-'));
  store = new HistoryStore();
  store.init(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('HistoryStore', () => {
  it('首次快照写入，内容重复时跳过', async () => {
    const first = await store.snapshot('/docs/a.md', '内容一');
    expect(first).toEqual({ ok: true, created: true });
    const again = await store.snapshot('/docs/a.md', '内容一');
    expect(again).toEqual({ ok: true, created: false });
    const list = await store.list('/docs/a.md');
    expect(list).toHaveLength(1);
    expect(await store.read('/docs/a.md', list[0]!.id)).toBe('内容一');
  });

  it('内容变化后新增一份，并且按时间倒序', async () => {
    await store.snapshot('/docs/a.md', 'v1');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.snapshot('/docs/a.md', 'v2');
    const list = await store.list('/docs/a.md');
    expect(list).toHaveLength(2);
    expect(list[0]!.savedAt).toBeGreaterThanOrEqual(list[1]!.savedAt);
    expect(await store.read('/docs/a.md', list[0]!.id)).toBe('v2');
  });

  it('不同文件的快照互相隔离', async () => {
    await store.snapshot('/docs/a.md', 'A');
    await store.snapshot('/docs/b.md', 'B');
    expect(await store.list('/docs/a.md')).toHaveLength(1);
    expect(await store.list('/docs/b.md')).toHaveLength(1);
    expect(await store.read('/docs/b.md', (await store.list('/docs/b.md'))[0]!.id)).toBe('B');
  });

  it('超出上限时裁剪最旧的一份', async () => {
    for (let index = 0; index <= HISTORY_LIMIT; index++) {
      await store.snapshot('/docs/a.md', `v${index}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const list = await store.list('/docs/a.md');
    expect(list.length).toBeLessThanOrEqual(HISTORY_LIMIT);
    expect(list.length).toBeGreaterThan(0);
  });

  it('非法 id 不读取（路径穿越防护）', async () => {
    expect(await store.read('/docs/a.md', '../../settings.json')).toBeNull();
    expect(await store.read('/docs/a.md', 'not-a-time.md')).toBeNull();
  });

  it('未 init 时安全返回空', async () => {
    const fresh = new HistoryStore();
    expect(await fresh.list('/docs/a.md')).toEqual([]);
    expect(await fresh.read('/docs/a.md', '1.md')).toBeNull();
    expect(await fresh.snapshot('/docs/a.md', 'x')).toEqual({ ok: false, created: false });
  });
});
