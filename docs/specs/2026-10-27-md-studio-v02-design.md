# MD-Studio v0.2 实现快照（扩展语法 / 交互 / 互操作 / Pandoc / 多标签 / i18n / 规模）

> 索引：`RFC-002` | 关联 REQ：REQ-016~REQ-035（全量） | 收益：把 v0.1 的「15 项需求」扩到「35 项需求全部可运行、可验证」，并把 RFC-001 遗留的规模与质量项收尾
> 位置：本文档为实现快照；权威见 `docs/rfc/RFC-002-md-studio-full-feature.md`；实现计划见 `docs/plans/2026-10-27-md-studio-v02-plan.md`
> 前置：`docs/specs/2026-10-27-md-studio-full-design.md`（v0.1 全量快照）；本轮 §5 的三项偏差（多标签、i18n、规模）全部闭环

## 1. 需求落地映射

| REQ | 落地方式（关键实现） | 验证入口 |
|---|---|---|
| REQ-016 扩展语法 | `shared/extended-syntax.ts` + `renderer/editor/markdown-syntax.ts`（Lezer `MarkdownConfig`：高亮/上下标/脚注/定义列表）；装饰与导出共用同一扫描器 | `tests/editor/extended-syntax.test.ts` |
| REQ-017 front matter | `shared/front-matter.ts` + `FrontMatterWidget` 键值面板；导出写入 `title/author/description` meta | `tests/editor/front-matter.test.ts`、`tests/export/extended-export.test.ts` |
| REQ-018 HTML 净化 | `renderer/export/html-sanitize.ts`（标签/属性白名单，移除计数回调） | `tests/export/sanitize.test.ts` |
| REQ-019 Emoji | `shared/emoji.ts`（350+ 短代码）+ `setup.ts` 的 `:` 补全源 | `tests/editor/extended-syntax.test.ts` |
| REQ-020 目录 | `shared/toc.ts` + 「插入目录」命令 + 导出 `[TOC]` 展开（锚点与标题 id 同源） | `tests/shared/toc.test.ts` |
| REQ-021 右键菜单 | 主进程 `context-menu` 事件 → `shell/context-menu.ts`；条目全部走命令 id，标签取 `commands.ts` + `COMMAND_LABELS_EN` | `tests/editor/table-toolbar.test.ts` |
| REQ-022 打印 | 渲染层 HTML → 主进程隐藏窗口打印/`printToPDF` | E2E PDF 用例 |
| REQ-023 输入辅助 | `closeBrackets` + `markdownKeymap` + `defaultKeymap` + `indentWithTab` | `tests/editor/modes.test.ts` + E2E 输入 |
| REQ-024 表格工具条 | `editor/table-toolbar.ts`：光标在表格内浮出 7 个命令按钮，标签随语言变化 | `tests/editor/table-toolbar.test.ts` |
| REQ-025 视图控制 | `shared/view-controls.ts` + `settings.view`（缩放/全屏/置顶） | `tests/platform/view-controls.test.ts` |
| REQ-026 选中统计 | `shared/text-stats.ts` + 状态栏口径 | `tests/text-stats.test.ts` |
| REQ-027 导出补全 | 纯文本 / PNG / JPEG（隐藏窗口截图，超长分页） | `tests/export/export.test.ts` |
| REQ-028 剪贴板 | `clipboard:read/write` + `export/html-to-md.ts` + 复制富文本 | `tests/export/clipboard.test.ts` |
| REQ-029 文件操作 | 重命名/删除（回收站）/资源管理器定位；文件树右键与拖拽移动 | `tests/workspace/file-tree.test.ts` |
| REQ-030 版本快照 | `main/history.ts`（去重/50 份裁剪）+ `shared/diff.ts`（LCS 行级）+ 历史对话框 | `tests/workspace/history.test.ts`、`tests/shared/diff.test.ts` |
| REQ-031 Pandoc | `shared/pandoc-args.ts` + `main/pandoc.ts`（探测/导出/导入/失败清理） | `tests/export/pandoc.test.ts` |
| REQ-032 多标签页 | `renderer/session.ts`（`SessionPool`）+ `renderer/shell/tab-bar.ts` + `doc-manager.ts`（单 `EditorView` + 多 `EditorState`）；`settings.tabs` 启动恢复 | `tests/platform/tabs.test.ts` + E2E |
| REQ-033 i18n | `shared/i18n.ts`（键由 ZH 推导，EN 逐键校验）+ `renderer/i18n.ts`（`tr`/`cmdLabel`/`applyStaticTexts`）；`settings.language` 即时生效 | `tests/platform/i18n.test.ts` + E2E |
| REQ-034 规模 | `main/search.ts` 有界并发（8 路）+ 生成式 fixture 实测 | `tests/perf/scale.test.ts` |
| REQ-035 质量 | `shell/virtual-list.ts`；Mermaid widget 世代号重绘；`export/katex-fonts.ts` 字体内联；CDP IME 序列 | `tests/platform/virtual-list.test.ts`、`tests/export/inline-fonts.test.ts`、`tests/editor/mermaid.test.ts`、E2E IME |

