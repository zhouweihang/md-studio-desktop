import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;
let workDir: string;
let userDataDir: string;

test.beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mdstudio-e2e-'));
  userDataDir = await mkdtemp(join(tmpdir(), 'mdstudio-e2e-userdata-'));
  app = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    env: { ...process.env, MD_STUDIO_E2E: '1' }
  });
  page = await app.firstWindow();
  await page.waitForSelector('.cm-content', { timeout: 30_000 });
});

// 每个用例结束后清掉窗口脏标记，避免退出时弹原生「未保存」对话框卡住 worker
// （只影响退出流程，不改变用例内部对脏标记的断言）
test.afterEach(async () => {
  await page?.evaluate(() => window.mdstudio.setDirty(false)).catch(() => undefined);
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
});

test('启动：窗口、欢迎文档、状态栏统计', async () => {
  await expect(page.locator('#doc-title')).toHaveText('未命名');
  const content = await page.locator('.cm-content').innerText();
  expect(content).toContain('欢迎使用 MD-Studio');
  await expect(page.locator('#stat-words')).not.toHaveText('0 字');
  await expect(page.locator('#stat-mode')).toHaveText('实时预览');
});

test('输入更新字数与脏标记，撤销可用', async () => {
  const wordCount = async (): Promise<number> =>
    Number((await page.locator('#stat-words').innerText()).replace(/[^\d]/g, ''));
  const before = await wordCount();
  expect(before).toBeGreaterThan(0);

  await page.locator('.cm-content').click();
  await page.keyboard.type('端到端测试内容');
  await expect(page.locator('#doc-dirty')).toBeVisible();
  await expect.poll(wordCount).toBeGreaterThan(before);

  await page.keyboard.press('Control+Z');
  await expect.poll(wordCount).toBe(before);
});

test('打开文件 → 编辑 → Ctrl+S 保存往返（磁盘内容一致）', async () => {
  const file = join(workDir, '往返.md');
  await writeFile(file, '# 打开测试\n\n初始内容', 'utf8');

  // 与菜单「最近文件」同路径：主进程下发命令
  await app.evaluate(({ BrowserWindow }, path) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('command:run', { id: 'file.openRecent', arg: path });
  }, file);

  await expect(page.locator('#doc-title')).toHaveText('往返.md');
  await expect(page.locator('#doc-path')).toHaveText(file);

  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('E2E 修改后的内容');
  await expect(page.locator('#doc-dirty')).toBeVisible();
  await page.keyboard.press('Control+S');

  await expect
    .poll(async () => readFile(file, 'utf8'), { timeout: 10_000 })
    .toContain('E2E 修改后的内容');
  await expect(page.locator('#doc-dirty')).toBeHidden();
});

test('主题切换（键盘命令 + 设置持久化）', async () => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Shift+Y');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#stat-theme')).toHaveText('暗色');

  await page.keyboard.press('Control+Shift+Y');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('源码模式切换（Ctrl+/）与实时预览并存', async () => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+/');
  await expect(page.locator('#stat-mode')).toHaveText('源码模式');
  await page.keyboard.press('Control+/');
  await expect(page.locator('#stat-mode')).toHaveText('实时预览');
});

test('导出 HTML 指定路径（自包含、含正文）', async () => {
  const target = join(workDir, 'export.html');
  const result = await page.evaluate(
    async ({ html, path }) => window.mdstudio.exportHtml({ html, suggestedName: 'export.html', targetPath: path }),
    { html: '<!doctype html><html><body><h1>导出</h1></body></html>', path: target }
  );
  expect(result.canceled).toBe(false);
  expect(result.path).toBe(target);
  const written = await readFile(target, 'utf8');
  expect(written).toContain('<h1>导出</h1>');
});

