# GitHub 分支保护与合并审查方案草稿

## 1. 目标

- 让 `oneceo` 在 4 人并行开发时，主线分支保持可发布、可回滚、可追溯。
- 降低“直接推主分支”“未审查即合并”“把未验证代码合进来”的风险。
- 让后续 GitHub 设置能够直接落地，而不是停留在口头约定。

## 2. 当前现状

### 2.1 仓库现状

- 仓库远端：`https://github.com/april-jk/oneceo.git`
- 仓库类型：私有仓库
- 默认分支：`main`
- 当前主要开发分支：`task-creation-agent`
- 当前仓库内暂无以下基础设施：
  - `.github/workflows/*`
  - `.github/CODEOWNERS`
  - `.github/pull_request_template.md`

### 2.2 本地检查现状

- `pnpm --filter web check`：当前可通过
- `pnpm --filter api type-check`：当前失败，存在历史 TypeScript 错误
- `pnpm --filter oneceo-admin-management type-check`：当前失败，存在依赖与类型问题

结论：

- 现在还不适合一上来就把 API / Admin 的全量检查设成强制 required checks。
- 需要先分阶段上线保护，否则第一批 PR 会被历史问题卡死。

### 2.3 GitHub 套餐限制

本地使用 GitHub API 查询 `main` 分支保护时返回 `403`，提示：

- `Upgrade to GitHub Pro or make this repository public to enable this feature.`

结合 GitHub 官方文档，可得出当前判断：

- 该仓库是“个人账号下的私有仓库”。
- 当前账号未具备对私有仓库启用 protected branches / CODEOWNERS 强制审查的套餐能力。

参考：