## 2. 架构增量（相对 v0.1）

- **会话池取代单文档管理器**：`SessionPool` 持有 `Array<{ id, path, name, mtimeMs, dirty, state: EditorState, scrollTop }>`；`EditorView` 全局单实例，切换标签 = 先把 `view.state` + 滚动位置回存旧标签，再 `view.setState(新标签.state)`。撤销栈、选区随 `EditorState` 天然隔离，不需要任何手工快照。
- **标签栏是纯视图**：`shell/tab-bar.ts` 只读取 `SessionPool.metas()`，事件回调交给 `DocManager`（关闭/切换/右键），文案取自 i18n；溢出用横向滚动而非下拉，避免额外状态。
- **文档管理器保留原公开 API**：`save/saveAs/export*/renameFile/deleteFile/showHistory` 全部改为「作用于活动标签」，命令注册表因此零改动即可支持多标签；新增 `closeTab/closeOtherTabs/closeTabsToRight/restoreSession/loadWelcome`。
- **i18n 单点目录**：键集合由中文目录 `ZH` 推导（`UiKey = keyof typeof ZH`），英文目录标注为 `Record<UiKey, string>`，缺键直接是编译错误；命令标签仍是「中文来自命令表、英文来自目录」的双源约定，`cmdLabel()` 在渲染层统一取值。
- **静态文案数据化**：`index.html` 用 `data-i18n` / `data-i18n-title` / `data-i18n-placeholder` / `data-i18n-aria-label` 标注，`applyStaticTexts()` 一次刷全；动态视图（大纲/搜索/文件树/标签栏）各自实现 `render()` 供语言切换重绘。
- **虚拟列表抽成通用件**：固定行高 + 上下占位 + 视口窗口，大纲与搜索结果共用；`computeWindow()` 是纯函数（可直接测边界），DOM 部分只负责替换可视行。
- **搜索改有界并发**：先广度收集路径（跳过忽略目录、上限 20 万），再用 `min(8, cpus)` 个 worker 共享游标消费；分批推送、取消与截断语义保持原样。
- **KaTeX 字体内联按需加载**：`katex-fonts.ts` 用 Vite `?inline` 收集 15 个常用 woff2，`renderDocumentHtml` 在 `inlineMathFonts` 开启时**动态 import**，不开启时该 chunk 不进入主包。

## 3. 关键设计决策

1. **为什么用 `EditorState` 而不是多个 `EditorView`**：一个 `EditorView` 意味着 DOM、扩展配置、输入法状态只有一份；多实例会带来焦点争夺、装饰插件重复初始化与滚动同步问题。代价是切换时要重新 `applySettings`（模式/键位 compartment 重配），已封装在 `syncViewToActive()`。
2. **标签切换期间的 `switching` 闸门**：`view.setState()` 会触发 updateListener，若照常走 `markDirty()` 会把刚切换的干净标签标脏；用同步闸门吞掉这一次回调，再按标签自身状态回填脏标记。
3. **未命名/欢迎标签不进会话快照**：`settings.tabs` 只保存有路径的标签（`pickTabs` 丢掉 `{path:null,name:'未命名'}`），避免把无法还原的草稿内容写进设置；欢迎文档由此在下次启动时重新生成（按当前语言）。
4. **语言切换不只换文案**：`applyLocale()` 依次刷新静态文案、代码语言下拉、未命名标签名、文件树、大纲、搜索结果、标签栏与状态栏，保证「切换后无残留中文」。
5. **图表重绘靠 widget 世代号**：mermaid widget 增 `generation` 字段参与 `eq()`；切主题时 `invalidateMermaidCache()` 自增世代并 `dispatch({ selection })` 触发块装饰重建，同代码的图表因此不再复用旧 SVG。
6. **字体内联是选项不是默认**：默认关（导出体积优先），开启后报告增量；只内联常用字形，其余保留相对 URL 回退系统字体。

