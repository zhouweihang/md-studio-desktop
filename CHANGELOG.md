# 变更记录

本文件记录 MD-Studio Desktop 的用户可见变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵守 [语义化版本](https://semver.org/lang/zh-CN/)。版本号以 `md-studio/package.json` 为准，
发布产物见 [Releases](https://github.com/zhouweihang/md-studio-desktop/releases)。

## [Unreleased]

### 变更

- 打包接入代码签名与公证：macOS 用 Developer ID + 硬化运行时 + `notarytool` 公证，Windows 支持 Azure Trusted
  Signing 或 `.pfx` 证书；未配置密钥时仍会产出未签名安装包，并在 CI 的 Job Summary 里标明（ADR-004）。
  当前正式产物尚未配置密钥，仍会看到 Gatekeeper / SmartScreen 提示。

## [0.1.0] - 2026-10-28

首个公开版本，提供 Windows / macOS / Linux 三端安装包。

### 新增

- **实时预览编辑**：光标所在块显示源码，其余块渲染为排版结果；装饰只做投影，不改文档偏移，撤销与输入法组合不受影响。
- **Markdown 能力**：GFM 表格（行列操作、对齐）、任务列表、脚注、定义列表、KaTeX 公式、Mermaid 图表、
  图片粘贴与拖拽落盘、54 种代码语言高亮。
- **工作区**：文件树、文件名与内容搜索（有界并发 + 正文缓存）、大纲、历史版本；目录变更由文件监听实时同步。
- **多标签**：单窗口多标签、拖拽排序、5 s 自动保存、崩溃恢复草稿、外部变更冲突提示。
- **主题**：内置明暗主题，用户主题 CSS 热加载（变量契约 `--md-*`）。
- **导出**：HTML、PDF（走打印栈，中文不乱码）、图片；检测到 Pandoc 时可互操作。
- **界面**：简体中文 / English 切换，菜单、快捷键与命令面板同源。

### 已知限制

- **安装包未签名**：Windows 会提示“未知发布者”，macOS 首次打开需要在“系统设置 → 隐私与安全性”里放行。
  签名与公证的接入已完成，待维护者配置证书后生效。
- 不支持把标签拖出窗口成为独立窗口。
- 中文输入法的候选窗定位、双拼/五笔切换仍依赖人工回归（自动化已覆盖上屏、全角标点、组合中撤销等路径）。

[Unreleased]: https://github.com/zhouweihang/md-studio-desktop/compare/v0.1.0...main
[0.1.0]: https://github.com/zhouweihang/md-studio-desktop/releases/tag/v0.1.0
