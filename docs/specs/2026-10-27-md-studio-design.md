# MD-Studio MVP 实现快照（桌面编辑器域）

> 索引：`RFC-001` | 关联 REQ：REQ-001 / REQ-009 / REQ-012 / REQ-013（均为子集） | 收益：交付第一版可运行应用——打开/保存 Markdown、实时预览渲染、明亮/暗色主题、字数统计
> 位置：本文档为实现快照；权威见 `docs/rfc/RFC-001-md-studio.md`

> **实现落点注记（2026-10-28）**：文中 `src/renderer/editor.ts` 是当时「单文件编辑器」的设想，实际拆为 `md-studio/src/renderer/editor/setup.ts`、`live-preview.ts` 等模块（见 `docs/architecture/C3-component.md`）。本文保留为设计快照，路径不要照抄。

## 1. 需求（MVP 增量）

| 覆盖 REQ | 本阶段实现 | 不在本阶段 |
|---|---|---|
| REQ-001 | 标题（字号分级 + 隐藏 `#`）、粗体/斜体/行内代码 mark、引用条、列表标记隐藏；活动行回退源码 | 表格/公式/图表/图片 widget、代码块高亮、代码块样式 |
| REQ-009 | 打开文件（菜单 CmdOrCtrl+O）、保存（CmdOrCtrl+S）、另存为（CmdOrCtrl+Shift+S）；原子写入 | 文件树、目录监听、最近文件、外部变更检测 |
| REQ-012 | 字数/字符/行数/阅读时间 + 光标行列 | 大纲侧栏 |
| REQ-013 | CSS 变量契约 + 明亮/暗色切换（localStorage 暂存） | 用户主题目录热加载、内置主题打包 |

## 2. 现状根因

全新项目，无既有代码可改；勘察结论为「无」——因此本快照只记录**实现视角的增量**与陷阱，不重复 RFC 设计。参考证据：`docs/analysis/typora/findings.md`（结构参考，不复制实现）。

## 3. 总体设计

指向 RFC-001 §3（不变）。本阶段落地三个容器内的最小闭环：主进程外壳（窗口/菜单/IPC）、渲染外壳（标题栏/编辑区/状态栏）、编辑器内核（CodeMirror 6 + 实时预览装饰）。

## 4. 详细设计（实现增量）

### 4.1 工程基线

- 构建：`electron-vite`，**CJS 输出**（不使用 ESM preload，避免 sandbox/ESM 组合限制）；TypeScript 双 tsconfig（`tsconfig.node.json` 管 main/preload/shared，`tsconfig.web.json` 管 renderer/shared）。
- 测试：Vitest（纯函数优先，DOM 相关后续用 Playwright-Electron）。
- 包管理器：**npm**（Node 24 自带；B2-2 结论：不拆分独立仓库，MD-Studio 作为本仓库 `md-studio/` 子项目）。
- 规范化脚本：`dev` / `build` / `preview` / `typecheck` / `test`。

### 4.2 IPC 契约（`md-studio/src/shared/ipc.ts`）

- 通道：`file:open`（主进程弹对话框并读文件）、`file:save`、`file:save-as`、`menu:command`（主进程 → 渲染层单向事件）。
- 校验：写请求（`file:save`）与 `file:save-as` 载荷用 zod schema 在**主进程入口**校验后执行；共享类型同时供 preload 与 renderer 使用（type-only 导入）。
- 原子写：`写临时文件 → rename 覆盖`，避免半写状态。

### 4.3 编辑器装配与 MVP 装饰范围（`src/renderer/editor.ts`）

- 扩展：`history` / `keymap(default+history)` / `markdown()` / `drawSelection` / `highlightActiveLine` / `EditorView.lineWrapping` / 预览插件（Compartment 可切换源码模式）。
- 装饰规则（只做投影，不改文档偏移）：
  - 行装饰（标题/引用/列表）先收集进 `Map<pos, Set<class>>`，最后统一生成，避免同位置重复行装饰冲突。
  - 内联：`ATXHeading` → 行装饰 + 非活动时隐藏 `HeaderMark`（含尾随空格，`sliceString` 判定）；`StrongEmphasis`/`Emphasis`/`InlineCode` → mark；`ListMark`/`QuoteMark` → 非活动时 replace 隐藏。
  - 活动判定：选区与节点范围相交即视为活动（不隐藏标记）；replace 范围必须 `from < to`；全部装饰按 `from:to:class` 去重后交给 `Decoration.set(ranges, true)`。

### 4.4 样式与主题（`src/renderer/styles.css`）

- 变量：`--paper / --ink / --ink-2 / --muted / --line / --accent / --code-bg`；`html[data-theme="dark"]` 覆盖；编辑器排版用 `.cm-*` 类 + 自有 `.md-*` 装饰类。

### 4.5 MVP 偏差记录（诚实清单）

1. `sandbox: false`（CJS preload 稳定路径；后续 Task 收紧为 sandbox + 桥接白名单）。
2. 主题选择暂存 localStorage，未走主进程 `settings.json`（后续 Task 迁移）。
3. 装饰范围为子集（见 §1），widget 类渲染后续 Task。
4. 无文件树/自动保存/导出（后续 Task）；崩溃恢复未实现。
5. 未做 git 提交（用户未授权；计划中的提交消息为预设）。

## 5. Self-Review

- **与 RFC/ADR 一致性**：Electron 外壳（ADR-001）、CM6 内核（ADR-002）、IPC 命名与变量契约（RFC-001 §4.1/§4.5）一致；偏差已在 §4.5 记录，不留隐含矛盾。
- **回归验收**：`npm --prefix md-studio run typecheck`、`npm --prefix md-studio test`、`npm --prefix md-studio run build`、`npm --prefix md-studio run dev`（启动冒烟：窗口出现、可输入、装饰生效）。
