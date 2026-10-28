# 参与贡献

感谢愿意花时间改进 MD-Studio Desktop。开始之前，请先了解这个仓库的特殊之处。

## 这个仓库是生成物

`md-studio/` 由维护者从上游开发仓库同步生成（见 [ADR-003](docs/adr/003-md-studio-sync-strategy.md)）。直接在这里修改 `md-studio/` 的提交会在下一次同步时被覆盖，因此：

- **缺陷与功能需求**：请开 issue（有模板），维护者会在上游仓库实现后同步过来。
- **可以直接提 PR 的**：`docs/`、README、CHANGELOG、本文件、`.github/` 下的工作流与模板。
- 不确定落点时先开 issue 讨论，避免白做。

## 本地开发

需要 Node.js ≥ 22.12。

```bash
git clone https://github.com/zhouweihang/md-studio-desktop.git
cd md-studio-desktop
npm --prefix md-studio ci
npm --prefix md-studio run dev
```

主进程 + 预加载 + 渲染层由 electron-vite 热更新；改主进程代码后需要重启窗口。

## 提交前检查

```bash
npm --prefix md-studio run typecheck   # 主进程与渲染层两套 tsconfig
npm --prefix md-studio test            # Vitest 单元测试
npm --prefix md-studio run test:e2e    # Playwright + Electron，先构建
node scripts/check-eng-docs.cjs        # 文档门禁：命名、编号、头字段、C4 路径
```

`test:e2e` 会真的启动 Electron 窗口，CI 不跑它，但改动编辑器、导出、IME 相关代码时请在本地跑一遍。文档门禁也可以用 `git config core.hooksPath .githooks` 挂到提交前。

## 代码约定

- **TypeScript 严格模式**，两套 tsconfig 分开（主进程 `tsconfig.node.json`、渲染层 `tsconfig.web.json`），不要为过检查而放宽 `strict`。
- **界面文案走 i18n**：`md-studio/src/shared/i18n.ts` 里中英成对添加，不要在组件里写死中文。
- **快捷键**：命令注册在 `src/shared/commands.ts`，默认键位在 `src/shared/keymap/default.json`；新增命令要同时补 `tests/platform/keymap.test.ts` 能校验的条目。
- **主进程与渲染进程只通过类型化 IPC 通信**（`src/shared/channels.ts` + 预加载白名单），渲染层不要直接碰 Node API。
- **提交信息**：一句话说明“为什么”，不要只写“update/fix”。

## 打包

```bash
npm --prefix md-studio run dist:win     # 只能在 Windows 上执行
npm --prefix md-studio run dist:mac     # 只能在 macOS 上执行
npm --prefix md-studio run dist:linux   # 只能在 Linux 上执行
```

Electron 不能跨系统打包，正式产物由 `.github/workflows/package.yml` 的三系统矩阵生成；推 `v*` tag 会汇总发布 Release，日常改动可在 Actions 里手动触发 `Package` 并下载 artifact。签名配置说明见 [ADR-004](docs/adr/004-code-signing-and-notarization.md)。

## 报告问题

请尽量带上：

1. 应用版本（安装包文件名或“关于”）；
2. 操作系统与安装方式（NSIS / dmg / zip / AppImage / deb / 源码运行）；
3. 最短复现步骤，涉及文件时说明类型与行数；
4. 主进程日志、开发者工具 Console 报错或录屏。

**安全漏洞不要公开提交**，直接联系维护者。Windows SmartScreen 与 macOS Gatekeeper 的首次安装提示属于发布签名状态，也请在 issue 里注明具体是哪一种提示。

## 许可

项目以 [Apache-2.0](LICENSE) 分发。提交 PR 即表示同意你的贡献按同一许可发布，并遵守 [NOTICE](NOTICE) 中的署名要求。
