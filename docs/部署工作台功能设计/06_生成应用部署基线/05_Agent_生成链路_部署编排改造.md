# Agent、生成链路与部署编排改造设计 [20260415-1048已采用]

## 1. 现状

OneCEO 当前已经具备一条真实部署链路：

- `apps/api/src/services/task-creation-deployment-source-service.ts`
  - 从 sandbox 导出工作区并推送到托管 GitHub 仓库
- `apps/api/src/services/platform-deployment-account-service.ts`
  - 在 Railway 创建项目、服务、域名、数据库并做变量注入
- `apps/api/src/services/railway-deployment-service.ts`
  - 获取部署状态、日志、回滚与重部署信息
- `apps/api/src/routes/task-creation-routes.ts`
  - 暴露部署与数据库 API
- `apps/web/client/src/components/OpencodePreviewPanel.tsx`
  - 已有“发布与访问 / 站点数据 / 数据库 / 设置”界面骨架

所以问题已经不是“有没有部署能力”，而是：

- 生成出来的项目并没有被强制做成“标准部署模板”
- 站点数据页还是占位
- agent 还没有被要求输出稳定的部署契约

## 2. 当前缺口

## 2.1 agent 只是生成代码，不保证模板合规

当前链路可以部署工作区，但不会在部署前强制检查：

- 是否有统一脚本
- 是否有健康检查
- 是否有统计注入入口
- 是否有 manifest
- 是否和 Railway Postgres 契约一致

## 2.2 直通能力只覆盖“部署动作”，没有覆盖“部署基线”

当前 `direct-mode-capability` 只覆盖：

- `deploy_session_website`
- `redeploy_session_website`
- `rollback_session_deployment`
- `get_session_deployment_status`

这对于“把已经写好的项目推上去”足够，但对“保证生成应用默认具备平台基线”还不够。

## 2.3 站点统计没有接真实后端

`OpencodePreviewPanel.tsx` 里已经有“站点数据”结构，但现在还是空壳。

## 3. 第一阶段 agent 改造目标

第一阶段不追求 agent 全自动运维，而是先把三件事做硬：

1. 生成时默认从官方模板出发
2. 结束时必须产出平台可识别的部署契约
3. 部署前必须通过模板合规检查

## 4. 生成链路建议改造

## 4.1 生成入口改造

当用户明确要生成“网站 / Web App / SaaS / 后台 / 工具”时，agent 不应再从空目录自由发挥，而应：

1. 先 materialize 官方模板
2. 再在模板内填业务代码
3. 再补 manifest、环境说明、健康检查

这样做的好处：

- 生成项目天然可部署
- 统计入口天然存在
- 数据库、身份、工作台可以统一接入

## 4.2 输出契约改造

agent 完成生成后，必须保证下列文件存在：

- `package.json`
- `oneceo.manifest.json`
- `client/index.html`
- `server/index.ts`
- `server/routers.ts`
- `server/_core/context.ts`
- `server/db.ts`

如果缺少，视为“不具备部署条件”，不能直接进入平台部署动作。

## 4.3 部署前自动检查

建议新增 `template-compliance-service`，在部署前执行：

- 脚本检查
- manifest 检查
- 健康检查路由检查
- 数据库契约检查
- 统计注入入口检查

部署前检查失败时，应返回明确错误，而不是把错误留到 Railway 构建期。

## 5. 平台服务建议新增

建议后续新增以下服务：

- `apps/api/src/services/deployment-template-materializer-service.ts`
  - 负责把官方模板铺到 sandbox 工作区
- `apps/api/src/services/template-compliance-service.ts`
  - 负责部署前静态检查
- `apps/api/src/services/platform-analytics-service.ts`
  - 负责站点统计 site id、事件写入、聚合查询
- `apps/api/src/services/platform-runtime-env-service.ts`
  - 负责把 manifest 映射为部署环境变量

## 6. 现有文件需要怎样改

## 6.1 部署能力拦截层

文件：

- `apps/api/src/agents/task-creation/layers/direct-capability-intercept-agent.ts`
- `apps/api/src/services/direct-mode-capability-types.ts`

第一阶段建议：

- 保持现有 4 个部署动作 capability 不变
- 不急着新增大量 capability id
- 先把“生成出来的项目默认合规”放到生成链路内解决

第二阶段再考虑新增：

- 站点统计查询 capability
- 数据库资源准备 capability

## 6.2 部署执行层

文件：

- `apps/api/src/services/direct-mode-deployment-capability-service.ts`
- `apps/api/src/routes/task-creation-routes.ts`

需要补的不是“再多一个 deploy 按钮”，而是：

- 在 deploy 前调用 `template-compliance-service`
- 在 deploy 前按 manifest 注入运行时与统计环境变量
- 在 deploy 后返回基础统计与模板信息

## 6.3 部署资源编排层

文件：

- `apps/api/src/services/platform-deployment-account-service.ts`

需要补：

- 为应用服务注入 OneCEO runtime / analytics 变量
- 保证数据库变量与 analytics 变量一样走平台统一注入
- 对不同模板版本做兼容处理

