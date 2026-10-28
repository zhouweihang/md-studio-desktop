/**
 * 规模实测（REQ-034）：10k 文件搜索、10k 行大纲、1k 行代码块首帧。
 *
 * 目标值（RFC-002 §4.6）：
 * - 10k 文件搜索：首结果 < 500 ms，全量 < 3 s
 * - 10k 行大纲：< 300 ms
 * - 1k 行代码块首帧：< 100 ms
 *
 * 数字同时打印到 stdout（`npm test -- tests/perf`），供回填 RFC 验收表。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EditorState } from '@codemirror/state';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearContentCache, contentCacheStats, searchDirectory, setTrustedRoot } from '../../src/main/search';
import { computeDecorations } from '../../src/renderer/editor/live-preview';
import { extractOutline } from '../../src/shared/outline';

const FILE_COUNT = 10_000;
let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mdstudio-perf-'));
  // 每 10 个文件里放一个可命中项，其余是普通笔记
  const writes: Promise<unknown>[] = [];
  for (let index = 0; index < FILE_COUNT; index++) {
    const name = index % 10 === 0 ? `note-${index}.md` : `filler-${index}.md`;
    writes.push(writeFile(join(root, name), `# 文件 ${index}\n\n正文内容 ${index}\n`, 'utf8'));
    if (writes.length >= 500) await Promise.all(writes.splice(0, writes.length));
  }
  await Promise.all(writes);
}, 180_000);

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('10k 文件搜索', () => {
  it('文件名模式：首结果与全量时间在预算内', async () => {
    let firstBatchAt = 0;
    const started = performance.now();
    const summary = await searchDirectory(
      { root, query: 'note-', mode: 'name' },
      {
        onBatch: () => {
          if (!firstBatchAt) firstBatchAt = performance.now() - started;
        },
        isCanceled: () => false
      }
    );
    const total = performance.now() - started;
    console.log(
      `[perf] 10k 文件搜索：首结果 ${firstBatchAt.toFixed(0)} ms / 全量 ${total.toFixed(0)} ms / 命中 ${summary.matches}`
    );

    expect(summary.files).toBeGreaterThanOrEqual(FILE_COUNT - 5); // 目录里没有别的文件
    expect(summary.matches).toBe(Math.ceil(FILE_COUNT / 10));
    expect(firstBatchAt).toBeGreaterThan(0);
    expect(firstBatchAt).toBeLessThan(500);
    expect(total).toBeLessThan(3000);
  }, 120_000);

  it('内容模式：冷启动全量扫描耗时（首次读盘）', async () => {
    clearContentCache();
    // 与真实运行一致：工作区已挂上 chokidar 监听 → 暖扫描可跳过 stat
    setTrustedRoot(root);
    const started = performance.now();
    const summary = await searchDirectory(
      { root, query: '正文内容 1234', mode: 'content' },
      { onBatch: () => undefined, isCanceled: () => false }
    );
    const elapsed = performance.now() - started;
    console.log(`[perf] 10k 文件内容模式（冷，未缓存）：${elapsed.toFixed(0)} ms / 命中 ${summary.matches}`);

    expect(summary.matches).toBe(1);
    expect(contentCacheStats().files).toBeGreaterThan(9000);
    expect(elapsed).toBeLessThan(10_000);
  }, 120_000);

  it('内容模式：命中正文缓存后全量 < 1 s（改查询词仍复用）', async () => {
    // 前置用例已建立信任根；此处验证工作区的暖扫描（跳过 10k 次 stat）
    const started = performance.now();
    const summary = await searchDirectory(
      { root, query: '正文内容 9876', mode: 'content' },
      { onBatch: () => undefined, isCanceled: () => false }
    );
    const elapsed = performance.now() - started;
    console.log(`[perf] 10k 文件内容模式（暖，缓存命中）：${elapsed.toFixed(0)} ms / 命中 ${summary.matches}`);

    expect(summary.matches).toBe(1);
    expect(elapsed).toBeLessThan(1000);
  }, 120_000);
});

describe('10k 行大纲', () => {
  it('抽取耗时在 300 ms 内，且层级正确', () => {
    const lines: string[] = [];
    for (let index = 0; index < 2000; index++) {
      lines.push(`${'#'.repeat((index % 4) + 1)} 章节 ${index}`);
      lines.push('');
      lines.push(`正文 ${index} 的一段内容。`);
      lines.push('');
      lines.push('> 引用');
    }
    const text = lines.join('\n');
    expect(text.split('\n').length).toBeGreaterThanOrEqual(10_000);

    const started = performance.now();
    const items = extractOutline(text);
    const elapsed = performance.now() - started;
    console.log(`[perf] 10k 行大纲：${elapsed.toFixed(1)} ms / ${items.length} 个标题`);

    expect(items).toHaveLength(2000);
    expect(items[0]?.level).toBe(1);
    expect(elapsed).toBeLessThan(300);
  });
});

describe('1k 行代码块首帧', () => {
  it('块级装饰计算在 100 ms 内', () => {
    const lines: string[] = ['# 代码示例', '', '```ts'];
    for (let index = 0; index < 1000; index++) lines.push(`const value${index} = ${index};`);
    lines.push('```', '', '| A | B |', '| --- | --- |');
    for (let index = 0; index < 20; index++) lines.push(`| ${index} | ${index * 2} |`);
    lines.push('', '结尾段落：$E = mc^2$');
    const doc = lines.join('\n');

    const state = EditorState.create({ doc });
    const context = {
      getDocDir: () => null,
      openExternal: () => undefined,
      notify: () => undefined
    };

    const started = performance.now();
    const result = computeDecorations(state, [{ from: 0, to: state.doc.length }], context, {});
    const elapsed = performance.now() - started;
    console.log(
      `[perf] 1k 行代码块 + 表格：${elapsed.toFixed(1)} ms / ${result.decorations.size} 个装饰`
    );

    expect(state.doc.lines).toBeGreaterThanOrEqual(1000);
    expect(result.decorations.size).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
  });
});
