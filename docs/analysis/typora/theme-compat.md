# Typora 主题格式兼容性：一页结论（B1-6）

> Status: Decided | Created: 2026-10-28 | 关联：RFC-001 §4.5（主题系统）、`docs/backlog.md` B1-6、`docs/analysis/typora/findings.md` §2/§4.5
> 结论：**不提供「导入 Typora 主题」的格式转换器**，改为提供「自有主题变量契约 + 起手模板」。理由与替代方案见下。

## 1. 事实（来自已归档的分析证据）

| 事实 | 依据 |
|---|---|
| Typora 的主题就是纯 CSS 文件，放在安装目录 `style/themes/*.css`，用户主题另有一份 | `findings.md` §2 `style/` 行 |
| 内置主题在更新/重装时会被覆盖，官方 Readme 明确"勿改内置 CSS" | `findings.md` §2 / §4.5 |
| 主题 CSS 的作用对象是 Typora 自己的 DOM（`#write`、`.md-fences`、`.CodeMirror` 等）与它自己的变量 | Typora 官方 *Custom Themes* 文档 + `window.html` 元素 id 清单（`findings.md` §2） |
| MD-Studio 的主题契约是自有变量（`--md-color-*`、`--md-font-*`、`--md-space-*`）+ 元数据注释头 | RFC-001 §4.5 |

## 2. 为什么不写转换器

1. **选择器无法机械映射**：Typora 主题大量规则挂在 `#write`、`.md-fences`、`.CodeMirror-line` 这类"它自己的 DOM 结构"上；我们的实时预览是 CodeMirror 6 装饰 + 自有 widget。映射表可以覆盖 60% 的通用排版规则，剩下的会给用户"看起来像、细节错"的半成品——比明确不支持更糟。
2. **变量不是同名约定**：Typora 主题里既有官方变量，也有作者硬编码的颜色/字号/行高。要还原外观就得**逐个规则做语义翻译**，那是"移植一个主题"的工作量，不是格式转换。
3. **许可与分发**：多数第三方主题没有明确再分发许可；把转换后的产物内置进产品有风险。我们的主题目录只加载用户本地文件，不随产品分发，这条底线要保持。
4. **收益/成本不划算**：目标用户（中文写作场景）对主题的需求集中在"暗色/护眼/等宽/衬线"几类，由内置双主题 + 变量契约已能覆盖；真正想深调的用户直接写我们格式的 CSS 更快。

## 3. 替代方案（已落地）

- **变量契约公开**：`--md-color-*`（文字/背景/边框/强调）、`--md-font-*`（UI/正文/等宽）、`--md-space-*`，导出件复用同一套变量，改主题即改导出外观（RFC-001 §4.5）。
- **用户主题目录 + 热加载**：`userData/themes/*.css`，头部元数据 `/* mdstudio-theme: name=… mode=light|dark */`，监听 300 ms 去抖热加载，解析失败回退内置并提示。
- **起手模板**（复制即用，替换颜色即可得到新主题）：

```css
/* mdstudio-theme: name=我的主题 mode=light */
:root {
  --md-color-ink: #1f2328;
  --md-color-ink-secondary: #57606a;
  --md-color-paper: #ffffff;
  --md-color-paper-alt: #f6f8fa;
  --md-color-line: #d0d7de;
  --md-color-accent: #0969da;
  --md-font-ui: "Microsoft YaHei", system-ui, sans-serif;
  --md-font-body: "Noto Serif SC", Georgia, serif;
  --md-font-mono: "JetBrains Mono", Consolas, monospace;
}
```

## 4. 重新评估的触发条件

只有出现下面任一情况才值得回头做转换器：

- 有 ≥5 个用户明确要求迁移特定主题（而不是"想要更多主题"）；
- 我们改成与 Typora 同构的 DOM（`#write` + `.md-fences`），使选择器映射变成恒等映射——这属于架构变更，需先走 ADR；
- 拿到可再分发的主题授权集合，且转换器只做"变量替换 + 选择器重写"两件事。

在此之前，把用户引导到"改变量"比给一个会错位的转换器更诚实。
