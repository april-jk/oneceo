# TODO 索引

## 2026-03-20

### 文档

- 管理文档：
  - [Codex_e2b-template_sandbox配置文件直编与LLM设置设计.md](/Users/watson/codingProj/oneceo/docs/agent研发文档/Codex_e2b-template_sandbox配置文件直编与LLM设置设计.md)

### TODO 列表

1. 平台统一 LLM 计费与模型切换
   - 现状：当前只实现 `codex`
   - 后续需要补齐其他模型的统一供应商切换、统一计费、审计与额度控制

2. 运行中配置热更新
   - 现状：当前只对新启动 sandbox 生效
   - 后续需要补齐运行中会话的配置热重载能力

3. 配置版本管理
   - 现状：当前每个用户只保存一份生效配置
   - 后续需要补齐历史版本、回滚与审计
