# 2026-04-14 自动工作汇报

## 本次完成

- 对 `referance/game-2048` 做了部署模板、运行时注入、统计脚本、认证、存储、通知、数据库与测试结构的逐层拆解。
- 对照 oneceo 现有 Railway 部署链路、数据库链路、直通部署 capability 和部署工作台 UI 骨架，整理出生成应用部署基线的专题方案。
- 在 `docs/部署工作台功能设计/06_生成应用部署基线/` 新建一组待评审设计文档，并更新了部署工作台总 README 索引。
- 补充了“第三方能力复用与 Umami 接入”专题，明确哪些 Manus 依赖可直接用、哪些只能参考，以及 Umami Cloud / 自托管两种接入路径。
- 基于 `analytics.oneceo.ai` 实例现状，补充了 OneCEO 私有 Umami 的初始化方案，明确 team、集成用户、website 分层和平台自动创建规则。
- 已在 `analytics.oneceo.ai` 实际创建 `OneCEO Platform` team、`oneceo-analytics` 集成用户以及 `oneceo.ai / dev.oneceo.ai` 两个 website，并验证非 admin 账号可读写 team 下 website。
- 已把执行计划文档切换为“已采用”状态，并开始在 API / Web 侧落实 Umami 自动建站、环境变量注入与部署工作台真实统计展示。
- 已在生成链路侧补入 OneCEO Web App 契约：managed prompt 增加 manifest / healthcheck / analytics / Railway Postgres 约束，部署导出阶段新增模板合规检查与 manifest 自动补齐。
- 已把 Railway 权限与资源模型推进到“平台高权限仅负责 provisioning，运行态默认走每会话独立 project token；托管仓库与 Railway project 也按会话隔离”。
- 已补平台侧部署设置页真实资源展示：可以直接看到当前会话绑定的仓库、分支、token 模型、权限范围与隔离模式。
- 已新增当前会话 Railway Project Token 轮换接口，并在部署工作台提供轮换入口。
- 已把 Railway 资源模型继续收敛为“每用户固定 project + 每会话独立 environment / service / repo / project token”，后续新部署不再按会话新建 project。
- 已把统计脚本注入从弱提示升级为部署导出阶段的强制 bootstrap：HTML 入口会自动补入 OneCEO analytics 脚本。
- 已补充针对模板 bootstrap 的 API 单测，确认 analytics 注入只会发生一次，不会重复叠加。

## 遇到的问题

- 参考项目里存在明显的 Manus 私有能力和与 OneCEO 当前基础设施不一致的部分，例如 `vite-plugin-manus-runtime`、Manus OAuth/forge 私有接口以及 `mysql2`。

## 计划如何解决

- 继续沿“一套官方模板 + OneCEO 运行时注入 + 平台统计契约 + 部署前模板合规检查”推进，并把 Umami 接入做成不阻塞部署主链的默认能力。
- 补齐 token 审计记录、用户自定义环境变量管理，以及模板基线状态总览。
- 继续验证 Railway environment 创建与多应用同 project 运行时的真实供应商行为，并补 UI 级项目 / environment 管理入口。

## 2026-04-15 补充记录

- 已完成真实部署烟测，验证“每用户固定 Project + 每会话独立 Environment / Service / Repo / Project Token + Umami website 自动绑定 + 模板 analytics bootstrap 注入”链路可实际跑通。
- 烟测过程中定位两个真实根因并已修复：
  - `apps/.env` 中 Umami 密码包含 `#`，未加引号导致 dotenv 截断，平台侧实际拿到的是错误密码。
  - Railway `serviceDomainCreate` 默认 `targetPort` 被写成 `3000`，而实际运行实例监听 `8080`，导致 deployment `SUCCESS` 但公网长期 `502`。
- 已补公网可达性等待：部署 / 重部署 / 回滚会在 Railway 状态成功后继续等待公网 URL 真正返回 2xx/3xx，再向上游返回成功。
- 已补 Umami website 列表分页，避免 website 数量增长后因只取首屏 20 条而重复建站点。
- 已新增正式清理脚本 `apps/api/scripts/deployment-smoke-cleanup.ts`，支持按 smoke 前缀批量回收 Railway / Umami / DB 资源。
- 已新增《部署链路验收、回归与清理手册》，把必备环境变量、烟测命令、回归标准和清理命令固化到文档。
- 已实际执行 smoke 资源回收：
  - Railway environments / services / service domains 已清理
  - smoke 专用固定 Project 已清理
  - smoke 本地部署账号记录已清理
  - GitHub 仓库因当前 token 仅具备 `repo` 范围、缺少删除权限，暂保留为人工清理项

## 2026-04-16 补充记录

- 已对会话 `334809bc-025c-4865-9e49-4915a2b7af1e` 做真实排查，确认“没有成功走部署 tools”的主因不在后端，而在前端入口仍残留旧链路。
- 具体表现：
  - 页面最后一次实际提交给 Altus 的消息是 `启动网站调试功能`
  - 对应 run `cd825cae-7880-44ea-b500-9591608d7477` 走的是 `shell_execute + debug_open_page + complete_task`
  - 因此前端虽然已经支持渲染 `deploy_application` 等新 tools，但真实动作并没有进入部署 tool runtime