## 4. 设置与契约变化

- `settings.tabs = { open: TabSnapshot[], active: number }`（上限 32 项，非法项丢弃）。
- `settings.language: 'zh-CN' | 'en'`（非法值回退中文）。
- `settings.exportOptions.inlineMathFonts: boolean`（默认 `false`）。
- 新增命令 `tab.next` / `tab.prev`（`Ctrl+Tab` / `Ctrl+Shift+Tab`），`file.close` 语义改为「关闭当前标签」，窗口退出由菜单「退出」与关闭按钮承担。
- `file.new` 与 `file.newTab` 同义（都新建标签）。

## 5. 偏差与限制（诚实清单）

1. **IME 只做序列回归**：CDP `Input.imeSetComposition` 覆盖「组合中插入 → 提交」的路径，验证不崩溃、不丢字；候选窗定位、真实输入法手感仍需人工按 `docs/backlog.md` B5-2 的清单走一遍。
2. **虚拟滚动行高固定**：大纲 26 px、搜索 22 px；标题过长会省略显示（`text-overflow`），不做自动换行的高度测量。
3. **标签拖拽排序未实现**：`SessionPool.move()` 已提供能力，但本轮没有绑定拖拽手势（非目标：拖出为独立窗口）。
4. **导出字体内联只覆盖常用字形**：AMS/花体/尺寸 1–4/等宽/无衬线/正体粗斜体共 15 个 woff2；Fraktur、SansSerif 粗体等仍走相对 URL。
5. **搜索并发只并行文件读取**：目录遍历仍是单线程广度队列（避免 Windows 上大量 `opendir` 抖动）；10k 文件下实测 50 ms（文件名）/2.8 s（内容模式全量读文件）。
6. **语言目录不做复数/格位**：英文文案按单复数中性的写法落地（如 `{count} words`），不做 ICU MessageFormat。
7. **未命名标签在语言切换后改名**：仅当标签仍无路径且未修改；已编辑的未命名标签保留旧名。

## 6. 验证证据

| 项目 | 命令 | 结果 |
|---|---|---|
| 类型 | `npm --prefix md-studio run typecheck` | 0 错误（node + web 两套配置） |
| 单元/集成 | `npm --prefix md-studio test` | **35 文件 291 用例全过** |
| 端到端 | `npm --prefix md-studio run test:e2e` | **13 用例全过**（含多标签、会话恢复、语言切换含原生菜单、CDP IME、真实 `%PDF`） |
| 构建 | `npm --prefix md-studio run build` | 成功（main/preload/renderer 三端产物） |
| 规模 | `npx vitest run tests/perf/scale.test.ts` | 10k 文件搜索 47 ms 首结果 / 50 ms 全量；10k 行大纲 3.6 ms；1k 行代码块首帧 8.5 ms |
| 标签切换 | `npx vitest run tests/platform/tabs.test.ts` | 10 标签来回切换 8.9 ms（预算 100 ms） |
| 文档门禁 | `node scripts/check-eng-docs.cjs` | 通过（见 §7） |

## 7. 文档与追溯

- RFC-002 §6 已按 REQ 逐条回填实测值；本文档是同一轮的实现快照。
- `docs/backlog.md`：B4 五项收尾状态与新的 B5 区块（v0.2 遗留）已登记。
- `docs/rfc/RFC-001-md-studio.md` §7 已注记「多标签页 / Pandoc 互操作」由 RFC-002 显式解锁。

## 8. Self-Review

- **与 RFC/ADR 一致性**：进程边界（渲染层不触达 OS）、IPC zod 校验、变量契约（`--md-color-*`）均未改动；多标签与 i18n 完全落在渲染层与 `shared/`，主进程只新增 `settings` 字段与并发搜索。
- **测试策略**：纯函数（会话池、窗口计算、目录、diff、pandoc 参数）先测；UI 行为用 E2E 覆盖主路径（标签隔离/恢复、语言即时生效、IME 组合）；无法自动化的手感项如实列为人工清单。
- **遗留**：见 §5 与 `docs/backlog.md` B5。
