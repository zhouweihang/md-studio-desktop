# Backlog 待办清单（工程级）

> Status: Active | Created: 2026-10-27 | Updated: 2026-10-28 | 用途：归档跨阶段遗留项，防止遗漏；每项含证据、现状、收尾标准
> 关联：RFC-001、ADR-001、ADR-002、`docs/analysis/typora/findings.md`

## B0. 已闭环

- 分析阶段（2026-10-27）：4 个产物的证据归档（app.asar / lib.asar / appsrc / 旧版 atom.asar）入档 `docs/analysis/typora/`；`page-dist` 语义归档决策关闭（见 B1 区块）；工程文档体系（agent + 门禁 + RFC/ADR/C4/backlog）建立并通过门禁。

## B1. 分析阶段遗留（Typora 逆向）

| ID | 项 | 证据 | 现状 | 收尾标准 |
|---|---|---|---|---|
| ~~B1-1~~ | `page-dist` Evidence 归档 | `page-dist.timeout-error.json`（首次：单源 300 s 超时）；`page-dist.retry1.summary.json`（二次：单源 900 s 超时，同一文件 `static/js/0.99879679.chunk.js`） | **Completed 2026-10-27（决策关闭）**：两次重试均在该 CRA 大 chunk 单源超时；page-dist 属设置类 UI，结构清单与文件清单已核实，足够支撑设计 | 结论：不归档 page-dist 语义证据。如需细节：单文件 `--source-path` + 降低语义上限（`--max-semantic-nodes-per-file`）单独分析 |
| ~~B1-2~~ | `node_modules.asar` 语义分析 | **Completed 2026-10-28（决策关闭）**：依赖清单已在 `findings.md` §2/§4.7 成文（监听 `chokidar`、压缩 `adm-zip`、拼写 `spellchecker`、检索 `vscode-ripgrep`、语言识别 `cld`、文件属性 `fswin`、注册表 `native-reg`）；逐模块语义无设计价值（产品目标是以自有代码重写，不参照其实现），且原始 `node_modules.asar` 未随证据卷留存（`.gitignore`），复现需重跑 REA | 已闭环（不做逐模块语义） |
| B1-3 | 当前版主进程（V8 字节码）行为细节 | `app-asar.summary.json`（`launch.dist.js` + `atom.compiled.dist.jsc`，静态不可读） | 未开始；已知只能走运行时捕获 | 决策：仅当 RFC/实现遇到必须参照的行为差异时，用 REA `capture-electron-scenario` 做一次受控观察并归档 |
| ~~B1-4~~ | REA 官方技能安装 | **Completed 2026-10-28**：用户确认后安装到全局 `~/.agents/skills/reverse-engineer-anything`（`npx skills add morluto/rea --skill reverse-engineer-anything --global`，v53，160 KB：`SKILL.md` + `references/`）；已用 `skill` 工具加载验证可读。技能只提供操作说明，不注册 MCP 服务、不安装分析引擎；上一条（当前版字节码行为差异）触发时按 SKILL.md 的 CLI 回退执行 `npx -y rea-agents@latest analyze-javascript-application`。PromptScript 目标因不支持全局安装被跳过（不影响其他客户端） | 已闭环（装全局，不进仓库） |
| ~~B1-5~~ | 分析证据卷体积管理 | **Completed 2026-10-28**：方案见 `docs/analysis/typora/archive-plan.md` —— 实测 4 个卷 286.2 MB 原始 / 50.0 MB（`gzip -6`，5.7×，均为单行 JSON）；**拒绝 Git LFS**（免费额度 1 GiB 存储 + 1 GiB/月流量，每次拉取 50 MB → 每约 20 次触顶，且与 Pages 部署的 `lfs: true` 检出互相绑架）；主方案 = 本地留存 + 复现配方 + SHA256 清单；需长期外部副本时以单个 `tar.gz` 挂 Release tag（单资产上限 2 GiB，约束在流量不在体积） | 已闭环（不入 git/LFS） |
| ~~B1-6~~ | Typora 主题格式兼容性研究 | **Completed 2026-10-28**：结论见 `docs/analysis/typora/theme-compat.md` —— 不提供转换器（选择器无法机械映射、变量非同名、第三方主题许可风险），改为公开变量契约 + 用户主题热加载 + 起手模板，并写明重新评估的触发条件 | 已闭环（转换器明确不做） |

## B2. 实现前置（RFC-001 评审通过后）

| ID | 项 | 说明 | 收尾标准 |
|---|---|---|---|
| ~~B2-1~~ | spec 快照与实现计划 | `docs/specs/2026-10-27-md-studio-design.md`、`docs/plans/2026-10-27-md-studio-plan.md` | **Completed 2026-10-27**：两份文档已生成（6 个 Task，含全量回归 Task） | 门禁通过（由检查脚本验证） |
| ~~B2-2~~ | 包管理器与仓库形态 | **Completed 2026-10-27**：决策 = npm（Node 24 自带）+ 不拆分仓库（本仓库 `md-studio/` 子项目） | 已回写 `docs/architecture/C2-container.md` §4 与 spec §4.1 |
| ~~B2-3~~ | 默认键位表冻结 | **Completed 2026-10-27**：`md-studio/src/shared/keymap/default.json`（33 条）与命令表 id 一一对应；`tests/platform/keymap.test.ts` 校验无冲突、无未知命令 | 已随全量功能轮落地（RFC-001 §6） |

