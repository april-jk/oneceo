# 2026-05-22 自动工作汇报

## Altus 语音输入流式修复

- 对照 `/Users/watson/codingProj/AgentLine` 的 Voice Secretary 实现，补齐浏览器实时语音识别上屏与服务端 ASR 最终确认的双层链路。
- 修正本地 ignored env 中语音识别配置与 AgentLine 本机配置不一致的问题，已同步 `apps/.env`、`apps/.env.localhost`、`apps/.env.staging`、`apps/.env.product`。
- 服务端 WS ASR 改为按约 200ms PCM 分包发送，并增加超时保护；前端会随音频提交实时转写文本，避免上游最终确认失败时用户侧直接看到 502。
- 针对 Chrome 停止录音时可能只有 interim 结果、还没有 final 结果的问题，已把最后一段实时 interim 文本也纳入后端兜底提交。
- 按官方流式协议新增 `/ws/task-creation/voice/asr` API WebSocket 代理，前端录音时把 PCM 小包送入受会话鉴权保护的流式识别接口，实时结果进入输入框；已重启 3000 前端 dev server 让代理配置生效。
- 已完成 `api` 与 `web` TypeScript 检查，前端代理已重启，后续刷新前端页面后进行真实麦克风联调。

## 网站生成检查 Playwright 截图证据链

- 新增设计文档：docs/agent研发文档/20260522_网站生成检查Playwright截图证据链优化方案_[20260522-2216已采用].md。
- 优化 Altus managed 的 debug_open_page / browser_interact：成功后通过 Playwright 连接同一个 n.eko Chromium CDP 9222 截图，并将截图证据上传平台对象存储。
- Actions 回放增加 browserScreenshot 元数据与前端展示入口，用户点开对应操作即可查看该步浏览器检查截图。
- 计划继续跑后端工具运行时、事件投影和前端 replay 相关测试，修正类型或用例问题后完成验证。
- 23:15 根据用户补充要求更新方案：网站生成必须在代码运行/构建验证后进入“视觉检测”，通过 n.eko + Playwright 执行打开、点击、按键、滚动等步骤，并把每一步截图挂到对应 Action；后续代码需补齐 `complete_task` 前的视觉检测证据门禁。
- 23:58 已补齐 `complete_task` 前视觉检测证据门禁、用户端/管理后台截图回放端点与 metadata 放行；通过 API 聚焦测试、web replay 测试、api/web/admin type-check 和 diff 检查。
- 2026-05-23 继续排查 session 73a79328：管理端日志显示 debug_open_page/browser_interact 确实生成多张截图，但门禁只检查 `browserScreenshot.status="captured"`，没有判断页面是否白屏、空 DOM 或错误页；方案更新为截图和最终预览都必须携带通用 `visualCheck`，并且 `complete_task` 只认可 `visualCheck.status="passed"` 的视觉检测证据。
- 2026-05-23 11:15 继续排查 session 2e401d87：DB 事件显示 n.eko/CDP 页面动作可运行，但 Action 截图全部 `capture_failed: exit status 1`；Altus 还绕过平台工具写 `screenshot-test.mjs`、安装/搜索 Playwright。修复方向已落到平台层：固定 sandbox Playwright/CDP/NODE_PATH 默认值、截图命令结构化输出失败诊断、completion gate 记录截图失败尝试、管理端 debug 接口优先读取 DB sandbox 绑定，避免已有 managed sandbox 时误报执行环境未启动。
- 2026-05-23 16:47 真实复测 session 2e401d87：修复 Action 截图 helper 默认 `fullPage` 截图可能拖到 E2B 超时的问题，改为带 10s 超时的视口截图，并修正嵌入 sandbox 的 Node 脚本正则转义，避免 `node_process` 失败。真实 run `1292e45b-15b9-4948-903b-4a45b6b4b1cd` 已产出 `debug_open_page` Action 截图，R2 图片可读回 4258 bytes；视觉诊断正确标记 `visible_text_too_short`，没有把空页面判定为完成。
- 2026-05-23 17:40 继续排查 session 62d9ade2：白屏阶段根因为浏览器运行时 `React is not defined`，build/healthcheck 都通过但 `#root` 没有挂载。已将固定网站模板泛化加固为 automatic JSX runtime、入口 error boundary、`data-oneceo-app-status` 诊断、视觉检测 `app_runtime_error` 分类，并收紧部署前 preflight，避免 CLI 截图兜底掩盖浏览器运行时错误。
- 2026-05-23 18:42 修复 review 两处问题：运行时错误兜底忽略 `noscript` 后再判断真实渲染内容，Actions 截图回放保留 `visualCheck` 失败原因；同时优化交付卡片失败态，视觉检测失败时不再显示巨大空白预览和“任务完成”，改为紧凑展示检测失败、诊断原因和查看源码/打开产物入口。已通过 API/web 聚焦测试、api/web type-check 和 `git diff --check`。
- 2026-05-24 00:45 继续排查 session 35de8842：Actions 中 `debug_open_page` 已通过视觉检测，但最终交付快照在独立收口端口上误判 `app_runtime_error`，导致卡片显示“交付预览未通过视觉验证”。已修复 DOM 诊断扫描 `<script>` 模板字符串导致的误判，并让最终交付卡片在收口快照失败时复用同 run 已通过的浏览器视觉检测截图，避免后置探测覆盖真实通过证据。已通过 API 聚焦测试、web 卡片测试、api/web type-check。
