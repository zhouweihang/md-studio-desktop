import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceChangedEvent } from '../../src/shared/channels';

vi.mock('electron', () => ({ shell: { trashItem: async () => undefined } }));

const { WorkspaceWatcher } = await import('../../src/main/workspace');

const watchers: Array<InstanceType<typeof WorkspaceWatcher>> = [];

afterEach(async () => {
  while (watchers.length > 0) {
    await watchers.pop()?.close();
  }
});

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('等待事件超时'));
      }
    }, 40);
  });
}

describe('WorkspaceWatcher', () => {
  it('外部写入在 1s（宽松 5s）内产生 change 事件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mdstudio-watch-'));
    const batches: WorkspaceChangedEvent[][] = [];
    const watcher = new WorkspaceWatcher((events) => batches.push(events));
    watchers.push(watcher);
    watcher.setRoot(root);
    await new Promise((resolve) => setTimeout(resolve, 400));

    const file = join(root, 'a.md');
    await writeFile(file, 'first');
    await waitFor(() => batches.some((batch) => batch.some((event) => event.path === file)), 5000);

    const event = batches.flat().find((item) => item.path === file);
    expect(event?.event).toBe('add');

    await rm(root, { recursive: true, force: true });
  }, 20000);

  it('连续写入合并进少量批次（去抖）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mdstudio-watch-batch-'));
    const batches: WorkspaceChangedEvent[][] = [];
    const watcher = new WorkspaceWatcher((events) => batches.push(events));
    watchers.push(watcher);
    watcher.setRoot(root);
    await new Promise((resolve) => setTimeout(resolve, 400));

    await mkdir(join(root, 'sub'), { recursive: true });
    await writeFile(join(root, 'sub', 'x.md'), 'x');
    await writeFile(join(root, 'sub', 'y.md'), 'y');
    await waitFor(() => batches.flat().filter((event) => event.event === 'add').length >= 2, 6000);
    const addBatches = batches.filter((batch) => batch.some((event) => event.event === 'add'));
    expect(addBatches.length).toBeLessThanOrEqual(2);

    await rm(root, { recursive: true, force: true });
  }, 20000);

  it('切换根目录后旧目录不再产生事件', async () => {
    const first = await mkdtemp(join(tmpdir(), 'mdstudio-watch-old-'));
    const second = await mkdtemp(join(tmpdir(), 'mdstudio-watch-new-'));
    const batches: WorkspaceChangedEvent[][] = [];
    const watcher = new WorkspaceWatcher((events) => batches.push(events));
    watchers.push(watcher);
    watcher.setRoot(first);
    await new Promise((resolve) => setTimeout(resolve, 400));
    watcher.setRoot(second);
    await new Promise((resolve) => setTimeout(resolve, 600));

    await writeFile(join(first, 'ignored.md'), 'x');
    await waitFor(() => batches.flat().some((event) => event.path.includes('ignored.md')), 2000).catch(() => undefined);
    expect(batches.flat().some((event) => event.path.includes('ignored.md'))).toBe(false);

    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }, 20000);
});
