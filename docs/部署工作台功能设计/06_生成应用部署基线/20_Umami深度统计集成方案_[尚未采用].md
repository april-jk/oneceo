# 20 Umami 深度统计集成方案 [尚未采用]

## 1. 背景

当前 OneCEO 已经具备私有 Umami 接入、部署应用自动创建 website、平台注入 tracker、部署工作台展示基础 pageviews / visits / visitors / activeVisitors 的能力。

但从运营视角看，现有方案只回答了“有没有访问”，还没有充分回答：

- 用户从哪里来？
- 哪些页面带来注册、会话创建和部署？
- 哪些步骤流失最严重？
- 哪些生成应用真的被访问和使用？
- 哪些渠道、页面、功能值得继续投入？
- 哪些页面性能或错误影响转化？

本方案重新从“获取更多运营数据”的角度审计 OneCEO 平台页面、功能链路和 Umami 能力，并把统计集成升级为运营可用的数据体系。

用户提供的现有 Umami 地址：

- Umami host：`https://analytics.oneceo.ai`
- team：`ebd4ca20-a8de-43ff-af76-e1709c9020d6`
- website：`6af729e4-2cdb-4a46-9c15-ee7e2fe8438a`

该 URL 指向一个已存在的 Umami website。本方案把它作为平台级统计源候选，不把该 websiteId 复用为所有用户部署应用的共享统计站点。用户部署应用仍继续遵守“每个部署站点独立 Umami website”的现有规则。

## 2. Umami 能力审计

基于 Umami v3 官方能力，OneCEO 可以利用的能力分为六层。

### 2.1 基础流量

Umami 原生支持：

- pageviews
- visitors
- visits
- bounce rate
- session duration
- active visitors
- referrers
- browsers
- operating systems
- devices
- countries

这些指标适合回答“有没有人来、从哪里来、用什么设备来、是否很快离开”。

### 2.2 页面与入口路径

Umami metrics 支持的维度包括：

- `path`
- `entry`
- `exit`
- `title`
- `query`
- `hostname`
- `tag`

这些维度适合回答：

- 哪些 landing page 最能带来后续行为？
- 用户从哪些入口进入产品？
- 用户在哪些页面退出？
- 多域名、多环境、多 tag 的访问是否健康？

### 2.3 渠道与来源

Umami 支持：

- `referrer`
- `channel`
- `domain`
- `query`
- UTM 参数过滤
- reports API 中的 UTM 报表能力

这些维度适合回答：

- SEO、社交、直接访问、外部社区、投放链接分别带来多少访问？
- 哪些来源的用户更容易注册、创建任务或部署？
- 哪些 campaign 只有访问没有转化？

注意：UTM 不是 `metrics` endpoint 的普通 type。P0 可以先保留 UTM filter / query 参数解析能力，完整 UTM 分组报表放到 P1 通过 reports API 或 OneCEO 自有事件聚合实现。

### 2.4 用户行为事件

Umami 支持自定义事件，可通过 HTML data attribute 或 `umami.track(...)` 上报。

OneCEO 应把关键功能动作统一转成事件，而不是只统计页面访问。例如：

- 点击开始创建
- 成功登录
- 创建会话
- 首次收到 agent 回复
- 生成文件
- 打开预览
- 发起部署
- 部署成功
- 访问部署工作台
- 复制公网链接

### 2.5 高阶洞察

Umami v3 已提供 funnels、retention、user journeys、goals、cohorts 等洞察能力。

第一阶段 OneCEO 不必完全复制 Umami 后台的所有图形能力，但必须为这些分析准备事件和页面数据。否则后续即使 UI 做出来，也没有可用数据。

### 2.6 API 能力

当前最适合 OneCEO 后端接入的 API 包括：

- `GET /api/websites/:websiteId/stats`
- `GET /api/websites/:websiteId/pageviews`
- `GET /api/websites/:websiteId/metrics`
- `GET /api/websites/:websiteId/metrics/expanded`
- `GET /api/websites/:websiteId/events/series`
- `GET /api/websites/:websiteId/active`
- `GET /api/websites/:websiteId/daterange`

其中 `metrics/expanded` 比普通 `metrics` 更适合运营看板，因为它可以同时返回 pageviews、visitors、visits、bounces、totaltime。

## 3. 运营指标目标

本次深度集成不应只做“展示更多 Umami 字段”，而要围绕运营目标组织数据。

### 3.1 获客

要回答：

