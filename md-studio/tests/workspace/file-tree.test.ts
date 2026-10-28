import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: {
    trashItem: async (path: string) => {
      const { rm: remove } = await import('node:fs/promises');
      await remove(path, { recursive: true, force: true });
    }
  }
}));

const { createEntry, deleteEntry, moveEntry, readDir, renameEntry } = await import('../../src/main/workspace');

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mdstudio-tree-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('readDir', () => {
  it('目录优先、名称自然排序、忽略 node_modules', async () => {
    const dir = join(root, 'basic');
    await mkdir(join(dir, 'zeta'), { recursive: true });
    await mkdir(join(dir, 'node_modules'), { recursive: true });
    await writeFile(join(dir, 'b.md'), 'b');
    await writeFile(join(dir, 'a.md'), 'a');
    await writeFile(join(dir, 'img2.png'), 'x');
    await writeFile(join(dir, 'img10.png'), 'x');

    const result = await readDir(dir);
    expect(result.entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'dir:zeta',
      'file:a.md',
      'file:b.md',
      'file:img2.png',
      'file:img10.png'
    ]);
    expect(result.entries.some((entry) => entry.name === 'node_modules')).toBe(false);
    const file = result.entries.find((entry) => entry.name === 'a.md');
    expect(file?.size).toBe(1);
    expect(file?.mtimeMs).toBeGreaterThan(0);
  });

  it('空目录返回空列表', async () => {
    const dir = join(root, 'empty');
    await mkdir(dir, { recursive: true });
    expect((await readDir(dir)).entries).toEqual([]);
  });
});

describe('文件操作', () => {
  it('新建文件/文件夹并拒绝重名', async () => {
    const dir = join(root, 'ops');
    await mkdir(dir, { recursive: true });
    const file = await createEntry(dir, 'note.md', 'file');
    expect(file.endsWith('note.md')).toBe(true);
    const folder = await createEntry(dir, 'sub', 'dir');
    expect((await stat(folder)).isDirectory()).toBe(true);
    await expect(createEntry(dir, 'note.md', 'file')).rejects.toThrow(/已存在/);
    await expect(createEntry(dir, 'a/b.md', 'file')).rejects.toThrow(/名称不合法/);
  });

  it('重命名保留内容并拒绝同名', async () => {
    const dir = join(root, 'rename');
    await mkdir(dir, { recursive: true });
    const original = await createEntry(dir, 'old.md', 'file');
    await writeFile(original, 'hello');
    const renamed = await renameEntry(original, 'new.md');
    expect(renamed.endsWith('new.md')).toBe(true);
    await createEntry(dir, 'other.md', 'file');
    await expect(renameEntry(renamed, 'other.md')).rejects.toThrow(/已存在/);
  });

  it('移动到目标目录并拒绝移动到自身内部', async () => {
    const dir = join(root, 'move');
    await mkdir(join(dir, 'target'), { recursive: true });
    const source = await createEntry(dir, 'move-me.md', 'file');
    const moved = await moveEntry(source, join(dir, 'target'));
    expect(moved).toBe(join(dir, 'target', 'move-me.md'));
    const folder = await createEntry(dir, 'box', 'dir');
    await expect(moveEntry(folder, join(folder, 'inner'))).rejects.toThrow(/自身内部/);
  });

  it('删除（回收站 mock）', async () => {
    const dir = join(root, 'delete');
    await mkdir(dir, { recursive: true });
    const victim = await createEntry(dir, 'gone.md', 'file');
    await deleteEntry(victim);
    await expect(stat(victim)).rejects.toThrow();
  });

  it('1000 项目录在预算内返回（<200ms 目标宽松到 1s）', async () => {
    const dir = join(root, 'bulk');
    await mkdir(dir, { recursive: true });
    await Promise.all(Array.from({ length: 1000 }, (_, index) => writeFile(join(dir, `f${index}.md`), 'x')));
    const started = Date.now();
    const result = await readDir(dir);
    const elapsed = Date.now() - started;
    expect(result.entries).toHaveLength(1000);
    expect(result.truncated).toBe(false);
    expect(elapsed).toBeLessThan(1000);
  }, 30000);
});