## B3. MVP 后续（spec §4.5 偏差与验收工程化）

| ID | 项 | 证据/说明 | 收尾标准 |
|---|---|---|---|
| ~~B3-1~~ | Playwright-Electron 端到端接入 | **Completed 2026-10-27**：`md-studio/e2e/app.spec.ts` 9 用例（启动/输入与撤销/打开→编辑→Ctrl+S 磁盘往返/主题/源码模式/导出 HTML/导出 PDF `%PDF` 校验/工作区文件服务/键位与最近文件）；`npm run test:e2e` 通过 | 已闭环（RFC-001 §6） |
| ~~B3-2~~ | sandbox 收紧 | **Completed 2026-10-27**：`webPreferences` 启用 `sandbox: true` + `contextIsolation: true`，预加载为零 node 依赖的白名单桥接；E2E 在沙箱下全数通过 | 已闭环 |
| ~~B3-3~~ | 设置存储迁移 | **Completed 2026-10-27**：窗口尺寸/位置/最大化、视图（侧栏/三模式）、主题、最近文件、自动保存参数全部落 `userData/settings.json`（主进程去抖原子写 + 多窗口广播）；`keymap.json` 与 `themes/*.css` 独立文件 | 已闭环 |

## B4. 全量功能轮遗留（RFC-001 §6 部分项与 spec 偏差）

| ID | 项 | 证据/说明 | 收尾标准 |
|---|---|---|---|
| ~~B4-1~~ | 目标规模性能实测 | **Completed 2026-10-27**：`tests/perf/scale.test.ts` 生成 10k 文件/10k 行 fixture 实测——搜索首结果 **47 ms**、全量 **50 ms**（目标 500 ms / 3 s）；10k 行大纲 **3.6 ms**（目标 300 ms）；1k 行代码块 + 表格首帧 **8.5 ms**（目标 100 ms）；搜索同时改为有界并发（8 路）。数字已回填 RFC-002 §6 | 已闭环（无需增量索引） |
| ~~B4-2~~ | 真机中文 IME 回归 | **Completed 2026-10-27**：E2E 用 CDP `Input.imeSetComposition` 驱动真实组合事件（组合中插入 → 提交），断言文档不丢字、不崩溃；候选窗手感仍列人工清单（见 B5 区块） | 自动化部分已闭环，人工清单转入 B5 区块 |
| ~~B4-3~~ | 导出件公式字体自包含 | **Completed 2026-10-27**：`renderer/export/katex-fonts.ts` 以 base64 内联 15 个常用 woff2（正体/粗/斜/数学/AMS/花体/尺寸 1–4/等宽/无衬线），`settings.exportOptions.inlineMathFonts` 选项化（默认关、动态 import），体积增量由 `tests/export/inline-fonts.test.ts` 记录 | 已闭环（字形覆盖限制见 B5 区块） |
| ~~B4-4~~ | 大结果集虚拟滚动 | **Completed 2026-10-27**：`renderer/shell/virtual-list.ts`（固定行高 + 缓冲 + 上下占位），大纲与搜索结果接入；1 万条只渲染「视口 + 缓冲」行，`tests/platform/virtual-list.test.ts` 校验节点数与滚动窗口 | 已闭环（行高自适应见 B5 区块） |
| ~~B4-5~~ | 图表主题切换重绘 | **Completed 2026-10-27**：mermaid widget 增加世代号参与 `eq()`，切主题时 `invalidateMermaidCache()` 自增世代 + `redrawMermaidWidgets()` 触发块装饰重建，可见图表立即以新主题重渲 | 已闭环 |

## B5. v0.2（RFC-002）遗留与后续项

