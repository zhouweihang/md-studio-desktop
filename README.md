# MD-Studio Desktop

本地优先的 Markdown 编辑器桌面应用：Electron + CodeMirror 6，Windows / macOS / Linux 三端。

> 发布名称是 **md-studio-desktop**（仓库、包名、安装包一致），与 GitHub 上其它同名项目无关。
>
> `md-studio/` 由维护者从上游开发仓库同步生成（见 ADR-003），请勿在该目录直接提交改动；需要修改请先开 issue 讨论。

## 功能

- **实时预览编辑**：光标所在块显示源码，其余块渲染为排版结果；装饰只做投影，不改文档偏移。
- **语法与元素**：GFM 表格（含行列操作与对齐）、任务列表、脚注、定义列表、KaTeX 公式、Mermaid 图表、图片粘贴/拖拽落盘、54 种代码语言高亮。
- **工作区**：文件树、文件名与内容搜索（有界并发 + 正文缓存）、大纲、历史版本。
- **多标签与恢复**：单窗口多标签、拖拽排序、5 s 自动保存、崩溃恢复草稿、外部变更冲突提示。
- **主题**：内置明暗主题、用户主题热加载（CSS 变量契约 `--md-*`）。
- **导出**：HTML、PDF（打印栈，中文不乱码）、图片；Pandoc 互操作（检测到 pandoc 时可用）。
- **界面**：简体中文 / English 切换，菜单、快捷键、命令面板同源。

## 快速开始

需要 Node.js ≥ 22.12。

```bash
npm --prefix md-studio install
npm --prefix md-studio run dev
```

## 验证

```bash
npm --prefix md-studio run typecheck   # 主进程 + 渲染层两套 tsconfig
npm --prefix md-studio test            # Vitest
npm --prefix md-studio run test:e2e    # Playwright + Electron（先构建）
npm --prefix md-studio run build
```

## 打包

```bash
npm --prefix md-studio run dist:win     # NSIS 安装包（Windows）
npm --prefix md-studio run dist:mac     # dmg + zip（须在 macOS 上执行）
npm --prefix md-studio run dist:linux   # AppImage + deb（须在 Linux 上执行）
```

产物在 `md-studio/release/`。Electron 应用**不能跨系统打包**，因此 `.github/workflows/package.yml` 用 Windows / macOS / Linux 矩阵分别构建；推送 `v*` tag 时自动汇总三端产物发布 Release，其余情况可在 Actions 里手动触发、下载 artifact。

首次在本地打包若下载 Electron/NSIS 二进制超时，可设置镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm --prefix md-studio run dist:win
```

## 工程文档

`docs/` 保留了设计与验收记录，便于接手：

- `docs/rfc/` — 需求（REQ 编号）与验收结论
- `docs/adr/` — 技术选型决策
- `docs/architecture/` — C4 视图（C1/C2/C3，路径与符号随代码回填）
- `docs/specs/`、`docs/plans/` — 实现快照与计划（历史记录，保留当时语境）
- `docs/backlog.md` — 未完成项与决策
- `docs/analysis/` — 互操作性研究记录（不含、也不研究任何授权/DRM 机制）

文档门禁（无需安装依赖）：

```bash
node scripts/check-eng-docs.cjs          # 检查命名、编号、头字段、被忽略的 .md、C4 源码路径
node scripts/check-eng-docs.cjs --json
node --test scripts/check-eng-docs.test.cjs
git config core.hooksPath .githooks      # 可选：提交前自动跑上面两条
```

## 许可

**Apache-2.0** —— 允许商用、修改、再分发。分发（源码或二进制、修改与否）时必须：

1. 保留 `LICENSE` 与 `NOTICE` 两个文件；
2. 保留 `NOTICE` 中的版权与项目署名；
3. 修改过的文件需注明「已修改」（Apache-2.0 §4(b)）。

即：可以拿去商用，但**必须注明本项目**（MD-Studio Desktop / zhouweihang）。完整条款见 [LICENSE](LICENSE)。