- 已修复平台侧 UI 入口：
  - 预览面板里的发布 / 重新发布 / 回滚，不再直接调用旧部署 API，而是改为发消息驱动 Altus
  - replay drawer 里的同类动作也改为发消息驱动 Altus
  - artifact 卡片的部署入口同样改为提交“帮我部署当前项目”消息
- 目前保留旧部署 API 仅用于读取部署面板状态，不再作为默认执行动作入口。
- 已继续修复 Altus completed 状态回写观感问题：
  - 会话详情读取现在会用 DB 的 `completed / failed / waiting_user` 终态覆盖 memory 中滞后的生命周期
  - 内部管理态会话摘要也同步按同样规则优先采用 DB 终态
  - 已用真实接口复查 `334809bc-025c-4865-9e49-4915a2b7af1e`，返回值从 `in_progress / collecting` 修正为 `completed / completed`
- 已补 Altus 运行时部署完成硬门禁：
  - 当当前用户请求属于 `deploy / redeploy / rollback` 时，`complete_task` 不再只看模型总结，而是必须等对应托管部署 tool 返回 `status=success`
  - `debug_open_page` 与本地 Node 调试服务不再被允许充当“线上部署完成”的证据
  - 若模型在部署未成功前尝试结束任务，系统会把本次 `complete_task` 记为失败，并强制其继续修复发布链路
- 已新增回归测试覆盖这条误报链路：先错误调用 `complete_task`，再执行 `deploy_application` 成功，最后才允许真正完成任务。
- 已使用 Playwright 对真实前端链路复测：
  - 新发出的 `帮我部署当前项目` 不再在 12 秒内立刻出现“本地调试成功 + managed run 已完成”的假完成
  - 进一步定位出另一处前端观感问题：`direct_platform_capability` 快捷部署链路虽然会更新 session 状态，但开始/完成消息没有完整落库，刷新后页面会丢失终态并表现为一直处理中
- 已修复 `direct_platform_capability` 消息持久化：
  - WebSocket 直连平台能力分支现在会把开始状态、结果消息、完成/失败状态同步写入 file-memory-store 与 DB
  - 前端刷新后可以恢复部署状态查询等快捷平台动作的完整结果，不再只剩一条“正在调用平台服务...”
  - 同时将页头 `运行中 · <sandbox>` 文案改为中性 `执行环境 · <sandbox>`，避免把“环境在线”误读成“任务仍在运行”
- Playwright 复测结果：
  - `帮我查看当前部署状态` 已能在 UI 中完整收到开始消息、最终结果消息与 completed 终态
  - 页面不再停留在 `智能体正在处理...`
  - 当前这个 2048 会话对应的真实部署状态依然是 `FAILED`，公网地址返回 404；这已经被平台如实显示，不再伪装为成功

## 2026-04-16 部署链路续修记录

- 已继续对会话 `334809bc-025c-4865-9e49-4915a2b7af1e` 做真实部署链路分段定位，并确认新的核心事实：
  - sandbox 工作区导出成功
  - 托管 GitHub 仓库推送成功
  - 发布后的仓库 HEAD 已包含正确的 `index.html / package.json / server.js / oneceo.manifest.json`
  - Umami website 绑定成功，平台侧 deployment panel 已可展示实时统计
- 已补部署源码归一化：
  - 当工作区根目录只有单个嵌套应用目录时，会在“导出到托管仓库前”自动把该应用提升为可部署根目录
  - 对纯静态 HTML 应用自动补齐 `package.json`、`server.js` 与 `oneceo.manifest.json`
  - `server.js` 会在返回 `index.html` 时将 `%VITE_ANALYTICS_*%` 占位符替换为 Railway 环境变量，确保 Umami 注入在静态站点上也能生效
- 已补新的单测覆盖：
  - 单目录静态应用会被标准化为可部署根模板
  - GitHub 源码同步若没有触发新的 Railway deployment，会自动回退为手动触发 deploy
- 真实根因已进一步收敛并修复：
  - Railway 服务虽然已绑定 GitHub repo，但在 repo 更新后不会自动拿到最新 commit
  - 直接手动 deploy 时，Railway 复用的是旧 snapshot，因此持续部署旧的 README 初始化版本
  - 现已在平台部署链路中增加“发布后强制刷新 Railway service source 绑定”，再执行 deployment 等待/补触发
- 用 Railway Admin GraphQL 和真实部署验证后确认：
  - 刷新 source 绑定前，新 deployment 的 `commitMessage` 仍是初始化 README
  - 刷新 source 绑定后，新 deployment 已切换到最新提交 `chore: deploy session ...`
  - 新 deployment `3625cb52-ed37-43e1-a9bc-b7f28a77f4ac` 最终状态为 `SUCCESS`
- 已完成 Playwright 交付级回归：
  - 公网地址 `https://app-334809bc-025-c0eb52-app-334809bc-025-c0eb52.up.railway.app/` 返回 `200`
  - `/api/system/health` 返回 `200` 和 `{\"ok\":true,\"service\":\"oneceo-static-server\"}`
  - 页面标题为 `2048游戏`，首屏可见棋盘与分数
  - 移动端视口下页面可正常打开且未出现横向溢出
  - 页面内已实际插入 `https://analytics.oneceo.ai/script.js`，并带上正确的 `data-website-id`
  - 平台 deployment panel 已显示 `latestStatus=SUCCESS`，Umami 统计已出现 `pageviews/visits/visitors/activeVisitors`
