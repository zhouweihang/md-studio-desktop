import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftIdFor } from '../../src/shared/draft-id';
import { DraftStore } from '../../src/main/drafts';

let userData = '';

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), 'mdstudio-drafts-'));
});

afterAll(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe('会话崩溃检测', () => {
  it('未正常退出时下次启动报告 crashed', async () => {
    const first = new DraftStore();
    first.init(userData);
    await first.beginSession();
    expect(first.previousSessionCrashed()).toBe(false);

    // 模拟崩溃：不调用 endSession
    const second = new DraftStore();
    second.init(userData);
    await second.beginSession();
    expect(second.previousSessionCrashed()).toBe(true);

    await second.endSession();
    const third = new DraftStore();
    third.init(userData);
    await third.beginSession();
    expect(third.previousSessionCrashed()).toBe(false);
    await third.endSession();
  });
});

describe('草稿读写', () => {
  it('保存 / 列出 / 读取 / 单条清除', async () => {
    const store = new DraftStore();
    store.init(userData);
    const id = draftIdFor('C:/notes/a.md');
    await store.save(id, 'C:/notes/a.md', 'a.md', '# 草稿内容');
    await store.save(draftIdFor(null), null, '未命名', '无标题草稿');

    const list = await store.list();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const record = await store.read(id);
    expect(record?.content).toBe('# 草稿内容');
    expect(record?.name).toBe('a.md');
    expect(record?.size).toBe('# 草稿内容'.length);
    expect(record?.updatedAt).toBeGreaterThan(0);

    await store.clear(id);
    expect(await store.read(id)).toBeNull();

    await store.discardAll();
    expect((await store.list()).filter((draft) => draft.name === '未命名')).toHaveLength(0);
  });

  it('draftIdFor 对路径稳定、未命名单独成键', () => {
    expect(draftIdFor('C:/a.md')).toBe(draftIdFor('C:/a.md'));
    expect(draftIdFor(null)).not.toBe(draftIdFor('C:/a.md'));
    expect(draftIdFor(null)).toMatch(/^d[0-9a-f]{8}$/);
  });

  it('读取不存在的草稿返回 null（损坏文件不抛错）', async () => {
    const store = new DraftStore();
    store.init(userData);
    expect(await store.read('missing')).toBeNull();
  });
});
