/**
 * 把主仓库的 `md-studio/` + `docs/` 同步到公开仓库 `md-studio-desktop`。
 *
 * 单一来源：主仓库。发布仓库是**生成物**，不要在里面直接改代码。
 * 发布仓库专属的文件（LICENSE / NOTICE / README / .gitignore / package.yml）放在
 * `scripts/publish-template/`，由本脚本覆盖进去。
 *
 * 用法：
 *   node scripts/publish-md-studio.cjs                # 生成 + 提交 + 推送
 *   node scripts/publish-md-studio.cjs --dry-run      # 只生成并报告差异，不提交
 *   node scripts/publish-md-studio.cjs --no-push      # 生成 + 提交，不推送
 *   node scripts/publish-md-studio.cjs --work-dir .publish/md-studio-desktop
 *
 * 前置：主仓库工作区干净（否则快照会混入未提交改动）。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REMOTE = 'https://github.com/zhouweihang/md-studio-desktop.git';
const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(__dirname, 'publish-template');

/** 不进入发布仓库的顶层条目（站点、agent 配置、会话数据、根级构建文件）。 */
const EXCLUDED = [
  '.agents',
  '.astro',
  '.freebuff',
  '.vscode',
  'AGENTS.md',
  'CLAUDE.md',
  'knowledge.md',
  'README.md',
  'astro.config.mjs',
  'bun.lock',
  'package.json',
  'public',
  'src',
  'tsconfig.json',
  '.gitignore',
  '.github/workflows/deploy.yml',
];

/** 发布后必须不存在的路径（防止 AI 会话/站点文件混入）。 */
const FORBIDDEN = [
  '.agents',
  'CLAUDE.md',
  'AGENTS.md',
  'knowledge.md',
  '.freebuff',
  'src',
  'public',
  'astro.config.mjs',
  'node_modules',
  'md-studio/node_modules',
  'md-studio/out',
  'md-studio/release',
];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const DRY_RUN = flag('--dry-run');
const NO_PUSH = flag('--no-push');
const WORK_DIR = path.resolve(ROOT, value('--work-dir', '.publish/md-studio-desktop'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? ROOT, encoding: 'utf8' });
  if (!options.allowFail && result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} 失败（${result.status}）：${detail}`);
  }
  return result;
}

function git(args, options = {}) {
  return run('git', args, options);
}

function removeIfExists(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyDir(source, target);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
}

// ---- 1. 前置检查 ------------------------------------------------------------

const dirty = git(['status', '--porcelain']).stdout.trim();
if (dirty && !DRY_RUN) {
  console.error('主仓库工作区不干净，先提交再发布：\n' + dirty);
  process.exit(1);
}

const mainSha = git(['rev-parse', 'HEAD']).stdout.trim();
console.log(`主仓库 HEAD: ${mainSha.slice(0, 7)}`);

// ---- 2. 准备发布仓库工作副本 ------------------------------------------------

if (!fs.existsSync(path.join(WORK_DIR, '.git'))) {
  if (DRY_RUN) {
    console.error(`工作副本不存在：${WORK_DIR}\n先执行一次不带 --dry-run 的同步来克隆。`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(WORK_DIR), { recursive: true });
  console.log(`克隆发布仓库 → ${path.relative(ROOT, WORK_DIR)}`);
  git(['clone', '--quiet', REMOTE, WORK_DIR], { cwd: path.dirname(WORK_DIR) });
} else if (!DRY_RUN) {
  const fetched = git(['fetch', '--quiet', 'origin', 'main'], { cwd: WORK_DIR, allowFail: true });
  if (fetched.status === 0) git(['reset', '--hard', '--quiet', 'origin/main'], { cwd: WORK_DIR });
  else console.warn('拉取远端失败，基于本地副本继续（推送时会重试）');
}

// ---- 3. 生成快照 ------------------------------------------------------------

for (const entry of fs.readdirSync(WORK_DIR)) {
  if (entry === '.git') continue;
  removeIfExists(path.join(WORK_DIR, entry));
}

// 逐个复制 HEAD 里的文件：干净工作区下，工作树内容 == HEAD。
// 不用 `git archive | tar`：Git Bash 自带的 GNU tar 会把 `C:\...` 当成远程主机。
const tracked = git(['ls-files', '-z']).stdout.split('\0').filter(Boolean);
for (const relative of tracked) {
  const source = path.join(ROOT, relative);
  if (!fs.existsSync(source)) continue; // 索引里存在但工作树已删除的极端情况
  const target = path.join(WORK_DIR, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

for (const entry of EXCLUDED) removeIfExists(path.join(WORK_DIR, entry));
copyDir(TEMPLATE_DIR, WORK_DIR);

const leaked = FORBIDDEN.filter((entry) => fs.existsSync(path.join(WORK_DIR, entry)));
if (leaked.length > 0) {
  console.error('发布目录里出现了不该发布的路径：' + leaked.join(', '));
  process.exit(1);
}

const fileCount = run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: WORK_DIR })
  .stdout.split('\n')
  .filter(Boolean).length;

// ---- 4. 提交（按需） --------------------------------------------------------

git(['add', '-A'], { cwd: WORK_DIR });
const staged = git(['diff', '--cached', '--quiet'], { cwd: WORK_DIR, allowFail: true });
const hasChanges = staged.status !== 0;

if (!hasChanges) {
  console.log('发布仓库已与主仓库一致，无需提交。');
  process.exit(0);
}

const changed = git(['diff', '--cached', '--stat'], { cwd: WORK_DIR }).stdout.trim();
console.log(`待同步改动：\n${changed}`);

if (DRY_RUN) {
  console.log(`\n[dry-run] ${fileCount} 个文件将提交到 ${path.relative(ROOT, WORK_DIR)}，未提交、未推送。`);
  process.exit(0);
}

// 新克隆没有本地身份配置，从主仓库读取后显式传给 commit
const authorName = git(['config', 'user.name'], { allowFail: true }).stdout.trim() || 'zhouweihang';
const authorEmail =
  git(['config', 'user.email'], { allowFail: true }).stdout.trim() || '3601486135@qq.com';

git(
  [
    '-c',
    `user.name=${authorName}`,
    '-c',
    `user.email=${authorEmail}`,
    'commit',
    '--quiet',
    '-m',
    `Sync from main@${mainSha.slice(0, 7)}\n\nGenerated by scripts/publish-md-studio.cjs from ${mainSha}.\nDo not edit md-studio/ here; change the main repository and re-run the script.`,
  ],
  { cwd: WORK_DIR },
);
const publishSha = git(['rev-parse', '--short', 'HEAD'], { cwd: WORK_DIR }).stdout.trim();
console.log(`已提交 ${publishSha}（${fileCount} 个文件）`);

// ---- 5. 推送（网络不稳时重试） ----------------------------------------------

if (NO_PUSH) {
  console.log('已跳过推送（--no-push）。');
  process.exit(0);
}

for (let attempt = 1; attempt <= 4; attempt += 1) {
  const pushed = git(['push', 'origin', 'main'], { cwd: WORK_DIR, allowFail: true });
  if (pushed.status === 0) {
    console.log(`已推送到 ${REMOTE}（main）`);
    process.exit(0);
  }
  const detail = (pushed.stderr || '').trim().split('\n').slice(-1)[0];
  console.warn(`第 ${attempt} 次推送失败：${detail}`);
  if (attempt < 4) run('sleep', ['10'], { allowFail: true });
}

console.error(`提交已在本地（${publishSha}），推送持续失败。网络恢复后执行：\n  git -C ${path.relative(ROOT, WORK_DIR)} push origin main`);
process.exit(1);