- 哪些渠道带来最多访问？
- 哪些入口页面带来最多注册？
- 哪些关键词、referrer、campaign 只是带来低质量流量？

核心指标：

- visits
- visitors
- 新访客 / 回访访客拆分
- top referrers
- top channels
- top entry pages
- UTM campaign breakdown（P1）
- landing page bounce rate

其中“新访客 / 回访访客”不是 Umami `stats` 的直接字段，P0 不强行伪造；P1/P2 通过 retention、cohort 或 OneCEO 登录用户回访聚合补齐。

### 3.2 激活

要回答：

- 用户访问后是否开始使用产品？
- 哪个步骤阻碍用户从访问转为创建任务？

核心指标：

- `signup_start`
- `signup_success`
- `login_success`
- `task_session_create_start`
- `task_session_create_success`
- `first_agent_response_received`
- visitor -> signup conversion
- signup -> first session conversion

### 3.3 生成体验

要回答：

- 用户是否真的完成了一次可用生成？
- 哪些 agent 阶段最容易流失或失败？

核心指标：

- `prompt_submit`
- `agent_run_start`
- `agent_run_complete`
- `agent_run_failed`
- `file_change_generated`
- `preview_open`
- prompt -> generated file conversion
- run failure rate

### 3.4 部署转化

要回答：

- 生成后有多少用户进入部署？
- 部署链路在哪一步失败或放弃？
- 部署成功后用户是否访问和分享公网站点？

核心指标：

- `deploy_panel_open`
- `deploy_start`
- `deploy_success`
- `deploy_failed`
- `public_url_open`
- `public_url_copy`
- generated -> deploy_start conversion
- deploy_start -> deploy_success conversion
- deployed site first 24h visits

### 3.5 留存与复用

要回答：

- 用户是否回来继续使用？
- 用户是否会回到同一个会话继续修改、重新部署？
- 哪些生成应用持续有访问？

核心指标：

- returning visitors
- session revisit
- `task_session_reopen`
- `redeploy_start`
- `redeploy_success`
- `rollback_start`
- `rollback_success`
- 7d returning visitor trend
- active deployed websites

### 3.6 商业化与意向

要回答：

- 哪些用户表现出付费或高价值意向？
- 哪些功能入口带来转化线索？

核心指标：

- pricing/settings/payment page visits
- `billing_page_open`
- `upgrade_click`
- `connector_bind_start`
- `connector_bind_success`
- `team_invite_click`
- high-intent event count

## 4. OneCEO 页面与功能埋点矩阵

### 4.1 平台首页与营销页

页面范围：

- `oneceo.ai`
- `dev.oneceo.ai`
- 首页、功能介绍、价格、文档、登录注册入口

应采集：

- pageview
- entry path
- referrer / channel / UTM
- CTA click
- signup click
- login click
- pricing view
- docs view

建议事件：

```text
landing_cta_click
pricing_view
docs_view
signup_click
login_click
```

运营用途：

- 判断获客入口质量。
- 判断首页 CTA、价格页、文档页对注册的贡献。
- 识别高跳出 landing page。

### 4.2 登录注册链路

页面范围：

- 登录页
- 注册页
- OAuth / 邮箱登录入口

应采集：

- auth page view
- signup start
- signup success
- login success
- auth error category

建议事件：

```text
signup_start
signup_success
login_success
auth_failed
```

事件属性只允许记录分类，不允许记录邮箱、手机号、token、错误原文。

```json
{
  "method": "email",
  "source": "landing",
  "error_code": "invalid_credential"
}
```

### 4.3 任务创建与对话页

页面范围：

- task creation 主界面
- prompt 输入
- agent 执行流
- 文件生成与预览

应采集：

- session create
- prompt submit
- agent run start / complete / failed
- first response received
- generated files count bucket
- preview open
- important tool invocation result

建议事件：

```text
task_session_create_start
task_session_create_success
prompt_submit
agent_run_start
agent_run_complete
agent_run_failed
first_agent_response_received
file_change_generated
preview_open
```

属性建议：

```json
{
  "entry": "new_project",
  "template_type": "web_app",
  "model_lane": "managed",
  "duration_bucket": "60_180s",
  "file_count_bucket": "1_5"
}
```

禁止采集 prompt 原文、代码片段、用户文件内容。

### 4.4 部署工作台

页面范围：

- 发布与访问
- 仪表盘 / 站点数据
- 数据库
- 存储桶
- 设置

应采集：

- deploy panel open
- deploy start / success / failed
- redeploy / rollback
- public URL open / copy
- analytics panel open
- database tab open
- settings tab open

