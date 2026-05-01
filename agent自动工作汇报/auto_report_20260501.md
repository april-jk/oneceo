# auto_report_20260501

## Env 简化

- 做了什么：精简 `apps/.env.example` 的连接器配置，只保留 `CONNECTOR_SECRET_KEY` 与 `COMPOSIO_API_KEY` 作为 Composio MCP broker 模式的示例必需项，移除 connector 专属 secret 覆盖项和 Composio toolkit/allowed tools 高级覆盖项。
- 遇到什么：`apps/.env.example` 仍有部分历史中文注释编码显示异常；本次只处理连接器配置项，不扩大范围重写整份 env 示例。
- 计划如何解决：已用搜索确认示例文件中 Composio 只剩 `COMPOSIO_API_KEY`，后续如需要可单独做 env 注释编码清理。

## MCP Composio 清理

- 做了什么：清理 GitHub/Notion/Slack/Supabase/Figma Composio MCP 改造后的旧 direct MCP/OAuth 残留，移除 `.env.example` 中旧 remote/token 配置示例，阻断 GitHub 旧 token 仓库直连路径，并删除 sandbox bootstrap 中历史 GitHub local token 环境变量投影。
- 遇到什么：`github-connector-repository-service.ts` 里旧中文字符串较多，补丁大段匹配不稳定；已按函数边界做结构化清理。
- 计划如何解决：已执行 API type-check 与相关 connector 单测；发现并修正旧 GitHub remote_sse 快照测试样例，改为 Vercel backend_rpc 样例。
