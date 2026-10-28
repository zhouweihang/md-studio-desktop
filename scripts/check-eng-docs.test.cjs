/**
 * 工程文档门禁自测：`scripts/check-eng-docs.cjs` 的 Backlog 编号判定。
 *
 * 背景：早期实现用 /\\bB<区块>-<序号>\\b/ 扫描全文，导致条目正文里**引用**别的
 * 条目编号（"见 B2-2"）被当成新增条目，从而误报"重复条目编号"。本测试锁住
 * 修正后的语义：只有表格首列 / 标题 / 列表项开头的编号算声明，正文引用不算。
 *
 * 运行：node --test scripts/check-eng-docs.test.cjs（或 npm run test:docs）
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'check-eng-docs.cjs');

/**
 * 在临时根目录写一份 backlog，跑一遍门禁，返回 { errors, warnings, info }。
 * `git: true` 时在临时目录 `git init`（文档忽略检查依赖真实 git 判定）。
 */
function check(backlog, { git = false, files = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eng-docs-'));
  try {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'backlog.md'), backlog, 'utf8');
    for (const [relative, content] of Object.entries(files)) {
      const full = path.join(root, relative);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    if (git) {
      const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
      assert.equal(init.status, 0, `git init 失败：${init.stderr}`);
    }
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root, '--json'], {
      encoding: 'utf8',
    });
    assert.equal(result.error, undefined, `启动门禁失败：${result.error}`);
    const report = JSON.parse(result.stdout);
    report.exitCode = result.status;
    return report;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const duplicateWarnings = (report) => report.warnings.filter((w) => w.includes('重复条目编号'));

test('正文引用其它条目编号不算声明（曾经的误报场景）', () => {
  const report = check(
    [
      '# Backlog',
      '',
      '| ID | 项 | 说明 |',
      '|---|---|---|',
      '| B1-1 | 第一项 | 做法见 B2-2 的说明 |',
      '| B2-2 | 第二项 | 与 B1-1 互补，另见 B1-1 |',
      '',
    ].join('\n'),
  );

  assert.deepEqual(duplicateWarnings(report), [], '正文交叉引用不应产生重复条目告警');
  assert.match(report.info.join('\n'), /Backlog：2 个条目/);
  assert.equal(report.exitCode, 0);
});

test('真正的重复条目仍然告警', () => {
  const report = check(
    [
      '# Backlog',
      '',
      '| ID | 项 |',
      '|---|---|',
      '| B1-1 | 第一项 |',
      '| B1-1 | 重复登记的第一项 |',
      '',
    ].join('\n'),
  );

  const warnings = duplicateWarnings(report);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /重复条目编号：B1-1/);
});

test('完成态、标题与列表三种声明位置都能识别', () => {
  const report = check(
    [
      '# Backlog',
      '',
      '| ID | 项 |',
      '|---|---|',
      '| ~~B1-1~~ | 已完成（横线包裹） |',
      '| B1-2 | 进行中 |',
      '',
      '### B2-1 标题形式的条目',
      '',
      '- B3-1 列表形式的条目',
      '- B3-1 列表形式的重复条目',
      '',
    ].join('\n'),
  );

  assert.match(report.info.join('\n'), /Backlog：4 个条目/);
  const warnings = duplicateWarnings(report);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /重复条目编号：B3-1/);
});

test('被 .gitignore 排除的 .md 报 ERROR（真实发生过：evidence-*.md）', () => {
  const report = check('# Backlog\n', {
    git: true,
    files: {
      '.gitignore': 'docs/analysis/**/evidence-*\n',
      'docs/analysis/typora/evidence-plan.md': '# 证据卷留存方案\n',
    },
  });

  assert.equal(report.exitCode, 1);
  const errors = report.errors.join('\n');
  assert.match(errors, /被 \.gitignore 排除/);
  assert.match(errors, /docs\/analysis\/typora\/evidence-plan\.md/);
});

test('被忽略的非 .md 素材与下划线临时目录不报错', () => {
  const report = check('# Backlog\n', {
    git: true,
    files: {
      '.gitignore': 'docs/analysis/**/evidence-*\ndocs/analysis/**/_extract/\n',
      'docs/analysis/typora/evidence-lib-asar': '{}\n',
      'docs/analysis/typora/_extract/Docs/Quick Start.md': '# 上游文档\n',
    },
  });

  assert.equal(report.exitCode, 0);
  assert.match(report.info.join('\n'), /docs\/ 下无被忽略的 \.md/);
});

test('C4 视图引用了不存在的源码路径时报 ERROR', () => {
  const report = check('# Backlog\n', {
    files: {
      'docs/architecture/C1-context.md': '# C1\n\n主进程在 `src/main/services/export.ts` 里。\n',
    },
  });

  assert.equal(report.exitCode, 1);
  const errors = report.errors.join('\n');
  assert.match(errors, /失效的源码路径/);
  assert.match(errors, /src\/main\/services\/export\.ts（文件不存在）/);
});

test('源码路径通配组跳过，行号越界报 ERROR', () => {
  const ok = check('# Backlog\n', {
    files: {
      'md-studio/src/main/exists.ts': 'export const a = 1;\n',
      'docs/architecture/C1-context.md':
        '# C1\n\n`src/main/exists.ts:1`、`tests/editor/*.test.ts`、`src/renderer/themes/built-in/{light,dark}.css`。\n',
    },
  });
  assert.equal(ok.exitCode, 0);
  assert.match(ok.info.join('\n'), /C4 视图中 1 处均指向真实文件/);

  const bad = check('# Backlog\n', {
    files: {
      'md-studio/src/main/short.ts': 'a\nb\n',
      'docs/architecture/C1-context.md': '# C1\n\n`src/main/short.ts:99`。\n',
    },
  });
  assert.equal(bad.exitCode, 1);
  assert.match(bad.errors.join('\n'), /该文件只有 2 行/);
});

test('编号出现在普通段落、代码块或表格非首列时不计入条目数', () => {
  const report = check(
    [
      '# Backlog',
      '',
      '历史讨论中曾出现 B5-1、B5-1 这样的编号。',
      '',
      '```text',
      'B6-1',
      'B6-1',
      '```',
      '',
      '| ID | 备注 |',
      '|---|---|',
      '| B1-1 | 参见 B5-1 与 B6-1 |',
      '',
    ].join('\n'),
  );

  assert.deepEqual(duplicateWarnings(report), []);
  assert.match(report.info.join('\n'), /Backlog：1 个条目/);
});