建议事件：

```text
deploy_panel_open
deploy_start
deploy_success
deploy_failed
redeploy_start
redeploy_success
rollback_start
rollback_success
public_url_open
public_url_copy
analytics_panel_open
database_panel_open
settings_panel_open
```

属性建议：

```json
{
  "provider": "railway",
  "project_type": "vite",
  "phase": "public_reachability",
  "error_code": "railway_environment_not_found"
}
```

运营用途：

- 衡量生成到部署的转化率。
- 找出部署失败最多的阶段。
- 衡量用户是否理解并使用部署后能力。

### 4.5 生成应用公网站点

页面范围：

- 用户部署出的每个公网应用

应采集：

- pageviews
- visitors
- visits
- entry / exit path
- referrer
- device / browser / country
- custom business events

要求：

1. 每个部署应用使用独立 Umami website。
2. 默认注入基础 tracker。
3. 模板提供统一业务事件 helper，但不强制业务方上传敏感字段。
4. 部署工作台展示该应用自己的统计，而不是平台级 website 数据。

建议默认事件：

```text
generated_app_cta_click
generated_app_form_submit
generated_app_error
```

页面访问不额外上报 `generated_app_page_view` 自定义事件，避免和 Umami 自动 pageview 重复计数。

### 4.6 管理后台

页面范围：

- 用户管理
- 部署资源管理
- Skill 管理
- 运行记录
- 平台配置

应采集：

- admin page view
- resource inspect
- repair action
- skill publish
- config update

管理后台统计用于内部运营和运维，不进入用户侧工作台。

## 5. 统计源与 website 归属

### 5.1 平台级 website

用户提供的 website：

- `teamId = ebd4ca20-a8de-43ff-af76-e1709c9020d6`
- `websiteId = 6af729e4-2cdb-4a46-9c15-ee7e2fe8438a`

建议作为 OneCEO 平台级统计源接入，用于平台自身站点或指定产品站点统计。

后端配置建议新增：

```text
UMAMI_PLATFORM_WEBSITE_ID=6af729e4-2cdb-4a46-9c15-ee7e2fe8438a
```

如果现有 `UMAMI_PLATFORM_TEAM_ID` 已经等于 `ebd4ca20-a8de-43ff-af76-e1709c9020d6`，则不新增 team 配置，只补 websiteId 配置。

### 5.2 用户部署 website

用户生成应用继续沿用现有规则：

1. 首次部署成功后按最终公网域名创建或更新独立 Umami website。
2. `websiteId` 保存到部署环境 metadata。
3. 工作台读取当前部署会话自己的 website。
4. 不读取平台级 website。

该隔离规则不能改变，否则不同用户、不同应用的数据会混在一起。

### 5.3 tag 规则

Umami 支持 `tag` 维度，OneCEO 应把 tag 用于环境和来源区分：

- `platform-prod`
- `platform-dev`
- `deployment-prod`
- `deployment-preview`
- `admin-prod`

tag 不用于用户身份识别。

## 6. 数据产品页面设计

### 6.1 平台运营总览

位置建议：

- 管理后台首页或独立“运营数据”页。

核心模块：

- 今日 / 7 日 / 30 日访问趋势
- 注册转化漏斗
- 任务创建漏斗
- 生成到部署漏斗
- 渠道质量排行
- 高意向事件排行
- 活跃部署应用数
- 部署失败阶段排行

默认回答：

- 今天流量从哪里来？
- 访问是否转化为注册？
- 注册是否转化为创建任务？
- 创建任务是否转化为部署？
- 哪些来源带来的用户质量更高？

### 6.2 部署工作台站点数据

面向应用 owner，回答“我的应用上线后表现如何”。

核心模块：

- 总览：pageviews、visits、visitors、bounce rate、avg session duration、active visitors
- 趋势：pageviews / visits；visitors 放在总览和维度排行中展示
- 页面：top paths、entry pages、exit pages
- 来源：referrers、channels、domains、query；UTM 分组放到 P1
- 受众：country、region、city、language
- 设备：device、browser、os、screen
- 事件：top events、event series
- 质量：客户端错误事件、Core Web Vitals 事件，若已采集

展示规则：

1. 有真实数据时展示图表和排行。
2. 绑定成功但暂无数据时展示“等待线上访问数据”。
3. 读取失败时展示错误状态和最近一次摘要。
4. 不渲染伪造趋势或排行。

### 6.3 会话级生成效果页

面向 OneCEO 内部运营，回答“用户是否完成了从 prompt 到部署的主路径”。

