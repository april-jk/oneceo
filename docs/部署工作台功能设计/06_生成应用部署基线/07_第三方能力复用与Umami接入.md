# 07 第三方能力复用与 Umami 接入 [尚未采用]

## 1. 目的

本文件回答两个落地问题：

1. 参考项目里和统计、运行时、调试相关的能力，哪些可以在 OneCEO 里直接使用。
2. 如果默认选 Umami 作为站点统计基线，平台侧应该如何接入，以及是否需要额外注册账号。

## 2. 结论先行

结论按三类处理：

### 2.1 可以直接用

- Umami 前端 tracker
- `@umami/node`（仅在需要服务端补事件时使用）
- `recharts`（只负责图表展示，不负责采集）

### 2.2 可以参考，但不要直接依赖

- `vite-plugin-manus-runtime`
- `client/public/__manus__/debug-collector.js`

这些体现的是 Manus 的能力边界和注入思路，不应该成为 OneCEO 官方模板的长期依赖。

### 2.3 不能直接用

- Manus Forge / Butterfly Effect 私有 API
- Manus 私有 OAuth、对象存储、通知、图像、地图、LLM 代理链路

这些能力都绑定了参考项目背后的私有平台，不具备 OneCEO 直接复用条件。

## 3. 参考项目里的真实情况

### 3.1 网站统计不是 Manus 自研 SDK

参考项目在前端模板里直接注入的是 Umami 脚本，而不是一个 Manus 私有统计包：

- `client/index.html`
  - `src="%VITE_ANALYTICS_ENDPOINT%/umami"`
  - `data-website-id="%VITE_ANALYTICS_WEBSITE_ID%"`

这意味着：

1. 参考项目的网站访问统计本质上走的是 Umami。
2. Manus 做的更多是“模板默认接入”和“平台注入”，而不是重新发明一套前端访问统计协议。

### 3.2 Manus 自研的是运行时与调试采集

以下两类更接近 Manus 自己的运行时体系：

- `vite-plugin-manus-runtime`
- `client/public/__manus__/debug-collector.js`

其中：

- `vite-plugin-manus-runtime` 负责模板运行时注入与构建期行为约束。
- `debug-collector.js` 负责控制台、网络请求、UI 交互、导航等调试事件的采集与上报。

这两块都不应该被直接当成 OneCEO 的平台标准件，而应改造成：

- `vite-plugin-oneceo-runtime`
- `client/public/__oneceo__/debug-collector.js`

## 4. OneCEO 对第三方能力的处理原则

### 4.1 能直接复用的标准

满足以下条件才允许直接纳入官方模板：

1. 不依赖 Manus 私有域名、私有鉴权或私有后端。
2. 上游维护稳定，协议公开。
3. 可以被平台统一注入、统一配置、统一替换。
4. 不会把生成项目和某个闭源运行时深度绑死。

### 4.2 为什么 Umami 可以直接用

Umami 满足以上条件：

1. 它是独立产品，不依赖 Manus 后端。
2. 支持脚本注入，接入成本低。
3. 可选自托管，也可选 Cloud。
4. 可以由平台统一下发 `websiteId`、`hostUrl`、标签与采集开关。

因此，OneCEO 第一阶段推荐：

- 默认网站统计：Umami
- 默认用户统计：OneCEO 平台自建事件模型
- 默认调试采集：OneCEO 自研 collector

## 5. OneCEO 建议的默认包和注入方式

### 5.1 前端默认

- 不强制安装 Umami npm 包
- 默认通过模板脚本注入 tracker

推荐注入形态：

```html
<script
  defer
  src="%VITE_ANALYTICS_HOST%/script.js"
  data-website-id="%VITE_ANALYTICS_WEBSITE_ID%"
  data-host-url="%VITE_ANALYTICS_HOST%"
></script>
```

说明：

1. 由平台在部署阶段统一写入 `VITE_ANALYTICS_HOST` 与 `VITE_ANALYTICS_WEBSITE_ID`。
2. 生成项目不允许 agent 自由替换站点统计供应商。
3. 若项目声明不需要公开站点统计，再由 manifest 显式关闭。

### 5.2 服务端默认

仅在以下场景使用 `@umami/node`：

- 需要把服务端生成的业务事件补发到 Umami
- 需要把某些后端路由事件和前端访问数据放到同一分析面板

否则第一阶段不默认安装，避免模板体积和复杂度上升。

### 5.3 平台注入

平台需要统一注入：

- `analytics.enabled`
- `analytics.provider`
- `analytics.host`
- `analytics.websiteId`
- `analytics.tag`

这些字段建议进入 `oneceo.manifest.json` 的受控区，而不是让 agent 任意拼写环境变量名。

## 6. Umami 是否需要注册账号

取决于你们选择哪种接入方式：

### 6.1 使用 Umami Cloud

需要。

你需要：

1. 去 Umami Cloud 注册账号。
2. 创建 workspace / website。
3. 拿到 `websiteId`。
4. 把 `hostUrl` 固定为 Umami Cloud 地址。

适合：

- 先快速跑通 MVP
- 暂时不想自己维护分析服务
- 希望最短时间打通站点访问统计

### 6.2 使用自托管 Umami

不需要注册 Umami Cloud 账号。

你们只需要：

1. 自己部署 Umami。
2. 配置 PostgreSQL。
3. 初始化后台管理员账号。
4. 在平台里记录自建 Umami 的 `hostUrl` 与每个站点的 `websiteId`。

适合：

- 强调数据控制权
- 后续希望和 OneCEO 平台后台、租户隔离、数据保留策略一起管理
- 希望把统计服务纳入自己的运维体系

## 7. OneCEO 现阶段推荐

推荐分阶段走：

### 阶段一：先用 Umami 跑通网站统计

- 可优先选择 Umami Cloud
- 目标是尽快把“页面访问、visit、visitor、referrer、device、country”打通
- 平台侧先完成：
  - website 自动创建或人工绑定
  - `websiteId` 注入
  - 工作台“站点数据”真实展示

### 阶段二：再评估是否迁移到自托管

当以下条件明显出现时，再考虑切到自托管：

- 站点数变多
- 需要多租户治理
- 需要更强的数据主权
- 需要和 OneCEO 后台权限系统深度集成

## 8. 不建议的做法

以下做法不建议采用：

1. 直接把 `vite-plugin-manus-runtime` 当成官方模板依赖。
2. 直接把 `__manus__/debug-collector.js` 原样带入生产。
3. 让 agent 在不同项目里自由选择 GA、PostHog、Umami、Plausible。
4. 把“网站访问统计”和“平台用户统计”混成一套前端脚本。

## 9. 最终建议

OneCEO 的标准路线建议固定为：

1. 网站访问统计默认使用 Umami。
2. 平台用户统计、部署日志、调试事件仍由 OneCEO 自己管理。
3. 用 Umami 解决“网站被访问了什么”，不要让它承担“平台内用户、任务、agent、部署治理”的主统计职责。
4. 对 Manus 私有运行时与调试链路，只学设计，不直接依赖其实现。