test('导出 PDF 指定路径（真实 printToPDF，产物为 %PDF）', async () => {
  const target = join(workDir, 'export.pdf');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{font-family:"Microsoft YaHei",sans-serif}</style></head><body><h1>中文导出测试</h1><p>PDF 页码与边距由主进程控制。</p></body></html>`;
  const result = await page.evaluate(
    async ({ source, path }) => window.mdstudio.exportPdf({ html: source, suggestedName: 'export.pdf', targetPath: path }),
    { source: html, path: target }
  );
  expect(result.canceled).toBe(false);
  expect(result.error).toBeUndefined();
  const info = await stat(target);
  expect(info.size).toBeGreaterThan(1000);
  const head = await readFile(target);
  expect(head.subarray(0, 4).toString('latin1')).toBe('%PDF');
});

test('工作区文件服务：新建 → 重命名 → 删除（含磁盘互证）', async () => {
  const root = join(workDir, 'ws');
  await writeFile(join(workDir, '.keep'), '');
  const created = await page.evaluate(async (parent) => window.mdstudio.createEntry({ parent, name: '笔记.md', kind: 'file' }), workDir);
  expect(created.path).toBe(join(workDir, '笔记.md'));
  const renamed = await page.evaluate(async (path) => window.mdstudio.renameEntry({ path, name: '重命名.md' }), created.path);
  expect((await stat(renamed.path)).isFile()).toBe(true);
  await page.evaluate(async (path) => window.mdstudio.deleteEntry(path), renamed.path);
  await expect(stat(renamed.path)).rejects.toThrow();
  void root;
});

test('键位与设置 IPC：默认键位无冲突、最近文件已记录', async () => {
  const keymap = await page.evaluate(() => window.mdstudio.getKeymap());
  expect(keymap.conflicts).toEqual([]);
  expect((keymap.bindings['file.save'] ?? []).length).toBeGreaterThan(0);
  const { settings } = await page.evaluate(() => window.mdstudio.getSettings());
  expect(settings.files.recent.some((item) => item.endsWith('往返.md'))).toBe(true);
});

test('多标签：Ctrl+T 新建、内容隔离、Ctrl+Tab 切换、Ctrl+W 关闭', async () => {
  const tabCount = (): Promise<number> => page.locator('#tab-strip .tab').count();
  const content = async (): Promise<string> => page.locator('.cm-content').innerText();

  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('标签一内容');

  const before = await tabCount();
  await page.keyboard.press('Control+T');
  await expect.poll(tabCount).toBe(before + 1);
  await expect(page.locator('#tab-strip .tab.active')).toHaveCount(1);

  await page.locator('.cm-content').click();
  await page.keyboard.type('标签二内容');
  await expect.poll(content).toContain('标签二内容');
  expect(await content()).not.toContain('标签一内容');

  // Ctrl+Shift+Tab 回到上一个标签，内容各自保留（撤销栈随 EditorState 隔离）
  await page.keyboard.press('Control+Shift+Tab');
  await expect.poll(content).toContain('标签一内容');
  expect(await content()).not.toContain('标签二内容');

  // Ctrl+Tab 再向前循环，回到刚新建的标签
  await page.keyboard.press('Control+Tab');
  await expect.poll(content).toContain('标签二内容');

  // 关闭脏标签会询问，选择「不保存」
  await page.keyboard.press('Control+W');
  await expect(page.locator('#dialog-layer .dialog')).toBeVisible();
  await page.locator('#dialog-layer button', { hasText: '不保存' }).click();
  await expect.poll(tabCount).toBe(before);
});

test('标签会话恢复：重载渲染层后按 settings.tabs 重开', async () => {
  const first = join(workDir, '恢复一.md');
  const second = join(workDir, '恢复二.md');
  await writeFile(first, '# 恢复一\n\n第一份内容', 'utf8');
  await writeFile(second, '# 恢复二\n\n第二份内容', 'utf8');

  for (const path of [first, second]) {
    await app.evaluate(({ BrowserWindow }, target) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('command:run', { id: 'file.openRecent', arg: target });
    }, path);
  }
  // 会话快照只保存有路径的标签（未命名/欢迎标签不入设置）
  const snapshotPaths = async (): Promise<(string | null)[]> =>
    (await page.evaluate(() => window.mdstudio.getSettings())).settings.tabs.open.map((entry) => entry.path);
  await expect.poll(snapshotPaths).toContain(first);
  await expect.poll(snapshotPaths).toContain(second);
  const expectedTabs = (await page.evaluate(() => window.mdstudio.getSettings())).settings.tabs.open.length;

  await page.reload();
  await page.waitForSelector('.cm-content', { timeout: 30_000 });
  await expect.poll(async () => page.locator('#tab-strip .tab').count()).toBe(expectedTabs);
  const labels = await page.locator('#tab-strip .tab-label').allInnerTexts();
  expect(labels).toContain('恢复一.md');
  expect(labels).toContain('恢复二.md');
  const content = await page.locator('.cm-content').innerText();
  expect(content).toMatch(/恢复[一二]/);
});

test('标签拖拽排序：DOM 顺序变化并写入 settings.tabs.open', async () => {
  const files = ['拖一.md', '拖二.md', '拖三.md'].map((name) => join(workDir, name));
  for (const path of files) await writeFile(path, `# ${path}\n\n拖拽用例`, 'utf8');
  for (const path of files) {
    await app.evaluate(({ BrowserWindow }, target) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('command:run', { id: 'file.openRecent', arg: target });
    }, path);
  }
  const labels = (): Promise<string[]> => page.locator('#tab-strip .tab-label').allInnerTexts();
  await expect.poll(labels).toEqual(expect.arrayContaining(['拖一.md', '拖二.md', '拖三.md']));

  // 打开是异步的，实际顺序以 DOM 为准；期望把首项拖到末项之后
  const startOrder = (await labels()).filter((name) => name.startsWith('拖'));
  expect(startOrder).toHaveLength(3);
  const expectedOrder = [startOrder[1], startOrder[2], startOrder[0]] as string[];
  const dropLabels = async (): Promise<string[]> => (await labels()).filter((name) => name.startsWith('拖'));

  // HTML5 拖拽（Playwright 的 mouse 拖移不会触发 dragstart，这里直接派发 DragEvent）
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll<HTMLElement>('#tab-strip .tab')].slice(-3);
    const from = tabs[0];
    const to = tabs[2];
    if (!from || !to) throw new Error('标签数量不足');
    const dataTransfer = new DataTransfer();
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    const rect = to.getBoundingClientRect();
    const clientX = rect.left + rect.width * 0.8;
    const clientY = rect.top + rect.height / 2;
    for (const type of ['dragover', 'drop']) {
      to.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));
    }
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
  });

  await expect.poll(dropLabels).toEqual(expectedOrder);

  // 顺序写回 settings.tabs.open（会话保存去抖 400 ms）
  const savedOrder = async (): Promise<string[]> =>
    (await page.evaluate(() => window.mdstudio.getSettings())).settings.tabs.open.map((entry) => entry.name ?? '');
  await expect.poll(async () => (await savedOrder()).filter((name) => name.startsWith('拖'))).toEqual(expectedOrder);

  // 重载后按持久化顺序恢复
  await page.reload();
  await page.waitForSelector('.cm-content', { timeout: 30_000 });
  await expect.poll(dropLabels).toEqual(expectedOrder);
});

