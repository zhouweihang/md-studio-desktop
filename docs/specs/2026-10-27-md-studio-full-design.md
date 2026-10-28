# MD-Studio 全量功能实现快照（编辑器产品域）

> 索引：`RFC-001` | 关联 REQ：REQ-001~REQ-015（全量） | 收益：把 P0 目标从「MVP 子集」推进到「15 项需求全部可运行、可验证」
> 位置：本文档为实现快照；权威见 `docs/rfc/RFC-001-md-studio.md`；实现计划见 `docs/plans/2026-10-27-md-studio-full-plan.md`
> 前置：`docs/specs/2026-10-27-md-studio-design.md`（MVP 快照，§4.5 的三项偏差在本轮全部闭环）

## 1. 需求（全量）

| REQ | 落地方式（关键实现） | 验证入口 |
|---|---|---|
| REQ-001 实时预览 | `editor/live-preview.ts`：装饰引擎覆盖标题（ATX/Setext）、强调、删除线、行内代码、链接（隐藏标记 + `data-href` 点击外开）、引用、列表标记、分隔线（hr widget）、任务框（可点击切换）、活动块回退源码 | `tests/editor/live-preview.test.ts` |
| REQ-002 围栏代码块 | `editor/languages.ts` 注册 **57 种语言**（官方 parser 14 + legacy 流式模式 43）；`markdown({ codeLanguages })` 提供嵌套高亮；围栏 chip 显示语言；状态栏语言选择器改信息串；导出侧 `export/highlight.ts` 内置 **46 种** hljs 语言 | `tests/editor/code-block.test.ts` |
| REQ-003 表格 | `shared/table.ts`（解析/序列化/CJK 显示宽度对齐/增删行列）+ `TableWidget` 可视渲染 + 段落菜单「表格操作」四个命令 | `tests/editor/table.test.ts` |
| REQ-004 数学公式 | `shared/math.ts`（行内/块级扫描、货币与转义误判规避、代码区跳过）+ `MathWidget`（KaTeX）；非法公式保留源码 + `.md-math-error` 标注 | `tests/editor/math.test.ts` |
| REQ-005 图表 | ```mermaid 围栏 → `MermaidWidget`（按主题分键缓存）；失败保留源码块 + 错误提示；导出时预渲染为 SVG | `tests/editor/mermaid.test.ts` |
| REQ-006 图片 | 剪贴板粘贴 / 拖拽（`webUtils.getPathForFile`）/ 选择文件三条来源 → `./assets` 落盘（重名自动编号）；`mdstudio-asset://` 协议渲染；缺失态占位提示 | `tests/editor/image.test.ts` |
| REQ-007 三种模式 | 源码模式（Compartment 重配置）、聚焦模式（非活动行 `md-dim`）、打字机模式（光标居中滚动）；三者状态经 `settings.json` 持久化 | `tests/editor/modes.test.ts` |
| REQ-008 中文 IME | 组合期间（`view.composing`）不重建装饰的判定被抽成 `shouldRebuild()` 并单测；插件在组合中一律跳过重建 | `tests/editor/ime.test.ts` |
| REQ-009 文件工作区 | 主进程 `workspace.ts`：目录列举（忽略 `node_modules/.git` 等、5000 项截断）、新建/重命名/删除（回收站）/移动（跨盘回退复制）、chokidar 监听去抖广播；渲染层 `shell/file-tree.ts` 懒加载树 + 右键菜单 + 拖拽移动；最近文件写入设置并出现在菜单；拖拽/命令行/第二实例打开 | `tests/workspace/file-tree.test.ts`、`tests/workspace/watch.test.ts` |
| REQ-010 自动保存与恢复 | 5 s 去抖自动保存（可配置 1–60 s）；草稿 `userData/drafts/<id>.json`（5 s 或 ≥2000 字符变更打点）；`session.json` 标记崩溃并在下次启动弹恢复对话框 | `tests/workspace/recovery.test.ts` |
| REQ-011 查找替换与文件夹搜索 | 文档内：`@codemirror/search` 面板 + F3/Shift+F3；文件夹：主进程流式扫描（文件名/内容两模式、二进制与大文件跳过、单文件 50 命中上限、总量 2000 截断、可取消），结果分批推送并支持点击跳转行 | `tests/workspace/search.test.ts` |
| REQ-012 大纲与统计 | `shared/outline.ts`（ATX+Setext、跳过围栏、行内标记清理）+ 侧栏大纲（点击跳转、当前章节高亮）；状态栏字数/行数/阅读时间/光标行列 | `tests/editor/outline.test.ts` |
| REQ-013 主题系统 | 内置明/暗主题 `themes/built-in/*.css`（`--md-color/font/space-*` 契约）；用户主题 `userData/themes/*.css` 元数据解析、体积上限、目录热加载、失败回退内置并状态栏提示；导出复用同一份 CSS | `tests/theme/theme.test.ts` |
| REQ-014 导出 | 渲染层 `export/render-html.ts`（markdown-it + GFM + 任务列表 + KaTeX + Mermaid 预渲染 SVG + hljs 高亮 + 主题内联）→ 主进程落盘 / 隐藏窗口 `printToPDF`（A4、页边距、页码页脚） | `tests/export/export.test.ts`、`tests/export/pdf.test.ts`、E2E 实测 `%PDF` |
| REQ-015 命令与键位 | `shared/commands.ts` 全量命令表 + `keymap/default.json` 默认键位（B2-3 冻结）+ `userData/keymap.json` 覆盖 + 冲突检测（菜单、CM keymap、命令注册表三者同源） | `tests/platform/keymap.test.ts`、E2E 键盘命令 |

