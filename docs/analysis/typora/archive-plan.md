# Typora 分析证据卷：留存与归档方案

> Status: Active | Created: 2026-10-28 | Updated: 2026-10-28 | 关联：`docs/backlog.md` B1-5、`docs/analysis/typora/findings.md` §1
> 用途：为 REA 产出的 `evidence-*` 完整证据卷（约 300 MB）定下长期归属，明确"进 git / 走 LFS / 外置存储 / 只留本地"的取舍与体积预算。

## 1. 结论（先给决策）

1. **证据卷不进 git，也不走 Git LFS。** 保持 `.gitignore` 现状（`docs/analysis/**/evidence-*`），仓库里只留摘要 JSON、stderr 日志、`findings.md` 与本方案。
2. **主方案 = 本地留存 + 可复现配方 + 哈希清单。** 卷的价值是"重读原文"，不是"随代码分发"；只要能在需要时用固定参数重跑并校验哈希，就没有长期托管 300 MB 的必要。
3. **升级方案 = GitHub Release 资产（外置存储）。** 若某天确实需要一份不依赖本机的长期副本，打包成**单个** `typora-evidence-1.14.10.tar.gz`（约 50 MB）挂到 tag `typora-evidence-1.14.10` 的 Release 上；仓库内只提交 `SHA256SUMS`，不提交二进制。**这是唯一推荐的外部托管形式。**
4. **不推荐第三条路（S3/R2/B2 等对象存储）**：为一次性的研究快照引入账号、凭据与计费，运维成本高于收益；Release 资产已经免费且不可变。

## 2. 体积与内容事实（实测）

四个卷都是**单行 JSON**（REA Evidence dump，非二进制归档），因此压缩率很高：

| 证据卷 | 对应产物 | 原始 | `gzip -6` | 压缩比 |
|---|---|---:|---:|---:|
| `evidence-app-asar` | `resources/app.asar` | 0.5 MB | 0.1 MB | 7.1× |
| `evidence-appsrc` | `resources/appsrc/` | 55.7 MB | 9.3 MB | 6.0× |
| `evidence-legacy-atom-asar` | `resources/app/atom.asar`（旧版） | 30.0 MB | 5.6 MB | 5.4× |
| `evidence-lib-asar` | `resources/lib.asar` | 200.0 MB | 35.1 MB | 5.7× |
| **合计** | | **286.2 MB** | **50.0 MB** | **5.7×** |

因此口径上应区分两个数字：**原始 286 MB**（磁盘占用）、**可分发 50 MB**（归档体积）。此前文档里的"约 300 MB"指前者，量级正确。

## 3. 为什么不走 Git LFS

GitHub 对 LFS 的免费额度是**每账号 1 GiB 存储 + 1 GiB/月流量**，跨仓库合并计算。50 MB 的卷在存储上只占 5%，看着很宽裕，但流量侧不成立：

- **每次拉取都计费。** 新克隆、`git lfs pull`、CI 里 `actions/checkout` 带 `lfs: true`，各消耗 50 MB。1 GiB/月 → **每个自然月约 20 次全量拉取即触顶**，之后 LFS 拉取直接失败。按当前仓库的提交频率换算，CI 每次构建都拉一遍是不可接受的。
- **与 Pages 部署冲突。** 本仓库用 Actions 部署 GitHub Pages（`.github/workflows/deploy.yml`）。不带 `lfs: true` 时检出得到的是指针文件（构建里出现 130 字节的假数据，静默出错）；带了 `lfs: true` 则每个 push 都烧 50 MB 流量。两种都不好。
- **数据是不可变的。** 卷对应固定的 Typora 1.14.10 与固定 REA 版本，不会随代码演进而修订。LFS 的核心卖点（版本化大文件、按需检出）对一份不变的快照没有价值，反而要为它承担配额与 smudge 风险。
- **Windows 检出成本。** 本地开发者克隆时若未装 LFS，得到指针文件且无提示；装了就多 286 MB 磁盘。本项目的克隆体量不应该被一份历史研究证据绑架。

## 4. 主方案：本地留存 + 复现配方 + 哈希清单

- **本地保留原始卷**（当前状态），不参与版本控制；换机或清理磁盘时可直接删除，见 §6 重跑。
- **仓库内保留可校验的指纹**（§5 的 `SHA256SUMS`），保证"重跑出来的东西是不是当初那份"可判定，而不是靠记忆。
- **结论已沉淀**：`findings.md` 记录经核实的结构与行为，`*.summary.json` 是机器可读摘要，RFC/spec 引用的是这些结论。卷只在需要回看原文片段（某个函数的字面实现、某段 CSS 变量名）时才需要，属低频事件。
- **已明确不需要的卷**：`page-dist`（两次单源超时后决策关闭，见 B1-1）；`node_modules.asar` 未留存（逐模块语义无设计价值，见 B1-2）。

## 5. 哈希清单（2026-10-28 实测）

与本文档同目录提交了 `SHA256SUMS`（`evidence-*` 本身被 `.gitignore` 排除，清单入库）：

