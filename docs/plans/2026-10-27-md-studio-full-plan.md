# MD-Studio 全量功能实现计划（2026-10-27）

> **For agentic workers:** REQUIRED SUB-SKILL: 逐任务执行、先跑测试再收尾；阻塞即停、收尾全量验证（本轮已全部执行完毕，本文件登记执行结果）。
> 执行说明：本会话**不执行 git 提交**（用户未授权）；下列提交消息为预设，授权后照抄补交。

**Goal:** 把 RFC-001 的 REQ-001~015 从「MVP 子集」推进到全量可运行，并补齐单元测试与 Playwright-Electron 端到端验收。

**Status:** 已完成（2026-10-27）。快照见 `docs/specs/2026-10-27-md-studio-full-design.md`。

---

## 任务与结果

### Task 1: 共享层（契约/命令/键位/纯函数）
- 新增 `shared/commands.ts`（命令表）、`shared/keymap.ts` + `keymap/default.json`（B2-3 冻结）、`shared/settings.ts`（设置模型）、`shared/outline.ts`、`shared/math.ts`、`shared/table.ts`、`shared/theme-meta.ts`、`shared/paths.ts`、`shared/draft-id.ts`、`shared/markdown-scan.ts`、`shared/pdf-options.ts`、`shared/channels.ts`、`shared/ipc.ts`、`shared/api.ts`。
- 结果：`tsc -p tsconfig.node.json` / `tsconfig.web.json` 均 0 错误。
- 提交（预设）：`feat(md-studio): shared contracts, commands and keymap`

### Task 2: 主进程服务层
- 新增 `main/logger.ts`（按天日志）、`settings.ts`（去抖原子写）、`keymap-store.ts`（覆盖 + 冲突）、`fs-service.ts`（条件写入 + 冲突三选一）、`workspace.ts`（目录操作 + chokidar 监听 + 资产落盘）、`search.ts`（流式扫描）、`drafts.ts`（崩溃标记 + 草稿）、`themes.ts`（目录热加载）、`exporters.ts`（HTML 落盘 + printToPDF）、`menu.ts`（全量命令菜单）、`window.ts`（尺寸持久化 + 脏状态关闭确认）、`ipc.ts`（24 组通道）、`index.ts`（单实例 + 协议 + 启动编排）。
- 结果：主进程 typecheck 0 错误；`mdstudio-asset://` 协议仅服务图片扩展名。
- 提交（预设）：`feat(md-studio): main-process services (fs, workspace, search, drafts, themes, export)`

### Task 3: 预加载与安全基线（B3-2 闭环）
- `preload/index.ts` 全量白名单桥接（零 node 依赖，兼容沙箱）；`webPreferences` 启用 `sandbox: true`。
- 结果：E2E 中 `window.mdstudio` 可用、无沙箱报错。
- 提交（预设）：`feat(md-studio): sandboxed preload bridge`

### Task 4: 渲染外壳
- `app.ts`（装配 + 命令注册 + 设置/主题同步 + 恢复对话框 + 拖拽打开）、`shell/file-tree.ts`、`shell/outline-view.ts`、`shell/search-view.ts`、`shell/dialogs.ts`（prompt/confirm/右键菜单/toast）、`index.html` 三页签骨架、`styles.css` 变量契约样式。
- 结果：dev 冒烟「渲染层就绪」；E2E 侧栏/状态栏断言通过。
- 提交（预设）：`feat(md-studio): shell with sidebar, outline, search and dialogs`

### Task 5: 编辑器能力
- `editor/setup.ts`（Compartment 化装配 + 粘贴/拖拽图片 + 键位）、`editor/live-preview.ts`（装饰引擎 + StateField 跨行块）、`editor/widgets.ts`（表格/公式/图表/图片/任务框/分隔线/语言 chip）、`editor/commands.ts`（格式/段落/表格命令）、`editor/modes.ts`、`editor/search.ts`、`editor/languages.ts`（57 语言）。
- 结果：单元测试覆盖装饰策略、语言解析、表格/公式/图表/图片；E2E 键盘命令（Ctrl+S / Ctrl+Shift+Y / Ctrl+/）通过。
- 提交（预设）：`feat(md-studio): live preview, code highlighting, tables, math, mermaid, images`

### Task 6: 自动保存 / 草稿恢复 / 导出
- `doc-manager.ts`（打开/保存/冲突/自动保存/草稿/外部变更/导出）+ 主进程草稿与 printToPDF。
- 结果：recovery 单测通过；E2E 导出 HTML/PDF 产物校验通过。
- 提交（预设）：`feat(md-studio): autosave, crash recovery and HTML/PDF export`

### Task 7: 测试与验收
- 单元：19 文件 151 用例（`tests/editor/*`、`tests/workspace/*`、`tests/theme/*`、`tests/export/*`、`tests/platform/*`、`tests/text-stats.test.ts`）。
- E2E：`e2e/app.spec.ts` 9 用例（启动、输入与撤销、打开→编辑→Ctrl+S 磁盘往返、主题切换、源码模式、导出 HTML、导出 PDF（`%PDF` 头校验）、工作区文件服务、键位与最近文件）。
- 命令：`npm --prefix md-studio run typecheck`（0 错误）、`npm test`（151 passed）、`playwright test`（9 passed）、`npm run build`（成功）、`npm run dev`（冒烟通过）。
- 提交（预设）：`test(md-studio): unit and electron e2e coverage`

### Task 8: 文档回写与门禁
- RFC-001 §0/§6/§8 更新；backlog B2-3/B3-1/B3-2/B3-3 闭环并新增 B4 区块；`knowledge.md` 增补命令与踩坑；`node scripts/check-eng-docs.cjs` 通过。
- 提交（预设）：`docs: record md-studio full-feature milestone`

---

## Self-Review

- **范围纪律**：本轮只实现 RFC-001 已登记的 REQ；未引入多标签、云同步、插件系统等非目标。
- **风险与兜底**：CM6 跨行替换限制（StateField 承载）、E2E 弹窗遮罩（`[hidden]` 覆盖）、Electron 二进制与 Playwright 安装均已固化到 knowledge.md。
- **遗留**：B4 区块 5 项 + 未提交的 git 提交集。