核心模块：

- prompt submit -> first response -> file generated -> preview open -> deploy start -> deploy success
- 各阶段耗时 bucket
- 各阶段失败率
- 按模板类型、入口页面、渠道拆分

第一阶段可以只做后台聚合，不必暴露给普通用户。

### 6.4 Umami 原生后台跳转

OneCEO 工作台应提供“在 Umami 查看完整报表”的内部跳转能力，但要限制在管理态或内部账号可见。

用户侧不直接暴露 Umami 后台链接，避免权限和跨站点数据泄露。

## 7. 后端接口设计

### 7.1 扩展 Umami service

在 `apps/api/src/services/umami-analytics-service.ts` 中补充：

```ts
getWebsiteStats(websiteId, range, filters?)
getWebsitePageviews(websiteId, range, unit, filters?)
getWebsiteMetrics(websiteId, range, type, filters?)
getWebsiteExpandedMetrics(websiteId, range, type, filters?)
getWebsiteEventSeries(websiteId, range, unit, filters?)
getWebsiteDateRange(websiteId)
```

第一阶段支持的 metrics type：

```text
path
entry
exit
title
query
referrer
channel
domain
country
region
city
browser
os
device
language
screen
event
hostname
tag
```

暂不把 `distinctId` 暴露给前端，避免把它误用成用户画像。

P0 不要求接入 reports API。UTM、funnel、goal、journey、retention 这类运营报表进入 P1/P2 时再通过 reports API 或 OneCEO 自有业务聚合承载。

### 7.2 部署工作台统计详情接口

保留现有部署状态接口里的 `analytics` 摘要，同时新增详情接口：

```text
GET /api/task-creation/sessions/:sessionId/deployment/analytics/details?range=7d
```

Umami `pageviews` API 返回趋势字段为 `pageviews` 和 `sessions`。OneCEO 对外响应统一把 `sessions` 归一化为 `visits`，避免前端同时处理 `sessions` / `visits` 两套命名。

返回结构：

```ts
type DeploymentAnalyticsDetails = {
  provider: 'umami';
  status: 'tracking' | 'bound' | 'pending_domain' | 'unconfigured' | 'error';
  websiteId?: string;
  domain?: string;
  range: '24h' | '7d' | '30d';
  summary: {
    pageviews?: number;
    visits?: number;
    visitors?: number;
    bounces?: number;
    bounceRate?: number;
    totalTime?: number;
    avgSessionDuration?: number;
    events?: number;
    activeVisitors?: number;
  };
  timeseries: Array<{
    timestamp: string;
    pageviews?: number;
    visits?: number;
  }>;
  pages: {
    topPaths: AnalyticsMetricRow[];
    entryPages: AnalyticsMetricRow[];
    exitPages: AnalyticsMetricRow[];
  };
  acquisition: {
    referrers: AnalyticsMetricRow[];
    channels: AnalyticsMetricRow[];
    domains: AnalyticsMetricRow[];
    queries: AnalyticsMetricRow[];
    utm?: {
      sources: AnalyticsMetricRow[];
      mediums: AnalyticsMetricRow[];
      campaigns: AnalyticsMetricRow[];
    };
  };
  audience: {
    countries: AnalyticsMetricRow[];
    regions: AnalyticsMetricRow[];
    cities: AnalyticsMetricRow[];
    languages: AnalyticsMetricRow[];
  };
  technology: {
    devices: AnalyticsMetricRow[];
    browsers: AnalyticsMetricRow[];
    operatingSystems: AnalyticsMetricRow[];
    screens: AnalyticsMetricRow[];
  };
  events: {
    topEvents: AnalyticsMetricRow[];
    series: Array<{ event: string; timestamp: string; count: number }>;
  };
  updatedAt: string;
  error?: string;
};

type AnalyticsMetricRow = {
  name: string;
  visitors?: number;
  visits?: number;
  pageviews?: number;
  bounces?: number;
  totalTime?: number;
  count?: number;
};
```

### 7.3 平台运营总览接口

新增：

```text
GET /api/platform/analytics/overview?range=7d
```

该接口只读取 `UMAMI_PLATFORM_WEBSITE_ID` 和 OneCEO 自己数据库中的业务事件聚合，不接受任意 websiteId 透传。

返回：

- traffic summary
- acquisition breakdown
- activation funnel
- generation funnel
- deployment funnel
- top pages
- top events
- failure breakdown

### 7.4 事件上报策略

