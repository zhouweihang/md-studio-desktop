/**
 * 真机中文 IME 回归（RFC-002 REQ-008 / REQ-035、backlog B5-2）。
 *
 * 自动化部分用 CDP `Input.imeSetComposition` 驱动真实的组合事件序列（组合 → 提交），
 * 覆盖：拼音上屏、全角标点（行首/表格内）、组合中撤销、连续高强度输入。
 * 候选窗定位、输入法方案切换等只能由真人在本机执行，见
 * `docs/qa/2026-10-28-md-studio-ime-regression.md` 的人工项。
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type CDPSession, type ElectronApplication, type Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;
let session: CDPSession;
let userDataDir: string;
const pageErrors: string[] = [];

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'mdstudio-ime-'));
  app = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    env: { ...process.env, MD_STUDIO_E2E: '1' }
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.waitForSelector('.cm-content', { timeout: 30_000 });
  session = await page.context().newCDPSession(page);
});

// 用例会往文档里写字 → 主进程标记脏；退出时若不清理会弹出原生「未保存」对话框，
// 卡住 `app.close()` 与 worker teardown（与 app.spec.ts 同一处理）。
test.afterEach(async () => {
  await page?.evaluate(() => window.mdstudio.setDirty(false)).catch(() => undefined);
});

test.afterAll(async () => {
  await session?.detach().catch(() => undefined);
  await app?.close().catch(() => undefined);
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
});

/** 组合（拼音）→ 提交（汉字）；返回提交前的可见文本。 */
async function compose(pinyin: string, commit: string): Promise<void> {
  await session.send('Input.imeSetComposition', {
    text: pinyin,
    selectionStart: pinyin.length,
    selectionEnd: pinyin.length
  });
  await session.send('Input.insertText', { text: commit });
}

async function editorText(): Promise<string> {
  return page.locator('.cm-content').innerText();
}

/** 把光标移到文档末尾的新行，避免覆盖欢迎文档内容。 */
async function focusEnd(): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
}

test('IME-1 拼音组合上屏：组合期可见、提交后不残留拼音', async () => {
  await focusEnd();
  await session.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 });
  await expect.poll(editorText).toContain('nihao');

  await session.send('Input.insertText', { text: '你好' });
  await expect.poll(editorText).toContain('你好');
  // 提交后拼音不应留在文档里（CM 只接收提交文本）
  expect(await editorText()).not.toContain('nihao');

  // 装饰未被组合破坏：再输入普通字符仍然生效
  await page.keyboard.type('！');
  await expect.poll(editorText).toContain('你好！');
  expect(pageErrors).toEqual([]);
});

test('IME-2 全角标点：行首与表格单元格内均可输入且表格结构完整', async () => {
  await focusEnd();
  // 行首全角标点
  await session.send('Input.insertText', { text: '，。！？；：' });
  await expect.poll(editorText).toContain('，。！？；：');

  // 表格单元格内的全角标点（GFM 表格 + 中文标点）
  await page.keyboard.press('Enter');
  await page.keyboard.type('| 列一 | 列二 |');
  await page.keyboard.press('Enter');
  await page.keyboard.type('| --- | --- |');
  await page.keyboard.press('Enter');
  await page.keyboard.type('| ，。 | ！！ |');

  await expect.poll(editorText).toContain('| ，。 | ！！ |');
  // 表格语法仍被识别（源码模式下可见完整的管道行）
  const content = await editorText();
  expect(content).toContain('| 列一 | 列二 |');
  expect(pageErrors).toEqual([]);
});

test('IME-3 组合中撤销：文档不损坏，提交后仍可继续输入', async () => {
  await focusEnd();
  await session.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 });
  await page.keyboard.press('Control+Z');
  await session.send('Input.insertText', { text: '中文' });
  await page.keyboard.type('OK');

  await expect.poll(editorText).toContain('中文');
  await expect.poll(editorText).toContain('OK');
  expect(pageErrors).toEqual([]);
});

test('IME-4 连续高强度输入：60 轮组合-提交不丢字、不报错', async () => {
  await focusEnd();
  const started = Date.now();
  for (let round = 0; round < 60; round++) {
    await compose('ce', '测');
  }
  const elapsed = Date.now() - started;
  console.log(`[ime] 60 轮组合-提交耗时 ${elapsed} ms`);

  const content = await editorText();
  const committed = content.split('测').length - 1;
  expect(committed).toBeGreaterThanOrEqual(60);
  expect(pageErrors).toEqual([]);
});

test('IME-5（人工）输入法方案切换：拼音 ↔ 双拼/五笔后继续输入', async () => {
  test.skip(
    true,
    'CDP 只能模拟组合事件，无法切换本机输入法方案；请按 docs/qa/2026-10-28-md-studio-ime-regression.md 人工执行并回填'
  );
});

test('IME-6（人工）候选窗定位、翻页与上屏位置', async () => {
  test.skip(
    true,
    '候选窗由操作系统输入法绘制，自动化不可见；请按 docs/qa/2026-10-28-md-studio-ime-regression.md 人工执行并回填'
  );
});
