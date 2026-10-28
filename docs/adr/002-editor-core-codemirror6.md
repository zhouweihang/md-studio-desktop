# ADR-002: 编辑器内核选用 CodeMirror 6 + 实时预览装饰

> Status: Accepted | Date: 2026-10-27 | Deciders: AI 助理（Buffy，受用户委托） | 关联 RFC: RFC-001 §4.3 | 影响：决定编辑器文档模型、渲染方式、性能与扩展边界

> **实现落点注记（2026-10-28）**：文中 `src/renderer/editor/commands/` 是计划的命令目录，实际是单文件 `md-studio/src/renderer/editor/commands.ts`；组件与行号见 `docs/architecture/C3-component.md`。请勿照抄本文路径。

## Context

首批范围是「编辑器核心与实时渲染」。目标行为（Typora 式）：

- 单一视图内"边写边渲染"：标题/强调/列表/引用/代码块/表格/公式/图表直接以排版形态呈现，光标进入活动区域时局部露出 Markdown 源码。
- 文档源必须是 Markdown 文本本身（保存无损、可切换源码模式、导出与编辑同源）。
- 中文 IME 输入、选区、撤销栈必须正确；大文档输入要跟手。

参考事实（`docs/analysis/typora/findings.md` §4）：参考产品使用 CodeMirror 系内核并自行扩展，编辑窗口即主窗口（非双栏预览）；主题是 CSS，渲染层依赖 MathJax/Mermaid/Jimp/pdf 库。实现代码不可参考（主进程为字节码、内核为其自有分支），因此这里只对齐**能力目标**。

约束：不复制参考产品代码；扩展模型需可维护；维护者规模小。

## Decision

1. **内核**：CodeMirror 6（`@codemirror/state`、`@codemirror/view`、`@codemirror/language`、`@codemirror/commands`）；文档模型为纯 Markdown 字符串，**源文本是唯一事实源**。
2. **解析**：`@lezer/markdown` + GFM 扩展作为唯一增量解析器，同时服务装饰层、大纲、字数统计与导出前校验；不引入第二套编辑期解析器。
3. **实时预览**：通过 `ViewPlugin` + `Decoration`/`WidgetType` 实现——标题字号、强调样式、列表标记、引用条、代码块背景与高亮；图片/表格/公式/图表以原子 widget 替换渲染；光标所在"活动块"回退为源码可见（块级切换，不做逐字符露出）。
4. **复杂块策略**：表格 = 只读 widget + 编辑态切回 Markdown 文本；公式 = KaTeX（行内 `$$…$$`）；图表 = Mermaid（fence ```mermaid`）；代码高亮 = Shiki（构建期主题 JSON，渲染期按语言懒加载）；图片 = 本地路径解析 + 尺寸约束（Jimp 类能力由主进程提供缩略图/尺寸探测）。
5. **命令系统**：所有编辑操作注册为命令（`commands` + 自定义 keymap），菜单项、快捷键、命令面板共用同一注册表；命令定义集中在 `src/renderer/editor/commands/`。
6. **性能策略**：依赖 CM6 视口渲染与事务增量；widget 惰性挂载、离开视口销毁；装饰计算按变更范围裁剪（`ViewPlugin` 的 update 只处理受影响行区间）；单文档 > 5 MB 时降级为"块折叠 + 手动刷新"模式（可配置）。

## Alternatives

- **ProseMirror / Milkdown（富文本文档模型）**：文档模型不是 Markdown 文本，往返保真、源码模式、自定义方言映射成本高；否决。
- **双栏「源码 + 预览」**：实现最省力，但不符合"实时渲染"的首批目标；否决（可作为调试视图保留）。
- **自研 contenteditable/DOM 编辑器**：IME、选区、撤销、性能全部自担，风险不可接受；否决。
- **CodeMirror 5**：类型与插件现代化程度低、维护活跃度下降；否决。

## Consequences

- **正**：源码即文档，保存/导出/源码模式天然一致；IME 与选区行为由成熟内核兜底；扩展模型清晰，可按特性增量交付。
- **负**：widget 与装饰不能破坏文档偏移，光标/撤销需要专门用例覆盖；复杂块"只读 ↔ 编辑态"切换引入状态机复杂度。
- **风险**：超长文档的装饰重算可能抖动——由 RFC-001 REQ-001/REQ-012 的性能验收兜底；若实测不达标，按 §6 的降级策略处理，必要时再评估分段渲染。

## References

- `docs/analysis/typora/findings.md` §4.1、§4.2（CodeMirror 系内核、单视图结构）
- `docs/analysis/typora/lib-asar.summary.json`（CodeMirror/MathJax/Mermaid/Jimp/pdf 依赖事实）
- RFC-001 §4.3、§4.6；ADR-001