- [About protected branches](https://docs.github.com/github/administering-a-repository/defining-the-mergeability-of-pull-requests/about-protected-branches)
- [Managing protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
- [About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)

## 3. 推荐方案

### 3.1 分支模型

建议采用“两层主线 + 主题分支”：

- `main`
  - 作为稳定分支 / 可发布分支
  - 禁止直接 push
- `task-creation-agent`
  - 作为当前阶段的集成分支
  - 当前迭代内也禁止直接 push
- `feature/<topic>`
  - 新功能开发
- `fix/<topic>`
  - 缺陷修复
- `chore/<topic>`
  - 工程类调整
- `docs/<topic>`
  - 文档类调整

合并路径建议：

- 日常开发：`feature/*` / `fix/*` -> `task-creation-agent`
- 阶段稳定后：`task-creation-agent` -> `main`

说明：

- 你们现在已经在 `task-creation-agent` 上持续开发，直接强行切回“只有 main”会打断当前节奏。
- 所以第一阶段保留 `task-creation-agent`，等主线收敛后再决定是否简化为 `main + feature/*`。

### 3.2 权限和责任

建议角色如下：

- 你：仓库 owner / 最终合并人
- 另外 3 位协作者：只在个人主题分支开发，不直接推送保护分支

建议协作约束：

- 所有功能和修复都通过 PR 合并
- 保护分支禁止直接提交
- 自己开的 PR 不能自己批准后直接合并
- 紧急 hotfix 也应补 PR；如果必须直修，只保留你一人例外

### 3.3 PR 审查规则

建议第一阶段采用“轻但有效”的规则：

- 最少 `1` 个 approval
- 必须解决所有 review conversation 后才能 merge
- 新 commit 推送后，旧 approval 失效
- 要求最后一次可审查提交得到批准
- PR 必须描述：
  - 改了什么
  - 怎么验证
  - 风险点/影响范围

为什么不是一开始就 `2` 个 approval：

- 你们现在一共 4 人，且仓库流程尚未稳定。
- 一上来要求 2 个 approval，实际会明显拖慢节奏。
- 等流程稳定、CI 完整后，再考虑把 `main` 提升到 `2` 个 approval。

### 3.4 合并策略

建议仓库层面采用：

- 开启 `Squash merge`
- 关闭 `Merge commit`
- 暂不鼓励 `Rebase merge`

原因：

- `Squash merge` 最适合当前这种多人并行、提交习惯尚未完全统一的阶段。
- 它能把一个 PR 收敛成一条干净记录，降低主线历史噪音。
- 后续如团队非常稳定，再考虑是否开放 `Rebase merge`。

## 4. 分阶段落地

### 4.1 Phase 1：先建立最小可执行保护

前提：

- 仓库 owner 升级到 GitHub Pro，或把仓库迁移到具备私有仓库保护能力的 Team/Enterprise 环境。

第一阶段建议做这些：

#### 保护 `main`

- Require a pull request before merging
- Required approvals: `1`
- Dismiss stale pull request approvals when new commits are pushed
- Require approval of the most recent reviewable push
- Require conversation resolution before merging
- Require branches to be up to date before merging
- Do not allow force pushes
- Do not allow deletions
- Apply restrictions to administrators

#### 保护 `task-creation-agent`

- 与 `main` 基本一致
- 也是 `1` 个 approval
- 同样禁止直接 push / force push / delete

#### 仓库补充基础设施

- 新增 `.github/pull_request_template.md`
- 新增 `.github/CODEOWNERS`
- 新增最小 GitHub Actions 工作流

### 4.2 Phase 2：补 required checks

在当前代码基线下，建议 required checks 分两批：

#### 先纳入 required

- `web-check`
  - 对应：`pnpm --filter web check`
- `web-build`
  - 对应：`pnpm --filter web build`
- `shared-build`
  - 对应：`pnpm --filter @oneceo/shared build`

#### 暂不纳入 required

- `api-typecheck`
- `admin-typecheck`
- 任何依赖外部数据库 / 第三方账号 / sandbox 实例的集成测试

原因：

- 这些检查当前本地就不能稳定通过。
- 如果强制要求，保护规则会立即阻断所有正常协作。

### 4.3 Phase 3：补代码归属和更严审查

等基础设施稳定后再加：

- `Require review from Code Owners`
- `main` 分支提升为 `2` 个 approvals
- 针对 `apps/api`、`apps/web`、`apps/admin_management` 指定 CODEOWNERS
- 再把 `api-typecheck`、`admin-typecheck`、关键单测纳入 required checks

建议 CODEOWNERS 方向：

- `apps/api/`：你 + 1 名后端主负责人
- `apps/web/`：你 + 1 名前端主负责人
- `apps/admin_management/`：你 + 对应模块负责人
- `docs/`：你
- `/.github/`：只归你

## 5. 如果暂时不升级 GitHub Pro

如果继续保持“个人私有仓库 + 当前套餐”，则无法在 GitHub 上强制启用完整分支保护。

这种情况下只能走“软约束方案”：

- 仍然采用 `main` / `task-creation-agent` / `feature-*` 的分支模型
- 所有人承诺不直接 push 到 `main` 和 `task-creation-agent`
- 所有改动必须走 PR
- 由你人工把关后再 merge
- 在仓库内补 PR 模板和协作文档
- 等套餐升级后，再把软约束切换为硬保护

注意：

- 软约束可以改善流程，但不能真正防止误操作。
- 只要有人有写权限，仍然可能直接 push 到主分支。

## 6. 我建议你现在采用的版本

最推荐的是：

1. 保持仓库私有
2. 升级 GitHub Pro
3. 保护 `main` 和 `task-creation-agent`
4. 所有开发走主题分支 + PR
5. 第一阶段先要求 `1` 个 approval
6. 第一阶段只上稳定的 required checks
7. 等仓库历史类型错误清完，再提高审查门槛

这是当前成本最低、最不容易把团队卡死、又能明显提升协作质量的做法。

## 7. 你确认后我可以执行的内容

如果你同意，我下一步可以分两块执行：

### 7.1 仓库内配置

- 创建 `.github/pull_request_template.md`
- 创建 `.github/CODEOWNERS`
- 创建 GitHub Actions PR 检查工作流
- 更新协作文档

### 7.2 GitHub 仓库设置

在套餐满足前提下，我可以直接帮你配置：

- `main` 分支保护
- `task-creation-agent` 分支保护
- 合并方式限制
- required reviews
- required status checks

## 8. 待你拍板的两个点

### 8.1 套餐路线

你需要先决定：

- 方案 A：升级 GitHub Pro，直接做硬保护
- 方案 B：先不上套餐，只先落地仓库内流程和文档

### 8.2 当前是否继续保留 `task-creation-agent`

你需要决定：

- 方案 A：当前阶段继续保留 `task-creation-agent` 作为集成分支
- 方案 B：尽快回归 `main + feature/*` 简化模型

我的建议：

- 套餐选 A
- 分支模型先选 A