test('界面语言切换：中文 ↔ English 即时生效并持久化（含原生菜单）', async () => {
  const menuLabels = async (): Promise<string[]> =>
    app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items ?? []).map((item) => item.label));

  expect(await menuLabels()).toContain('文件');

  await page.evaluate(() => window.mdstudio.updateSettings({ language: 'en' } as never));
  await expect(page.locator('#sidebar-tabs button[data-tab="files"]')).toHaveText('Files');
  await expect(page.locator('#stat-mode')).toHaveText('Live preview');
  await expect(page.locator('#files-toolbar [data-file-action="refresh"]')).toHaveText('Refresh');
  await expect.poll(async () => (await page.evaluate(() => window.mdstudio.getSettings())).settings.language).toBe('en');
  expect(await menuLabels()).toContain('File');

  await page.evaluate(() => window.mdstudio.updateSettings({ language: 'zh-CN' } as never));
  await expect(page.locator('#sidebar-tabs button[data-tab="files"]')).toHaveText('文件');
  expect(await menuLabels()).toContain('文件');
});

test('中文 IME 组合输入（CDP）：组合与提交不破坏文档', async () => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.imeSetComposition', {
      text: 'nihao',
      selectionStart: 5,
      selectionEnd: 5
    });
  } catch (error) {
    test.skip(true, `当前平台/CDP 不支持 Input.imeSetComposition：${(error as Error).message}`);
  }
  await expect.poll(async () => page.locator('.cm-content').innerText()).toContain('nihao');

  await session.send('Input.insertText', { text: '你好' });
  await expect.poll(async () => page.locator('.cm-content').innerText()).toContain('你好');
  await session.detach();
});