## 6.4 前端工作台层

文件：

- `apps/web/client/src/lib/task-creation-client.ts`
- `apps/web/client/src/components/OpencodePreviewPanel.tsx`
- `apps/web/client/src/components/AltusRunReplayDrawer.tsx`

需要补：

- 站点统计接口读取
- 用户统计接口读取
- 模板合规状态提示
- 首次部署时的“已接入哪些平台能力”摘要

## 7. prompt 约束建议

对任务生成 agent，建议新增硬约束：

1. 生成 deployable web app 时，默认使用 OneCEO 官方模板。
2. 生成结束前必须保证 `oneceo.manifest.json` 存在。
3. 如果用户要求网站统计或用户统计，不要自行接第三方分析 SDK，优先使用 OneCEO 运行时注入契约。
4. 如果应用需要数据库，默认按 Railway Postgres 契约生成 `drizzle + pg` 方案。

## 8. 为什么不建议把一切都做成 direct capability

因为这个问题的核心不是“多几个平台动作”，而是“生成出来的东西天然合规”。

如果项目本身没有统一模板、没有 manifest、没有健康检查、没有统计入口：

- capability 再多也只是把不稳定项目更快地部署出去

所以第一阶段的最短路径是：

- 先改生成链路
- 再补部署前检查
- 最后再扩工作台和 direct capability

## 9. 第一阶段验收口径

只要满足以下条件，就算 agent 改造达标：

1. 生成一个网站类项目时，默认落到官方模板上
2. 生成结束后必有 manifest
3. 部署前能识别统计、健康检查、数据库契约是否齐全
4. 部署后工作台能看到至少基础站点数据空态和真实接入状态

## 10. 当前建议的审查点

- 是否同意第一阶段把重点放在“模板合规”而不是“新增很多 capability”。
- 是否同意 agent 生成网站时强制从官方模板起步。
- 是否同意部署前加一层硬检查。

## 11. 当前实现进度

截至 2026-04-15，已经落地：

1. managed prompt 增加 OneCEO web app 契约
2. 部署前新增 `template-compliance-service`
3. 缺少 `oneceo.manifest.json` 时，部署导出阶段会自动补一份平台默认契约
4. 真正阻塞部署的仅保留在 `package.json`、`build/start` 和 manifest/数据库契约冲突这类硬错误
5. 平台部署账号已切换到“每用户固定 Railway project + 每会话独立 environment / service / repo / project token”的服务层模型，旧默认账号仅用于历史兼容迁移
6. 部署导出阶段新增强制模板 bootstrap，会自动把 OneCEO analytics 脚本注入到 HTML 入口，不再只依赖弱提示
7. 模板合规检查已把 analytics 注入从 warning 提升为硬校验，缺失 bootstrap 会直接阻塞部署
8. 部署工作台设置页展示的资源信息已与新模型对齐，包括共享用户 project、会话独立 environment、仓库、分支和 token 作用域
9. 平台新增当前会话 Project Token 轮换接口，后端切换到新 token 后立即生效，前端已提供入口

## 12. 下一步收口

下一步要继续补齐三类能力：

1. token 审计链路
   - 记录轮换操作者、时间、来源和影响会话
2. 用户自定义环境变量
   - 在工作台里管理业务侧密钥，并和平台托管 token 分离
3. 模板能力状态总览
   - 明确展示 analytics / database / auth / storage 各项基线是否已经注入完成

仍待继续：

1. 官方模板 materialize 能力
2. 前端工作台展示模板合规状态

## 13. 2026-04-16 平台接入补齐

本轮继续补齐了平台侧正式接入，不再只停留在“部署成功 / 失败”结果层：

1. 新增部署模板基线检查接口  
   - `GET /api/task-creation/sessions/:sessionId/deployment/template`
   - 平台会真实导出当前工作区，在临时目录执行 bootstrap + compliance 检查，再把结果返回给前端

2. 模板检查结果结构化  
   - `template-compliance-service` 现在除了 `warnings/errors`，还会返回结构化 `checks`
   - 包括：`build/start/analytics/healthcheck/database` 五项

3. 部署工作台已展示模板基线总览  
   - 前端在部署面板里新增“模板与平台接入基线”
   - 用户可以直接看到：
     - manifest 是否已存在或由平台补齐
     - analytics 是源码自带还是平台注入
     - 数据库是否按 Railway Postgres 契约声明
     - 健康检查路径是否已识别
     - 当前 warnings / errors

4. 发布后回写基线结果  
   - 平台在成功导出并推送仓库后，会把本次模板基线摘要写回 sandbox metadata
   - 这样部署链路和工作台看到的是同一套检查结论

这意味着下一步待补的已经不再是“有没有模板状态”，而是：

1. 官方模板 materialize 能力
2. 失败态模板检查结果的持久化与审计
3. agent 生成完成阶段主动写入更完整的 manifest，而不是只依赖部署导出阶段补齐
4. 项目列表、environment 列表、token 轮换与吊销的管理界面
