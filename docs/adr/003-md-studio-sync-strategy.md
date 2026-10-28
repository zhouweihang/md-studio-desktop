# ADR-003: md-studio 以主仓库为单一来源，发布仓库由脚本生成

> Status: Accepted | Date: 2026-10-28 | Deciders: 项目所有者（zhouweihang） | 关联 RFC: RFC-001 §6（交付与验证） | 影响：决定代码在哪改、发布从哪来、版本号与 tag 归属、发布仓库可以改什么

## Context

`md-studio/` 同时存在于两个 git 仓库：

- **主仓库**（远程 `bbylw/rea-cn`）：站点 + 工程文档（RFC/ADR/C4/spec/plan/backlog） + `md-studio/`；
- **发布仓库**（`zhouweihang/md-studio-desktop`，公开）：`md-studio/` + `docs/` + 文档门禁 + 三端打包工作流 + 许可文件。

两者内容目前相同，但历史独立。上线产物来自发布仓库，而设计依据、验收记录与门禁都在主仓库；只要有一次修复只落在一边，就会出现"发布的代码与文档描述不一致"，而且 C4 视图里 110 处 `path:line` 引用会指向不存在的文件。

## Decision

1. **主仓库是唯一来源。** 代码、测试、工程文档的改动一律先落在主仓库，提交后再同步。
2. **发布仓库是生成物。** 其中的 `md-studio/` 不手工编辑。发布仓库只承载：同步出的 `md-studio/` 与 `docs/`、文档门禁脚本，以及发布专属文件（`LICENSE`、`NOTICE`、`README.md`、`.gitignore`、`.github/workflows/package.yml`）。
3. **发布专属文件版本化在主仓库** `scripts/publish-template/`，由同步脚本覆盖写入发布仓库。改它们 = 改主仓库的模板，改完再同步。
4. **同步是一条命令**：主仓库里的 `node scripts/publish-md-studio.cjs`。脚本从主仓库 `HEAD` 生成快照 → 覆盖模板 → 提交 → 推送；提交信息固定为 `Sync from main@<sha>`，发布仓库的任一提交都能反查到主仓库状态。脚本与模板目录本身**不随发布仓库分发**（它们只服务主仓库的维护流程）。
5. **版本号归主仓库，tag 归发布仓库**：`version` 在 `md-studio/package.json`，`v*` tag 打在发布仓库的同步提交上，由它触发三端打包与 Release。
6. **反方向改动必须回流**：万不得已直接改了发布仓库的 `md-studio/`，必须把同一改动补进主仓库再重新同步；否则下一次同步会把修复覆盖掉。

## Consequences

- 发布仓库的历史是"主仓库快照序列"，可读、可追溯，但不作为开发分支；那边的 PR 只对文档与发布专属文件有意义。
- 同步脚本有三重保险：主仓库工作区必须干净、`FORBIDDEN` 路径（agent 配置、会话数据、站点源码、构建产物）出现即中止、`--dry-run` 可在提交前查看差异。
- `docs/` 整体同步，发布仓库看到的文档与主仓库一致，避免"代码在一边、解释在另一边"。
- 发布流程固定为四步：改主仓库 → 必要时改 `version` → `node scripts/publish-md-studio.cjs` → 在发布仓库打 `v*` tag。

## Alternatives considered

- **以发布仓库为主，主仓库删除 `md-studio/`**：C4 视图与文档门禁都引用 `md-studio/src`、`md-studio/tests` 路径（110 处），删除会让它们全部失效，工程文档失去可验证锚点。
- **git subtree / submodule**：发布仓库的布局是 `md-studio/` 子目录 + `docs/`，与 subtree 要求的"单目录成为仓库根"不匹配；submodule 需要改造已有的两段历史，收益不抵成本。
- **人工复制**：没有机制保证两份副本一致——本项目已经出现过文档与命令在两地不同步（README 写 `npm install` 而仓库锁 `bun`），也出现过只在 Linux 上暴露的大小写 import 缺陷，靠人工核对不现实。
