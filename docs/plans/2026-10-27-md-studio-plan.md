# MD-Studio MVP 实现计划（2026-10-27）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. 若该技能不可用，按同等纪律手工执行：逐任务、先测试后实现、阻塞即停、收尾全量验证。
> 执行说明：本计划的实现已随 `98d3f6d` 入库；下文各 Task 的提交消息是执行前的预设模板，仅作记录，不代表逐条独立提交（实际为一次性提交，见 RFC-001 §8）。

**Goal:** 交付可运行的 MD-Studio 第一版：窗口 + CodeMirror 6 实时预览编辑 + 打开/保存/另存为（原子写）+ 明亮/暗色主题 + 字数统计；工程基线可构建、可测试。

**Status:** 已完成（2026-10-28，随 RFC-001 验收收尾）。Task 0–5 全部落地，验收结论与运行期修复清单见 `docs/rfc/RFC-001-md-studio.md` §6/§8；spec：`docs/specs/2026-10-27-md-studio-design.md`。下方各 Step 的勾选框保留计划原貌，未逐条回填。

> **实现落点注记（2026-10-28）**：下文 File Structure 里的 `src/renderer/editor.ts`、`src/renderer/main.ts` 是当时的单文件布局；实现拆为 `md-studio/src/renderer/editor/setup.ts`、`md-studio/src/renderer/app.ts` 等（见 `docs/architecture/C3-component.md`）。请勿照抄这些路径。

---

## File Structure

- Create: `md-studio/package.json`、`md-studio/electron.vite.config.ts`、`md-studio/tsconfig.json`、`md-studio/tsconfig.node.json`、`md-studio/tsconfig.web.json`、`md-studio/.gitignore`
- Create: `md-studio/src/shared/ipc.ts`、`md-studio/src/shared/text-stats.ts`
- Create: `md-studio/src/main/index.ts`、`md-studio/src/preload/index.ts`
- Create: `md-studio/src/renderer/index.html`、`styles.css`、`main.ts`、`editor.ts`、`env.d.ts`
- Create: `md-studio/tests/text-stats.test.ts`
- Modify: `docs/backlog.md`（B2-1/B2-2 闭环）、`docs/rfc/RFC-001-md-studio.md`（§0 进展）、`knowledge.md`（md-studio 命令）

---

### Task 0: 脚手架与依赖

**Files:** 上述配置六件 + `src/main/index.ts` / `src/preload/index.ts` / `src/renderer/*` 最小占位

- [ ] **Step 1**: 写 electron-vite 工程配置（CJS 输出；`main` 指向 `./out/main/index.js`）
- [ ] **Step 2**: `npm install` 依赖：devDeps `electron electron-vite vite typescript vitest @types/node @codemirror/state @codemirror/view @codemirror/language @codemirror/commands @codemirror/lang-markdown @lezer/highlight`；deps `zod`
- [ ] **Step 3**: 最小三端占位（空窗口 + 空页面），验证 `npm run build` 通过
- [ ] **Step 4**: 提交 — `chore(md-studio): scaffold electron-vite project`

### Task 1: 最小窗口与应用外壳

**Files:** `src/main/index.ts`（窗口 + 菜单 + 命令通道）、`src/renderer/index.html`、`styles.css`

- [ ] **Step 1**: 主进程：创建窗口（1080×720，`ready-to-show` 显示）、中文菜单（文件/编辑/视图：打开/保存/另存为/切换主题/源码模式/开发工具）、`menu:command` 下发
- [ ] **Step 2**: 渲染外壳：标题栏（文件名 + 脏标记）、编辑区容器、状态栏（字数/行列/模式/主题）
- [ ] **Step 3**: 验证：`npm run dev` 出现窗口，日志输出 `[md-studio] ready`（冒烟）
- [ ] **Step 4**: 提交 — `feat(md-studio): app shell with menu and command bridge`

### Task 2: 编辑器内核与实时预览 MVP（REQ-001 子集）

**Files:** `src/renderer/editor.ts`、`src/shared/text-stats.ts`、`tests/text-stats.test.ts`

- [ ] **Step 1**: 先写测试：`countText`（CJK 逐字、拉丁词、混排、空文本、阅读时间）
- [ ] **Step 2**: CM6 装配 + 装饰插件（按 spec §4.3 的规则：行装饰去重、活动判定、replace 范围校验）
- [ ] **Step 3**: 源码模式切换（Compartment reconfigure）；验证 `npm test`、`npm run typecheck`
- [ ] **Step 4**: 提交 — `feat(md-studio): codemirror editor with live preview decorations`

### Task 3: 打开 / 保存 / 另存为（REQ-009 子集）

**Files:** `src/shared/ipc.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/main.ts`

- [ ] **Step 1**: IPC 契约落地（zod 校验 + 原子写 + 错误向上抛）
- [ ] **Step 2**: 渲染层命令接线（打开加载/保存写回/脏标记清除/标题更新）
- [ ] **Step 3**: 验证：打开示例 md 编辑后保存，磁盘内容与编辑器一致（手动冒烟 + 日志）
- [ ] **Step 4**: 提交 — `feat(md-studio): open/save with atomic writes`

### Task 4: 主题与状态栏（REQ-012/013 子集）

**Files:** `src/renderer/styles.css`、`src/renderer/main.ts`

- [ ] **Step 1**: 明亮/暗色变量表 + `html[data-theme]` 切换 + localStorage 记忆
- [ ] **Step 2**: 状态栏实时统计（字数/字符/行数/阅读时间）+ 光标行列
- [ ] **Step 3**: 验证：切换主题无闪烁；输入时统计实时更新
- [ ] **Step 4**: 提交 — `feat(md-studio): theme toggle and status bar`

### Task 5: 全量回归 + 文档回写

- [ ] **Step 1**: `npm --prefix md-studio run typecheck && npm --prefix md-studio test && npm --prefix md-studio run build`
- [ ] **Step 2**: `npm --prefix md-studio run dev` 启动冒烟并保持窗口可用
- [ ] **Step 3**: 文档：RFC-001 §0 追加进展；backlog 关闭 B2-1/B2-2；`knowledge.md` 增补 md-studio 命令
- [ ] **Step 4**: 提交 — `docs: record md-studio mvp milestone`

---

## Self-Review

- **与设计一致性**：IPC 契约/装饰规则/变量契约为 spec §4 的直接落地；偏差（sandbox、localStorage、装饰子集）已在 spec §4.5 记录，无需另开文档。
- **风险与兜底**：electron 二进制下载失败 → 设 `ELECTRON_MIRROR` 重试（npmmirror）；装饰重叠报错 → 已按去重与范围校验规避；dev 启动失败 → 先 `build` 后用 `preview` 复现。
- **回归**：Task 5 的四条命令全部通过才算完成；冒烟以「窗口出现 + 可输入 + 快捷键打开/保存成功」为准。
