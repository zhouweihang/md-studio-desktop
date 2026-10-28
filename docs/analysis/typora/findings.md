# Typora 逆向分析发现与证据底账

> Status: Active | Created: 2026-10-27 | Updated: 2026-10-27 | 工具：REA v6.8.0（`npx -y rea-agents@latest`，Node v24.22.1）
> 目标：Typora 1.14.10（Windows，winget `appmakes.Typora`；安装目录 `D:\typora文本软件\Typora`）
> 用途：MD-Studio 设计（RFC-001 / ADR-001 / ADR-002 / `docs/architecture/`）的证据底账；本文件只记录**经分析核实的事实**，未验证的推测另行标注。

## 1. 方法与范围

- 使用 REA 的 `analyze-javascript-application` 对 Typora 的 Electron 产物做**静态**分析（不运行目标、不做运行时捕获）。
- 每个目标产出两类归档：`*.summary.json`（摘要，入库）与 `evidence-*`（完整 Evidence 卷，约 300 MB，已 gitignore）。
- 对 ASAR 的文件清单使用 `@electron/asar list` 补充核实；对 Typora 自带 `Docs/` 做功能面提取（只提取与归纳，不复制原文）。
- **明确排除**：许可/激活相关组件（`license-gen.exe`、`node_inject.exe`、`License Agreement` 等）不分析、不复刻；不寻求任何绕过授权验证的路径。

## 2. 目标结构总览（已核实）

`resources/` 是当前版（1.14.10）的 Electron 资源根：

| 产物 | 事实 | 职责推断（已核实依据） |
|---|---|---|
| `app.asar` | 仅 3 个条目：`launch.dist.js`（1,383 B）、`atom.compiled.dist.jsc`（388,344 B）、`package.json` | 引导器 + V8 字节码。`launch.dist.js` 注册 `Module._extensions[".jsc"/".cjsc"]`，用 `vm.Script` + `cachedData` 执行字节码。**当前版主进程无 JS 源码可静态恢复** |
| `lib.asar` | 8.0 MB，26 个条目、10 个 JS 被解析、17 个模块 | 渲染层/编辑器依赖：`codemirror/mode.min.js`、`MathJax4/*`、`diagram/mermaid*.js`、`jimp/browser`、`pdf/pdf-lib.min.js` + `pdf/pdf-designer.min.js`、`aws-sdk.min.js`、`image-worker.js`、`bootstrape/*` |
| `appsrc/` | 3 个文件：`window/frame.js`、`editor/EmojiSearchMap.js`、`finder-worker.js` | 窗口接线脚本；`window.html` 直接引用 `./appsrc/window/frame.js` |
| `page-dist/` | 27 个文件（CRA 构建：`Preferences`/`WelcomeIndex`/`LicenseIndex`/`localSettingIndex` chunk、`service-worker.js`） | 偏好设置、欢迎页、本地设置等 Web 页面 |
| `node_modules.asar` + `node_modules/` | 第三方依赖（`adm-zip`、`chokidar`…）+ 原生模块（`cld`、`fswin`、`spellchecker`、`vscode-ripgrep`、`native-reg`、`main.node`） | 文件监听、压缩、拼写检查、全文检索、语言识别、注册表等平台能力 |
| `style/` | `themes/`：`github`、`newsprint`、`night`、`pixyll`（目录）+ `github.css`、`newsprint.css`、`night.css`、`pixyll.css`、`whitey.css` + `Readme.md` | 主题系统：内置主题为 CSS 文件，`Readme.md` 明确"内置 CSS 在更新/重装后会被替换，勿改" |
| `window.html` | 91,770 B | 主窗口骨架；含 `file-library*`（文件树）、`filesearch*`、`outline` 相关控件、`footer-word-count*`、`export-process-dialog`、`about-dialog`、`spell-check` 等元素 id |
| `html/` | `content.html`、`preview.html` | 内容/预览容器页 |
| `Docs/` | 17 份官方文档（Quick Start、Markdown Reference、Table Editing、Draw Diagrams、Custom Themes、Use Images、Auto Save…） | 功能面与行为的一手依据 |
| `locales/`、`updater/updater.html`、`packages/node-spellchecker` | 存在 | 国际化、更新器、拼写检查包 |
| `conf.default.json` | `defaultFontFamily`、`autoHideMenuBar`、`searchService`、`keyBinding`、`monocolorEmoji`、`maxFetchCountOnFileList`、`flags` | 高级用户配置面 |