```text
b0c3c389fba52f38c7dce7dd41b87482a836fc37640ab2ad3722e26ffb1a5a70  evidence-app-asar
d21dd3cfb6d7b9330c47b363bc85590b3f34adb77524e64a60b242dce77d31df  evidence-appsrc
484385e4001aa3f1faa7aed3d55697562012bcf6bff14c8ecf47287f1806ac33  evidence-legacy-atom-asar
328ca8155b7b84c1593f0fac5833be25d272621941b6ee6199838183933e6022  evidence-lib-asar
```

校验方式（在 `docs/analysis/typora/` 下，卷存在时四个均为 `OK`）：

```bash
sha256sum -c SHA256SUMS
```

卷不在本机时该命令会报文件缺失，属预期行为：按 §6 重跑生成后，再用这份清单判断"重跑结果是否等同当初那份"。

## 6. 复现配方

环境：REA v6.8.0（`npx -y rea-agents@latest`）、Node v24.22.1、Typora 1.14.10（winget `appmakes.Typora`，安装目录 `D:\typora文本软件\Typora`）。四个卷的原始命令（取自 `*.stderr.log`）：

```bash
npx -y rea-agents@latest analyze-javascript-application "D:/typora文本软件/Typora/resources/app.asar"  --detail summary --evidence_output docs/analysis/typora/evidence-app-asar       --format json
npx -y rea-agents@latest analyze-javascript-application "D:/typora文本软件/Typora/resources/appsrc"    --detail summary --evidence_output docs/analysis/typora/evidence-appsrc         --format json
npx -y rea-agents@latest analyze-javascript-application "D:/typora文本软件/Typora/resources/app/atom.asar" --detail summary --evidence_output docs/analysis/typora/evidence-legacy-atom-asar --format json
npx -y rea-agents@latest analyze-javascript-application "D:/typora文本软件/Typora/resources/lib.asar"  --detail summary --evidence_output docs/analysis/typora/evidence-lib-asar      --format json
```

注意事项：

- **REA 版本要对齐**：不同版本的证据卷结构会变，哈希不会重现。要么钉住 `rea-agents@6.8.0`，要么接受"结构等价、字节不同"。
- **路径必须换成本机实际安装目录**（上面是原作者机器的路径）。
- **`lib.asar` 是耗时项**：200 MB、12 个选中文件，单次约数分钟；不要在同一条命令里跑多个目标。
- **不要重跑 `page-dist`**：已决策关闭；若确需细节，用 `--source-path` 限定单文件并降低 `--max-semantic-nodes-per-file`。

## 7. 体积预算

| 方案 | 存储占用 | 每次获取的流量 | 克隆成本 | 结论 |
|---|---|---|---|---|
| 现状（仅本地 + gitignore） | 286 MB（本机磁盘） | 0 | 0 | **采用** |
| Git LFS | 50 MB / 1 GiB 免费额度（5%） | 50 MB/次 | +50 MB（装 LFS 时） | 拒绝（§3） |
| GitHub Release 资产 | 0（不计入仓库） | 50 MB/次 | 0 | **备用**（需长期副本时） |
| 对象存储（S3/R2/B2） | 50 MB，按量计费 | 50 MB/次 | 0 | 拒绝（凭据与计费成本不成比例） |

单文件上限对照：GitHub Release 单资产 2 GiB，50 MB 远低于阈值；LFS 单文件上限 2 GiB 同样不是约束——**约束在流量，不在体积**。

## 8. 升级为 Release 资产的操作步骤

仅在需要一份不依赖本机的副本时执行（不随日常开发发生）：

```bash
cd docs/analysis/typora
sha256sum -c SHA256SUMS                      # 先确认本地卷与已入库清单一致，不一致就别发布
tar -czf /tmp/typora-evidence-1.14.10.tar.gz evidence-* SHA256SUMS
ls -lh /tmp/typora-evidence-1.14.10.tar.gz   # 预期约 50 MB

gh release create typora-evidence-1.14.10 /tmp/typora-evidence-1.14.10.tar.gz \
  --title "Typora 1.14.10 分析证据卷" \
  --notes "REA v6.8.0 静态分析证据卷（4 个目标，未含 page-dist / node_modules.asar）。用法见 docs/analysis/typora/archive-plan.md。"
```

取回并校验：

```bash
gh release download typora-evidence-1.14.10 -p '*.tar.gz'
tar -xzf typora-evidence-1.14.10.tar.gz
sha256sum -c SHA256SUMS
```

发布前确认卷内**不含**许可/激活相关材料（与 `findings.md` §1 的排除项一致）：只含 `app.asar`、`appsrc`、`lib.asar`、旧版 `atom.asar` 的静态结构，四者均已在 `findings.md` 定性。

## 9. 重新评估的触发条件

满足任一条件时再回来看这份文档，否则维持现状：

1. 需要在不含本机环境的场合（CI、他人机器、评审）复看证据原文；
2. 证据卷总量超过 **1 GB**（届时单 Release 资产仍够，但要重新核算 tar 打包耗时与 2 GiB 上限）；
3. 仓库转为需要长期存档的对外发布形态（审计/交接要求"证据随代码"）；
4. Typora 版本升级导致需要并存多版本证据卷（此时应按版本分 tag，而不是叠加在同一个卷里）。