## 2. 现状根因

MVP 已可运行，但 15 项需求中只有 4 项以子集形式落地；差距不是缺陷而是**尚未实现的能力面**（表格/公式/图表/图片/文件树/搜索/恢复/导出/键位）。因此本轮不再引入新架构，而是把 RFC-001 §3 的 C4 结构逐格填满，并为每个能力建立可执行验收入口。

## 3. 总体设计（相对 MVP 的增量）

- **进程边界**：渲染层仍不触达 OS；主进程新增四类服务——文件与工作区（`fs-service`/`workspace`/`search`）、设置与键位（`settings`/`keymap-store`）、主题目录（`themes`）、导出与恢复（`exporters`/`drafts`）；契约集中在 `src/shared/`（channels/zod/类型），预加载以白名单桥接暴露。
- **安全基线**：`sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`（B3-2 闭环）；本地图片经 `mdstudio-asset://` 特权协议读取（仅允许图片扩展名）。
- **预览引擎分层（关键修正）**：CM6 规定「ViewPlugin 不得提供跨行 replace 装饰」，因此跨行块级 widget（表格/图表/块级公式）由 **StateField** 提供，其余装饰（行内标记、行类、单行 widget、原子域）由 ViewPlugin 按视口计算，两者通过 `blockRanges` 协同原子区间。块级 StateField 以「文档包含 `|`/`$$`/`mermaid`」快速短路，避免大文档每次光标移动全树遍历。
- **设置单一真相**：`userData/settings.json`（窗口、视图、模式、主题、最近文件、自动保存）由主进程持有并广播，所有窗口订阅；`keymap.json` 与 `themes/*.css` 独立文件便于用户直接编辑。

## 4. 详细设计（实现增量）

### 4.1 IPC 面（24 个通道组）

文件（打开/读取/条件写入 + 冲突三选一/监听）、资源（base64 落盘/复制/选择）、工作区（列举/增删改移/资源管理器）、设置与键位、主题目录、草稿与恢复、搜索（start/cancel + batch/done 事件）、导出、应用控制（启动信息/新窗口/关闭确认/外链/日志）。所有写请求在主进程用 zod `safeParse` 校验。

