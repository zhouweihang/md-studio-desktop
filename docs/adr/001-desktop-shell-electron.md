# ADR-001: 桌面应用框架选用 Electron

> Status: Accepted | Date: 2026-10-27 | Deciders: AI 助理（Buffy，受用户委托） | 关联 RFC: RFC-001 §4.1 | 影响：决定运行单元、进程边界、打包与平台能力路径

> **实现落点注记（2026-10-28）**：文中 `src/...` 是设计期的计划路径。协议契约实际是单文件 `md-studio/src/shared/ipc.ts`（不是 `src/shared/ipc/` 目录），容器划分见 `docs/architecture/C2-container.md`。请勿照抄本文路径。

## Context

MD-Studio 的目标是 Windows 优先的桌面 Markdown 编辑器，对标 Typora 1.14.10 的使用形态：本地文件与目录、实时预览编辑、主题系统、HTML/PDF 导出。逆向分析（`docs/analysis/typora/findings.md` §2）确认参考产品为 Electron 应用（`app.asar` + `lib.asar` + Chromium 渲染 + PDF 生成链），但**当前版主进程以 V8 字节码发布**（`app-asar.summary.json`：`launch.dist.js` 注册 `.jsc` 加载器执行 `atom.compiled.dist.jsc`），因此只能借鉴其能力边界与模块划分，不能复用任何实现。

需要框架提供的能力：

1. 本地文件系统访问、目录递归监听（文件树/外部变更/自动保存）。
2. 原生菜单、快捷键、系统对话框、单实例与多窗口。
3. 系统剪贴板（富文本/图片粘贴）、拼写检查、打印与 PDF 输出。
4. 可生成 Windows 安装包并可扩展到 macOS/Linux。

约束：不复制参考产品的代码/样式/资源；离线优先；中文优先 UI；开发环境为 Windows + Node.js 24（与 REA 分析环境一致）；维护者规模小，需成熟生态降低成本。

## Decision

1. **运行时**：Electron（锁定单一主版本，季度评审升级），Windows 优先发布，macOS/Linux 作为后续目标。
2. **语言与构建**：全栈 TypeScript；使用 `electron-vite` 统一构建 main / preload / renderer 三个入口；Node.js ≥ 22。
3. **进程边界**：主进程持有全部 OS 能力（文件、监听、导出、菜单、设置存储）；渲染进程 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`；预加载脚本仅通过 `contextBridge` 暴露命名空间化 API（`window.mdstudio.*`），每个通道有 TypeScript 类型与运行时参数校验。
4. **IPC 契约**：以「通道名 + 请求/响应 zod schema」集中定义在 `src/shared/ipc/`，主进程注册 handler、预加载生成转发函数，渲染层只依赖共享类型；禁止在渲染层直接 `require` Node 模块。
5. **打包**：`electron-builder` + NSIS（Windows）；v1 不做自动更新，但保留 `electron-updater` 接入点（更新检查非目标）。
6. **落地位置**：MD-Studio 作为本仓库下的独立子项目 `md-studio/`（`src/main`、`src/preload`、`src/renderer`、`src/shared`），与 `docs/` 文档体系并列；若后续需要独立仓库，迁移成本仅限目录移动。

## Alternatives

- **Tauri 2**：包体与内存更优，但引入 Rust 工具链；Windows WebView2 版本与渲染一致性不可控；拼写检查与 PDF 打印需另找系统能力，主题/渲染对齐成本高。否决。
- **纯 Web / PWA**：File System Access API 无法提供目录监听与稳定的本地工作区语义（需用户手势、浏览器差异大），也没有原生菜单与安装器，无法满足桌面工作流。否决。
- **复用参考产品的 Electron 壳与资源**：既违反"自有代码重写"的边界，也因主进程为字节码而不可维护。否决。
- **NW.js**：打包与生态成熟度、社区活跃度低于 Electron，无收益。否决。

## Consequences

- **正**：与参考产品同类运行时，Chromium 渲染使 Markdown、主题 CSS、PDF 导出的行为路径可预期；Node 生态可直接支撑文件监听、导出、拼写；打包/签名路径成熟；无需 Rust 工具链。
- **负**：安装包约 150–250 MB，空闲内存数百 MB；多进程调试与安全边界需要严格 IPC 纪律；Electron 版本升级需要回归成本。
- **风险**：Windows 上中文 IME 与字体渲染存在平台差异，由 RFC-001 REQ-008 的 IME 用例兜底；Electron 大版本 API 变动通过锁定版本 + 季度升级评审控制。

## References

- `docs/analysis/typora/findings.md` §2、§4
- `docs/analysis/typora/app-asar.summary.json`（字节码加载器事实）
- `docs/analysis/typora/legacy-atom-asar.summary.json`（4 BrowserWindow / 21 webPreferences / 114 IPC 的结构参考）
- RFC-001 §4.1、§5；ADR-002