浏览器页面使用 Umami tracker 上报前端事件。

后端主链事件不能只依赖浏览器触发，应在业务服务成功或失败时同步写入 OneCEO 自己的事件表或审计日志，再按需要映射到运营聚合。原因：

- 部署成功、agent run complete、sandbox failure 等事件未必都有浏览器页面在线。
- 后端事件更适合作为转化漏斗的事实来源。
- Umami 用于流量和前端行为，OneCEO DB 用于强业务事实，两者在运营接口里汇总。

## 8. 数据安全与合规

必须遵守：

1. 平台级 websiteId 只用于平台级统计，不进入用户部署模板。
2. 用户部署应用只能读取自身 metadata 中绑定的 websiteId。
3. 前端不提供任意 websiteId 查询参数。
4. API 侧按 session ownership 校验部署会话归属。
5. 事件 properties 不记录 prompt 原文、代码、邮箱、手机号、token、密钥、支付信息、报错堆栈原文。
6. 所有高基数字段必须 bucket 化，例如 duration、file count、error category。
7. 管理后台可以看平台聚合，普通用户只能看自己部署应用统计。

## 9. 分阶段实施

### 9.1 P0：先把运营基础数据打通

目标：

- 平台级 website 配置化。
- 部署应用多维统计详情可读。
- OneCEO 主路径前端关键事件可采集。

实施：

1. 增加 `UMAMI_PLATFORM_WEBSITE_ID` 配置读取。
2. 扩展 Umami API service：stats、pageviews、metrics、metrics/expanded、events/series、daterange。
3. 增加部署会话 analytics details API。
4. 补前端类型和部署工作台站点数据 UI。
5. 在平台首页、登录注册、任务创建、部署工作台补前端关键事件。
6. 增加单元测试覆盖 Umami payload 解析、空数据、错误状态、未配置状态。

### 9.2 P1：做运营漏斗

目标：

- 形成访问 -> 注册 -> 创建任务 -> 生成 -> 部署成功的完整漏斗。

实施：

1. 后端补业务事实事件聚合。
2. 新增平台运营总览接口。
3. 管理后台展示 acquisition / activation / generation / deployment funnel。
4. 接入 UTM 分组、目标、漏斗相关 reports API 或 OneCEO 自有聚合。
5. 支持按 range、channel、entry page、template type 过滤。

### 9.3 P2：做留存和质量分析

目标：

- 识别长期留存、复用、质量问题对转化的影响。

实施：

1. 基于 Umami cohorts / journeys / retention 思路，先做 OneCEO 自有轻量 cohort 聚合。
2. 补 generated app 访问留存：部署后 1d / 7d 是否仍有访问。
3. 补性能和错误事件：Core Web Vitals、client error、deploy phase error。
4. 输出周报或管理后台运营摘要。

## 10. 验收标准

1. 指定 websiteId 可以通过平台配置读取，而不是写死在业务代码中。
2. 部署工作台能展示 Umami 真实多维数据：页面、来源、地区、设备、浏览器、系统、事件。
3. 平台关键路径事件至少覆盖：访问、注册、创建任务、提交 prompt、生成完成、部署开始、部署成功、部署失败。
4. 没有数据时 UI 不显示伪造趋势或排行。
5. API 读取失败时返回 `error` 状态，不影响部署主链。
6. 用户部署应用仍保持独立 website 绑定，不与平台级 website 混用。
7. 测试覆盖 `stats`、`pageviews`、`metrics`、`metrics/expanded`、`events/series`、空数据、错误状态。
8. 事件属性审计通过，不包含敏感原文。

## 11. 待用户确认

进入代码实现前，需要确认：

1. 用户提供的 `websiteId=6af729e4-2cdb-4a46-9c15-ee7e2fe8438a` 是否就是 OneCEO 平台级统计源。
2. 平台运营总览是否放入管理后台，而用户侧部署工作台只看单应用统计。
3. 第一阶段是否按 P0 实施：配置化平台 website、多维统计详情、关键事件埋点，不立即做完整留存和 cohort UI。

确认后，本文件状态应更新为 `[yyyymmdd-hhmm已采用]`，再进入代码实现。

## 12. 参考依据

- Umami v3 docs：核心分析、事件、高阶洞察、sessions、teams、API。
- Umami website statistics API：active、daterange、events/series、metrics、metrics/expanded、pageviews、stats。
- Umami funnel guide：页面和事件可组合为 2-7 步转化漏斗。
- Umami cohorts docs：可按访问 URL 或触发事件定义用户群组。