### 4.2 编辑器命令与键位

默认键位表冻结于 `src/shared/keymap/default.json`（33 条，覆盖文件/编辑/段落/格式/视图/主题），`resolveKeymap()` 负责覆盖合并与冲突检测（同一组合由多命令占用即报告）。菜单项、CM keymap、命令注册表都从同一命令 id 出发：菜单加速键由 `toElectronAccelerator()` 生成，编辑器内由 `toCodeMirrorKey()` 生成。

### 4.3 保存与冲突

写入前比对 mtime（容差 2 ms），冲突时弹「重新载入 / 另存为 / 强制覆盖 / 取消」；外部修改在文档干净时自动重载、脏时询问。崩溃恢复走 `session.json` + 草稿目录，正常退出清标记。

### 4.4 导出

HTML：正文渲染在渲染层完成后交主进程落盘（自包含：主题 CSS + KaTeX CSS 内联、代码高亮、Mermaid SVG、图片保留相对路径）。PDF：主进程用隐藏 `BrowserWindow` 加载临时 HTML（无脚本）→ 等 `document.fonts.ready` → `printToPDF`（A4、0.6/0.75/0.75/0.75 英寸边距、页码页脚）。

### 4.5 本轮修复的真问题（E2E/运行验证产出）

1. **对话框遮罩挡住整个界面**：`#dialog-layer { display: flex }` 覆盖了 `hidden` 属性 → 补 `[hidden] { display: none }`。若无 E2E，应用在人工点击时才会暴露。
2. **跨行 replace 崩溃**：表格/图表/块级公式最初由 ViewPlugin 提供跨行替换 → CM6 抛 `RangeError` → 改为 StateField 承载（§3）。
3. **预览插件初始化顺序**：编辑器构造期即读取 `docDir`，此时文档管理器尚未赋值 → 引入持有者（`docManagerRef`）避免 TDZ。
4. **vitest 误收集 e2e**：`e2e/app.spec.ts` 被 vitest 当作测试文件并触发上级 tsconfig 解析失败 → 新增 `vitest.config.ts` 只收 `tests/**`。

## 5. 偏差与限制（诚实清单）

1. 搜索为**线性扫描**：单文件上限 2 MB、总量 2000 命中截断；10k 文件目录的性能目标（RFC §1）本轮只在 2000 文件规模实测（首结果 <1.5 s、全量 ~1.6 s），10k 级实测列入 B4。
2. 搜索/大纲/文件列表为线性渲染，命中 >500 条时截断显示（虚拟滚动列入 B4）。
3. 导出件的 KaTeX 字体未内联（依赖系统字体回退以保证体积）；如需像素级公式字体，见 B4。
4. Mermaid 缓存按主题分键；切换主题后已渲染图表需滚动/编辑后重绘（列入 B4）。
5. 用户主题校验为「元数据 + `--md-color-*` 存在性 + 512 KB 上限」，CSS 规则级语法错误由 Chromium 静默丢弃，不做失败回退判定。
6. 粘贴/拖拽图片要求文档已保存（相对路径需要文档目录）；未保存时状态栏提示。
7. 每窗口一文档（多标签仍是非目标）；第二实例的参数文件转交给已有窗口打开。
8. 未做 git 提交（用户未授权），提交消息与提交集登记在计划中预留。

## 6. Self-Review

- **与 RFC/ADR 一致性**：进程边界、IPC 校验、变量契约、导出链路均按 RFC §4 落地；偏差已在上节逐条记录，不留隐含矛盾。
- **回归证据**：`typecheck` 0 错误；`vitest` 19 文件 151 用例全过；`playwright` 9 用例全过（含真实 `printToPDF` 产物 `%PDF` 校验、Ctrl+S 磁盘往返、键盘主题/源码模式）；`build` 成功；dev 启动冒烟输出「[md-studio] ready / 渲染层就绪」。
- **遗留**：B4 区块 5 项（见 `docs/backlog.md`）。
