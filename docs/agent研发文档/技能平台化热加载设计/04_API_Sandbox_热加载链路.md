# 04 API 与 Sandbox 热加载链路

## 1. 采用 OpenCode 原生 skills 机制，而不是继续拼 prompt

OpenCode 官方支持的 skill 目录包括：

1. `.opencode/skills/<name>/SKILL.md`
2. `~/.config/opencode/skills/<name>/SKILL.md`

本次在 oneceo 中采用第二种：

1. skill 写入 sandbox 用户目录下的 `~/.config/opencode/skills`
2. 不写入工作区 `.attachments`
3. 不把 skill 数据混进 workspace 文件树

这样做的原因：

1. 避免 workspace 污染
2. 避免继续把 skill 伪装成上传文件
3. 直接复用 OpenCode 对原生 skill 的发现机制

## 2. Skill 渲染规则

后端从 `platform_skill_revisions` 取到正文后，不直接把数据库文本原样写盘，而是统一渲染为合法 `SKILL.md`：

```md
---
name: office-ppt
description: 创建、改写或重组可直接交付的专业演示文稿
compatibility: opencode
---

...body_markdown...
```

约束：

1. `slug` 必须满足 OpenCode skill name 规则
2. 目录名与 frontmatter `name` 必须一致

## 3. 新增服务

建议新增 `apps/api/src/services/platform-skill-service.ts`

职责：

1. 列出已发布 skill
2. 根据 `revisionId` 解析 skill 快照
3. 渲染标准 `SKILL.md`

建议新增 `apps/api/src/services/sandbox-skill-sync-service.ts`

职责：

1. 计算当前消息期望 skill 集合
2. 计算 sandbox 已同步 skill 集合
3. 执行新增、更新、删除
4. 在 skill 集合变化时重启 `opencode serve`
5. 把同步结果写回 runtime metadata

## 4. 同步时机

### 4.1 Altus managed

在 `altusManagedInputService.submit()` 中：

1. `ensureSandbox(sessionId)` 后
2. `startRun(...)` 前
3. 先解析当前用户真正有权限使用的 skill revision
4. 调用 `sandboxSkillSyncService.syncResolvedSkills(...)`
5. 把同一批 resolved skill 正文写入 `managedSkillContext`

这样保证：

1. run 开始前 sandbox 已具备正确 skill 集合
2. 不再需要前端预上传 skill 文件
3. Altus managed prompt 与 sandbox 内实际已同步 skill 集合同源，不会出现“写进 sandbox 但 Altus 自己没读到”的分叉

### 4.2 直通 / OpenCode direct mode

在 direct mode 的 prompt dispatch 主链路中，同样在真正向 OpenCode 发消息前执行一次 skill sync。

也就是说：

1. managed
2. direct

都复用同一个后端 skill sync 服务，不允许各写一套。

## 4.3 Altus managed 对 skill 的真实消费

仅把 `SKILL.md` 写入 sandbox 并不足以证明 Altus managed 已使用 skill。

因为 managed mode 不是直接运行 OpenCode native prompt loop，所以还必须补一层：

1. 当前轮选中的 resolved skills 写入 run metadata
2. `AltusRunCoordinator` 在构造 system prompt 时，把 `managedSkillContext` 追加为独立 skill 指令块
3. 这批 skill 指令块必须与实际写入 sandbox 的 skill 集合保持同一来源

这样链路才闭环：

1. 用户选择 skill
2. 后端解析用户可用 revision
3. sandbox 同步真实 `SKILL.md`
4. Altus managed system prompt 同时消费同一批 skill 正文

## 5. 为什么需要 restart 而不是只写文件

根据现有 oneceo 文档和 OpenCode 运行方式，skill 文件变更不能假设一定被运行中进程立即重新发现。

因此本次采用明确策略：

1. skill 集合未变化：不重启
2. skill 集合或 revision 变化：写文件后重启 `opencode serve`

这与当前仓库对 MCP 稳定加载的做法一致，属于最短正确路径，而不是热插假成功。

## 6. 已同步状态记录

为了避免每条消息都重写 skill 并重启 runtime，需要记录同步状态。

建议写入 `task_session_sandbox_bindings.metadata_json`：

```json
{
  "skillSync": {
    "revisionIds": ["rev1", "rev2"],
    "signature": "sha256(...)",
    "syncedAt": "..."
  }
}
```

后续判断规则：

1. 当前消息 skill signature 与已同步 signature 相同：跳过
2. 不同：执行 diff + restart

## 7. OSAC 路由处理

当前 `osac-agent-service.loadSkill/unloadSkill()` 在 E2B 模式下直接报“不支持”。

本次需要把它们改成调用同一套 `sandbox-skill-sync-service`，至少做到：

1. E2B 模式下不再是死桩
2. API 语义与主链路一致

这样后续无论：

1. 管理后台主动测试 skill
2. session 运行时切换 skill

都走同一套真实能力。
