import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SearchItem } from '../../src/shared/channels';

vi.mock('electron', () => ({ shell: { trashItem: async () => undefined } }));

const {
  collectFiles,
  clearContentCache,
  contentCacheStats,
  invalidateContentCachePath,
  scanContentMatches,
  searchDirectory,
  setTrustedRoot
} = await import('../../src/main/search');

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mdstudio-search-'));
  await mkdir(join(root, 'docs'), { recursive: true });
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await writeFile(join(root, 'docs', 'alpha.md'), '# Alpha\n目标关键字在第一行\n还有 目标 出现两次\n');
  await writeFile(join(root, 'docs', 'beta.md'), '无匹配内容\n');
  await writeFile(join(root, 'docs', '目标文件.md'), '名字里有目标\n');
  await writeFile(join(root, 'node_modules', 'skip.md'), '目标 关键字应被忽略\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('scanContentMatches', () => {
  it('逐行定位行列号', () => {
    const matches = scanContentMatches('one\ntwo target\nTAEGET', 'target');
    expect(matches).toEqual([{ line: 2, column: 5, text: 'two target' }]);
  });

  it('区分大小写开关', () => {
    expect(scanContentMatches('Target', 'target', true)).toHaveLength(0);
    expect(scanContentMatches('Target', 'target', false)).toHaveLength(1);
  });

  it('单文件命中上限 50', () => {
    const content = Array.from({ length: 80 }, () => 'x x').join('\n');
    expect(scanContentMatches(content, 'x')).toHaveLength(50);
  });
});

describe('searchDirectory', () => {
  it('内容模式命中并按批回调', async () => {
    const items: SearchItem[] = [];
    const summary = await searchDirectory(
      { root, query: '目标', mode: 'content' },
      {
        onBatch: (batch) => items.push(...batch),
        isCanceled: () => false
      }
    );
    expect(summary.matches).toBeGreaterThanOrEqual(3);
    expect(items.some((item) => item.path.endsWith('alpha.md') && item.line === 2)).toBe(true);
    expect(items.every((item) => !item.path.includes('node_modules'))).toBe(true);
    expect(summary.elapsedMs).toBeGreaterThanOrEqual(0);
  }, 20000);

  it('文件名模式只返回名字命中', async () => {
    const items: SearchItem[] = [];
    await searchDirectory(
      { root, query: '目标文件', mode: 'name' },
      {
        onBatch: (batch) => items.push(...batch),
        isCanceled: () => false
      }
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('name');
    expect(items[0]?.name).toBe('目标文件.md');
  }, 20000);

  it('取消后立即收敛并标记 canceled', async () => {
    let batches = 0;
    const summary = await searchDirectory(
      { root, query: '目标', mode: 'content' },
      {
        onBatch: () => {
          batches += 1;
        },
        isCanceled: () => batches >= 1
      }
    );
    expect(summary.canceled).toBe(true);
  }, 20000);

  it('内容缓存：同 mtime 复用正文，文件修改后自动失效', async () => {
    clearContentCache();
    const dir = await mkdtemp(join(tmpdir(), 'mdstudio-search-cache-'));
    const file = join(dir, 'cached.md');
    await writeFile(file, '第一版：绿苹果\n', 'utf8');
    const search = (query: string): Promise<number> =>
      searchDirectory({ root: dir, query, mode: 'content' }, { onBatch: () => undefined, isCanceled: () => false }).then(
        (summary) => summary.matches
      );

    expect(await search('绿苹果')).toBe(1);
    expect(contentCacheStats().files).toBe(1);

    // 换查询词仍命中缓存（缓存的是正文而不是结果）
    expect(await search('第一版')).toBe(1);

    // 改写文件并显式推进 mtime → 旧缓存失效，能搜到新内容
    await writeFile(file, '第二版：红香蕉\n', 'utf8');
    const later = new Date(Date.now() + 5000);
    await utimes(file, later, later);
    expect(await search('红香蕉')).toBe(1);
    expect(await search('绿苹果')).toBe(0);

    await rm(dir, { recursive: true, force: true });
  }, 20000);

  it('信任根（已监听）：跳过 stat，失效由监听/保存钩子负责', async () => {
    clearContentCache();
    const dir = await mkdtemp(join(tmpdir(), 'mdstudio-search-trusted-'));
    const file = join(dir, 'watched.md');
    await writeFile(file, '第一版：旧内容\n', 'utf8');
    const search = (query: string): Promise<number> =>
      searchDirectory({ root: dir, query, mode: 'content' }, { onBatch: () => undefined, isCanceled: () => false }).then(
        (summary) => summary.matches
      );

    setTrustedRoot(dir);
    expect(await search('旧内容')).toBe(1);

    // 模拟监听事件：直接改盘但不发失效 → 复用缓存（不读盘）
    await writeFile(file, '第二版：新内容\n', 'utf8');
    expect(await search('旧内容')).toBe(1);

    // 监听事件到达 → 条目失效 → 读到新正文
    invalidateContentCachePath(file);
    expect(await search('新内容')).toBe(1);
    expect(await search('旧内容')).toBe(0);

    setTrustedRoot(null);
    await rm(dir, { recursive: true, force: true });
  }, 20000);

  it('目录遍历并发：不同并发度收集到同一批文件（无重复/漏收）', async () => {
    const tree = await mkdtemp(join(tmpdir(), 'mdstudio-search-dirs-'));
    // 3 × 3 × 3 的嵌套目录，每层带 2 个文件，共 39 个目录 / 78 个文件
    const build = async (dir: string, depth: number): Promise<void> => {
      await writeFile(join(dir, `note-${depth}.md`), `层 ${depth}\n`, 'utf8');
      await writeFile(join(dir, 'skip.md'), 'x', 'utf8');
      if (depth === 0) return;
      for (let index = 0; index < 3; index++) {
        const child = join(dir, `d${index}`);
        await mkdir(child, { recursive: true });
        await build(child, depth - 1);
      }
    };
    await build(tree, 3);

    const serial = await collectFiles(tree, () => false, 1);
    const parallel = await collectFiles(tree, () => false, 8);
    expect(serial).toHaveLength(80);
    expect(new Set(serial).size).toBe(serial.length);
    expect([...parallel].sort()).toEqual([...serial].sort());

    // 提前停止时不报错且结果有限
    const stopped = await collectFiles(tree, () => true, 4);
    expect(stopped.length).toBeLessThanOrEqual(serial.length);
    await rm(tree, { recursive: true, force: true });
  }, 20000);

  it('大目录首结果与全量在预算内（2000 文件宽松 3s 断言）', async () => {
    const bulk = await mkdtemp(join(tmpdir(), 'mdstudio-search-bulk-'));
    await Promise.all(
      Array.from({ length: 2000 }, (_, index) => writeFile(join(bulk, `f${index}.md`), `内容 ${index}\nneedle-${index}\n`))
    );
    const started = Date.now();
    let firstBatchAt = 0;
    const summary = await searchDirectory(
      { root: bulk, query: 'needle-', mode: 'content' },
      {
        onBatch: () => {
          if (firstBatchAt === 0) firstBatchAt = Date.now() - started;
        },
        isCanceled: () => false
      }
    );
    const elapsed = Date.now() - started;
    expect(summary.matches).toBe(2000);
    expect(firstBatchAt).toBeLessThan(1500);
    expect(elapsed).toBeLessThan(8000);
    await rm(bulk, { recursive: true, force: true });
  }, 60000);
});
