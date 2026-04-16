# 2026-04-16 自动工作汇报

- 做了什么：
  - 补齐平台侧“部署模板基线”接入，新增模板检查接口并接入部署工作台 UI
  - 结构化输出 manifest / analytics / database / healthcheck 等基线状态
  - 补充相关单测与 e2e 检查点
- 遇到什么：
  - 现有部署面板已经有较多真实状态，新增基线能力时需要避免和轮询中的 deployment panel 混在同一接口里
  - 模板检查不能直接污染用户工作区，因此改为导出到临时目录检查
- 计划如何解决：
  - 先以独立接口提供基线状态，避免拖慢 deployment poll
  - 后续再补失败态模板检查结果持久化与审计链路

- 做了什么：
  - 修复部署模板对 Umami 的运行时注入契约，补齐最终部署成功后的 website 绑定回写
  - 为部署链路补充 analytics 绑定单测，并在真实会话上重新发布站点
  - 使用 Playwright 打开真实部署地址，确认 `https://analytics.oneceo.ai/script.js` 返回 200，`/api/send` 上报返回 200
- 遇到什么：
  - 旧部署面板在首次部署后没有基于最终静态域名刷新 Umami website，导致平台侧长期停留在 `pending`
  - Railway 原生 `redeploy` 在该历史 deploymentId 上返回 400，需要改走平台的 `deploy` 主路径触发一次新发布
- 计划如何解决：
  - 继续把最终域名绑定收敛到部署成功后的单一回写点，避免首次部署和重部署行为分叉
  - 后续观察 Umami 聚合指标更新延迟，必要时再补平台侧的最近一次上报时间展示

- 做了什么：
  - 将 Umami 组织模型从单 team 拆成双 team：`OneCEO Platform` 与 `OneCEO Deployment`
  - 在 `analytics.oneceo.ai` 上实际创建 `OneCEO Deployment`，并确认 `oneceo-analytics` 已加入且角色为 `team-manager`
  - 调整后端绑定逻辑，部署站点今后只认 deployment team，并在老 metadata 仍指向 platform team 时自动纠偏
- 遇到什么：
  - 老会话 metadata 中保存的 `websiteId` 仍然指向旧的 platform team，如果只改环境变量会继续复用脏绑定
  - Railway 这次发布失败点不在构建，而在未提交代码导致的 snapshot 生成失败
- 计划如何解决：
  - 先提交双 team 修复，再重新发布 API，并对真实会话触发重部署验证 website 已迁回 deployment team
  - 后续再决定是否批量清理 platform team 中历史遗留的部署 website

- 做了什么：
  - 清理了 `OneCEO Platform` 中误挂的 12 个历史 deployment website / smoke website
  - 回读确认 `OneCEO Platform` 现在只剩 `OneCEO Main` 与 `OneCEO Dev`
  - 回读确认 `OneCEO Deployment` 现在保留当前真实站点 `ff56e40e-94e3-4053-a4d8-092e92173a47`
- 遇到什么：
  - 被误挂到 platform team 的旧 website 中有少量历史 pageviews/visits，说明此前确实发生过错误归属
  - Umami 不支持把既有 website 无损转移到另一个 team，只能通过重建正确 website 后删除旧项来纠偏
- 计划如何解决：
  - 后续若需要保留历史统计归档，再单独做导出与审计，不再让错误组织继续留在生产实例
  - 现阶段以“组织边界正确、当前活跃站点正确、平台主站纯净”为收口标准