| ID | 项 | 证据/说明 | 收尾标准 |
|---|---|---|---|
| ~~B5-1~~ | 标签拖拽排序与拖出成窗 | **Completed 2026-10-28**：`shell/tab-bar.ts` 接入 HTML5 拖拽（`dragstart`/`dragover`/`drop`/`dragend`），按指针左右半区决定插入点，`resolveDropIndex()` 处理跨过自身的索引补偿；`SessionPool.moveTo()` 落序，`DocManager.moveTab()` 触发重绘并走既有会话保存，顺序随 `settings.tabs.open` 持久化。测试：`tests/renderer/tab-reorder.test.ts` 6 例 + E2E「标签拖拽排序」（DOM 顺序、`settings.tabs.open`、重载后恢复）。拖出成窗仍是非目标 | 已闭环（拖出成窗不做） |
| B5-2 | 真机 IME 人工清单 | **2026-10-28 部分闭环**：清单与执行记录见 `docs/qa/2026-10-28-md-studio-ime-regression.md`，`e2e/ime.spec.ts` 自动覆盖 IME-1（拼音上屏）/IME-2（全角标点，行首+表格）/IME-3（组合中撤销）/IME-4（60 轮高强度输入，296 ms、0 pageerror），均通过；过程中发现并修复「组合期未映射旧装饰导致跨行替换崩溃」（`live-preview.ts`）。IME-5（双拼/五笔切换）、IME-6（候选窗定位/翻页/上屏）仍需真人执行 | 人工 IME-5/IME-6 按清单执行并回填结果后关闭 |
| ~~B5-3~~ | 虚拟列表行高自适应 | **Completed 2026-10-28**：`shell/virtual-list.ts` 支持 `rowHeight: { estimate }` 测量模式——渲染后回填真实高度（`rowHeightAt()` 可查），用前缀和 + 二分定位窗口（`buildOffsets`/`indexAtOffset`/`computeVariableWindow`），测量结果按索引缓存，已渲染区域不重算；大纲/搜索行改为可折行（去掉写死行高与 `nowrap`）。测试：`tests/platform/virtual-list.test.ts` 新增前缀和/二分/超长行/下限 4 例 + DOM 测量回填 1 例 | 已闭环 |
| ~~B5-4~~ | 搜索目录遍历并发化 | **Completed 2026-10-28**：`search.ts` 的 `collectFiles(root, shouldStop, concurrency = DIR_CONCURRENCY)` 改为共享游标 + `pending` 计数 + 等待队列的并行广度遍历（核数 2–8，上限 16），不会因某个 worker 先看到空队列而提前结束；2000 文件用例从 3310 ms 降到 ~1900 ms。测试：`tests/workspace/search.test.ts`「目录遍历并发」——1/8 并发收集结果集合完全一致、无重复无漏收、提前停止不报错 | 已闭环 |
| ~~B5-5~~ | 导出字体内联字形覆盖 | **Completed 2026-10-28**：`settings.exportOptions.inlineMathFonts` 由布尔改为三档 `off | common | all`（旧布尔值 `true→common`/`false→off` 迁移）；`katex-fonts.ts` 补齐 Fraktur/SansSerif 粗斜体/Script 共 20 个 woff2。实测体积：`common` 15 个 ≈ 265 KB、`all` 20 个 ≈ 339 KB（`tests/export/inline-fonts.test.ts` 打印并断言 all > common、woff2 引用全部消失）；设置面板改为三档下拉 | 已闭环 |
| ~~B5-6~~ | 内容模式全量搜索耗时 | **Completed 2026-10-28**：`main/content-cache.ts` 缓存**文件正文**（按 path+mtime+size，64 MB LRU），10k 文件暖扫描 **36 ms**（原 2.8 s）；冷启动仍 ~2.8–3.2 s（读盘下界）。工作区已被 chokidar 监听时（`setTrustedRoot`）跳过每文件 `stat`——Windows 上 10k 次 stat 约 950 ms；新鲜度由监听事件（`invalidateContentCachePath`）与保存钩子（`writeTextAtomic`）保证，未监听根仍逐次比对 mtime/size。测试：`tests/perf/scale.test.ts`（暖 <1 s）、`tests/workspace/search.test.ts` 信任根失效用例 | 已闭环 |
| ~~B5-7~~ | 未命名标签的本地化命名 | **Completed 2026-10-28**：`SessionPool` 新增 `untitled` 标记与 `setPath()`（另存为/重命名/删除文件统一走这里），显示名不再读存储的 `name`——标签栏与标题栏都在渲染时用 `tr('tabs.untitled')` 计算，语言切换后重绘即生效（`renameUntitledTabs` 已删除）。测试：`tests/platform/tabs.test.ts`「未保存标记」3 例 | 已闭环 |

## B6. 发布签名（ADR-004）

| ID | 项 | 证据/说明 | 收尾标准 |
|---|---|---|---|
| B6-1 | 发布包签名与公证的密钥配置 | **2026-10-28 代码就绪**：`md-studio/electron-builder.cjs` 按环境注入 `win.azureSignOptions`；`build/entitlements.mac.plist` + `entitlements.mac.inherit.plist` 配合 `hardenedRuntime` / `notarize`；发布仓库 `package.yml` 增加 macOS/Windows 签名准备步骤，以及 `Get-AuthenticodeSignature`、`codesign`/`stapler`/`spctl` 校验。单元测试 `tests/build/electron-builder-config.test.ts` 覆盖“有密钥才签”的分支。密钥本身（Apple Developer Program 会员、Azure Trusted Signing 账户与证书 profile）尚未申请，当前 CI 仍产出未签名包 | 按 ADR-004 的表格配齐 secret/variable 后打一个 `v*` tag：Windows 校验 `Valid`、macOS `stapler validate` 与 `spctl --assess` 通过，真机首次打开无 Gatekeeper 拦截 |
