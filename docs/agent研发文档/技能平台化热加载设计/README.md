# 技能平台化热加载设计

更新时间：2026-03-29

## 文档目的

本组文档用于把 oneceo 当前的“前端硬编码 skill 模板 + 发送时直接内联 prompt”方案，重构为：

1. 平台侧统一维护 skill 目录
2. 管理后台可动态新增、编辑、发布 skill
3. 前端从 API 拉取 skill 列表，而不是写死在代码里
4. 消息里只传 `skill 引用`，不再传整段 skill markdown
5. skill 在 sandbox 内按 OpenCode 规范热加载，供运行时按需使用

## 本次设计明确替代的旧方案

当前仓库中的 skill 主要走这条链：

1. `apps/web/client/src/lib/skill-attachment-templates.ts` 写死模板
2. `AttachmentPickerButton.tsx` 把模板伪装成附件
3. `task-attachments.ts` 把 skill 内容直接拼进 prompt
4. sandbox 内并没有真正的平台化 skill 注册和热加载能力

这套方案已经不再继续扩展。

## 参照依据

本设计参考了两类实现：

1. `suna` 的“平台能力注册 + API 驱动配置 + 运行时按配置加载”模式
2. OpenCode 官方的 Agent Skills 发现规则

其中：

1. `suna` 提供的是结构模式，不直接照搬其 Python/Composio 代码
2. OpenCode 提供的是 oneceo 在 sandbox 内真正可落地的 skill 装载规范

## 文档目录

1. `01_现状差异_目标与范围.md`
2. `02_技能模型_版本与后台管理.md`
3. `03_前端选择协议与消息模型.md`
4. `04_API_Sandbox_热加载链路.md`
5. `05_实施步骤_迁移_验证.md`
6. `06_管理后台信息架构与页面设计.md`
7. `07_管理后台接口代理与交互流程.md`

## 与旧文档关系

以下文档仍然保留作为历史背景，但本次设计会替代其“inline skill”传递模型：

1. `docs/agent研发文档/技能附件_PPT办公技能模板设计.md`
2. `docs/agent研发文档/20260328_技能附件阻塞ManagedRun创建_问题与修复方案.md`
3. `docs/agent研发文档/20260327_技能附件跨Sandbox丢失_问题与修复方案.md`

本次新设计的原则不是在旧链路上继续补丁，而是直接把 skill 收口为平台能力。
