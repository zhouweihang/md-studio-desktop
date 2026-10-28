# MD-Studio v0.2 功能全量补齐 实现计划（编辑器产品域）

> 索引：`RFC-002` | 关联 REQ：REQ-016~REQ-035 | 权威：`docs/rfc/RFC-002-md-studio-full-feature.md`
> 位置：本文档为实现计划；实现快照见 `docs/specs/2026-10-27-md-studio-v02-design.md`
> 前置：`docs/plans/2026-10-27-md-studio-full-plan.md`（RFC-001 轮）

> **实现落点注记（2026-10-28）**：下文列出的测试文件名是计划名，多数在实现时未按该文件名创建（用例按域组织，合并或改名）。实际用例清单见 `docs/architecture/C3-component.md` §5。

## 0. 执行约定

- 顺序：登记（本计划）→ 纯函数与语法层（Wave 1）→ 交互层（Wave 2）→ 互操作（Wave 3）→ Pandoc（Wave 4）→ 标签页与 i18n（Wave 5）→ 规模与质量（Wave 6）→ 验证与文档回写（Wave 7）。
- 每个 Wave 结束跑 `typecheck` + 相关 `vitest`；Wave 结束追加 E2E；全部结束后跑 `build` 与 `dev` 冒烟。
- 测试策略：纯函数（解析/生成/diff/净化/参数构造）先写测试；UI 行为以 E2E 覆盖主路径；无法自动化的项（真机 IME 手感）如实记录为人工清单。
- 提交消息预设（未提交，等待用户授权）：`feat(md-studio): v0.2 功能全量补齐（扩展语法/交互/互操作/pandoc/标签页/i18n）`。

## 1. Wave 1 — 扩展语法与文档结构（REQ-016~020）

| Task | 内容 | 验收入口 |
|---|---|---|
| T1-1 | `renderer/editor/markdown-syntax.ts`：Lezer `MarkdownConfig`（Highlight/Sub/Sup/Footnote/DefinitionList） | `tests/editor/extended-syntax.test.ts` |
| T1-2 | `shared/front-matter.ts` + 元数据面板 widget | `tests/editor/front-matter.test.ts` |
| T1-3 | `shared/html-sanitize.ts` + 导出 `html: true` 链路 | `tests/export/sanitize.test.ts` |
| T1-4 | `shared/emoji.ts`（≥300 短代码）+ `:` 自动补全 | `tests/editor/emoji.test.ts` |
| T1-5 | `shared/toc.ts` + 「插入目录」命令 + 导出 `[TOC]` 展开 | `tests/shared/toc.test.ts` |
| T1-6 | 实时预览装饰、大纲跳过 front matter/脚注、统计口径 | 既有 + 新增测试 |

## 2. Wave 2 — 编辑与交互（REQ-021~026）

| Task | 内容 | 验收入口 |
|---|---|---|
| T2-1 | 主进程 `context-menu` 事件 → 渲染层上下文菜单（命令同源） | `tests/editor/context-menu.test.ts` + E2E |
| T2-2 | 打印命令（Ctrl+P，系统打印对话框） | E2E |
| T2-3 | `closeBrackets` + `markdownKeymap` + 列表缩进 | `tests/editor/input-assist.test.ts` |
| T2-4 | 表格悬浮工具条 | `tests/editor/table-toolbar.test.ts` |
| T2-5 | 缩放/全屏/置顶命令与持久化 | `tests/platform/view-controls.test.ts` |
| T2-6 | 选中统计（状态栏） | `tests/text-stats.test.ts` |

## 3. Wave 3 — 文件与互操作（REQ-027~030）

| Task | 内容 | 验收入口 |
|---|---|---|
| T3-1 | 纯文本导出 + PNG/JPEG 导出（隐藏窗口截图） | `tests/export/image-export.test.ts` |
| T3-2 | 剪贴板读写 IPC + HTML→MD（turndown）+ 复制富文本 | `tests/export/clipboard.test.ts` |
| T3-3 | 重命名/删除/定位命令（标题栏与菜单） | `tests/workspace/file-ops.test.ts` |
| T3-4 | 版本快照服务 + `shared/diff.ts` + 历史对话框 | `tests/workspace/history.test.ts` |

## 4. Wave 4 — Pandoc 互操作（REQ-031）

| Task | 内容 | 验收入口 |
|---|---|---|
| T4-1 | `shared/pandoc-args.ts` + `main/pandoc.ts`（探测/导出/导入/失败清理） | `tests/export/pandoc.test.ts` |
| T4-2 | 菜单「导入」「导出」扩展 + 设置项 `pandoc.path` | E2E（无 pandoc 时的提示路径） |

## 5. Wave 5 — 多标签页与 i18n（REQ-032~033）

| Task | 内容 | 验收入口 |
|---|---|---|
| T5-1 | 会话池 + `EditorState` 切换 + 标签栏组件 | `tests/platform/tabs.test.ts` |
| T5-2 | 标签快捷键与启动恢复（`settings.tabs`） | E2E |
| T5-3 | `shared/i18n` 目录（zh-CN/en）+ 菜单与界面接线 | `tests/platform/i18n.test.ts` + E2E |

## 6. Wave 6 — 规模与质量（REQ-034~035）

| Task | 内容 | 验收入口 |
|---|---|---|
| T6-1 | 搜索有界并发 + 大纲增量 + 高亮缓存 | `tests/perf/scale.test.ts` |
| T6-2 | 通用虚拟列表（大纲/搜索/最近文件） | `tests/platform/virtual-list.test.ts` |
| T6-3 | 主题切换图表重绘 + KaTeX 字体内联选项 | `tests/editor/mermaid.test.ts`、导出测试 |
| T6-4 | IME 真机序列（CDP 合成组合事件）+ 人工清单 | E2E |

## 7. Wave 7 — 验证与文档回写

| Task | 内容 |
|---|---|
| T7-1 | `typecheck` / `vitest` / `playwright` / `build` / `dev` 冒烟全量回归 |
| T7-2 | 回填 RFC-002 §6 验收表；写 `docs/specs/2026-10-27-md-studio-v02-design.md` |
| T7-3 | `docs/backlog.md` 追加 B5 区块与 B4 收尾状态；更新 RFC-001 §7 非目标注记 |
| T7-4 | `node scripts/check-eng-docs.cjs` 门禁通过 |
