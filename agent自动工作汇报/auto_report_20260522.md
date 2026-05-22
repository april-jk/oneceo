# 2026-05-22 自动工作汇报

## Altus 语音输入流式修复

- 对照 `/Users/watson/codingProj/AgentLine` 的 Voice Secretary 实现，补齐浏览器实时语音识别上屏与服务端 ASR 最终确认的双层链路。
- 修正本地 ignored env 中语音识别配置与 AgentLine 本机配置不一致的问题，已同步 `apps/.env`、`apps/.env.localhost`、`apps/.env.staging`、`apps/.env.product`。
- 服务端 WS ASR 改为按约 200ms PCM 分包发送，并增加超时保护；前端会随音频提交实时转写文本，避免上游最终确认失败时用户侧直接看到 502。
- 针对 Chrome 停止录音时可能只有 interim 结果、还没有 final 结果的问题，已把最后一段实时 interim 文本也纳入后端兜底提交。
- 按官方流式协议新增 `/ws/task-creation/voice/asr` API WebSocket 代理，前端录音时把 PCM 小包送入受会话鉴权保护的流式识别接口，实时结果进入输入框；已重启 3000 前端 dev server 让代理配置生效。
- 已完成 `api` 与 `web` TypeScript 检查，前端代理已重启，后续刷新前端页面后进行真实麦克风联调。