**旧版内嵌参考**：`resources/app/` 是一套完整的 Typora **0.9.97**（`package.json` → `main: atom.asar/atom.js`，2020-12-09）。其 `atom.asar`（168 KB）无混淆，10 个模块：`atom.js`、`Desktop.js`、`Dict.js`、`DocumentController.js`、`Downloader.js`、`FilesOp.js`、`menu.js`、`Setting.js`、`updater.js`、`WindowController.js`。REA 在该产物上观察到：**4 个 BrowserWindow、21 项 webPreferences、114 个 IPC 操作，全部为字面量通道且均为 main handlers**。这是当前版主进程模块边界与 IPC 形态的**结构参考**（版本差异需注意，不作为当前版事实）。

## 3. 证据清单

| 目标 | SHA-256（前缀） | 摘要 | Evidence 卷 |
|---|---|---|---|
| `resources/app.asar` | `4dbee896…` | `app-asar.summary.json` | `evidence-app-asar`（0.5 MB） |
| `resources/lib.asar` | `f3cc1e8b…` | `lib-asar.summary.json` | `evidence-lib-asar`（209.8 MB，**分析受限**：`codemirror/mode.min.js` 触发 1 GiB 堆上限，图不完整） |
| `resources/appsrc/` | `133444c2…` | `appsrc.summary.json` | `evidence-appsrc`（58.4 MB） |
| `resources/app/atom.asar`（旧版 0.9.97） | `92ad3b59…` | `legacy-atom-asar.summary.json` | `evidence-legacy-atom-asar`（31.5 MB） |
| `resources/page-dist/` | — | `page-dist.timeout-error.json`（首次 300 s 超时）；`page-dist.retry1.summary.json`（二次 900 s 超时，同一文件） | 未归档语义证据（决策关闭，见 `docs/backlog.md` B1-1）；结构清单见 §2 |

## 4. 对 MD-Studio 设计有直接意义的事实

1. **编辑器栈**：CodeMirror 系（`lib.asar/codemirror`）+ MathJax4 + Mermaid + Jimp（图片）+ `pdf-lib`/`pdf-designer`（导出 PDF）。说明"文本编辑器内核 + 渲染扩展"是被验证过的路径。
2. **实时预览与源码同源**：Typora 的编辑窗口是单一 HTML 文档（`window.html` + `appsrc/window/frame.js`），编辑器即为窗口核心，而非"源码/预览双栏"。
3. **主进程职责集中在模块化单元**（旧版模块名可见）：窗口控制、文档控制、文件操作、设置、菜单、下载/更新、字典（拼写）。当前版以字节码发布，行为与接口只能通过其对外契约（文档、UI、渲染层调用）观察。
4. **IPC 面很大**（旧版 114 个通道）：文件读写/监听、设置、导出、拼写、字体、主题、搜索等几乎全部经主进程。MD-Studio 需要同样量级的**类型化 IPC 契约**，但设计为自有实现。
5. **主题 = CSS 文件 + 独立用户主题目录**；内置主题会被升级覆盖，因此用户定制必须落在用户目录。
6. **导出链**：`pdf-lib`/`pdf-designer` + `html/preview.html`、`export-process-dialog`，说明"HTML 渲染 → PDF 生成"是实际采用的路线；Pandoc 作为可选外部工具存在（`Docs/Install and Use Pandoc.md`）。
7. **平台能力清单**（原生依赖）：文件监听（chokidar）、原生文件系统属性（fswin）、全文检索（vscode-ripgrep）、拼写（spellchecker 包）、语言识别（cld）、机器标识（node-machine-id，**属授权/统计用途，不纳入设计**）。

## 5. 覆盖度与限制（如实记录）

- 静态分析不证明运行时行为；语义图中仍有大量 unknowns（lib.asar 88,240、appsrc 20,407、旧版 atom.asar 6,941），缺失事实不得解读为"不存在"。
- **当前版主进程为 V8 字节码**，静态不可读；如需其内部行为，只能走运行时捕获（REA `capture-electron-scenario` 等）——不在本阶段范围。
- `page-dist` 两次分析（300 s / 900 s 单源上限）均在 `static/js/0.99879679.chunk.js` 超时；未归档语义证据（分析预算的客观限制；文件清单与结构已核实）。
- `node_modules.asar` 仅做了包级清单，未做逐模块语义分析（backlog B1-2）。
- 未对 Typora 做任何 UI 像素级比对或自动化行为录制；行为依据来自 `Docs/` 与静态结构。

## 6. 范围声明

本项目的目标是以**自有代码**重写一个同类产品（MD-Studio）。分析仅用于理解行为、结构与产品能力边界；**不复用、不反编译复制其源码/样式/资源**。许可与激活机制不属于研究范围，也不在 MD-Studio 中实现任何绕过手段。
