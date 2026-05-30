# 设置 / SEO [20260530-已采用]

## 背景

当前 `oneceo.ai` 已经提交到 Google，但站点仍以 SPA 壳为主：

- 首页首屏可抓取文本不足，搜索引擎只能先看到通用标题与空根节点。
- `robots.txt`、`sitemap.xml`、canonical、社交分享卡片、结构化数据缺少统一出口。
- 登录页、工作台页、会话页、API 路径会消耗抓取预算，但本身不适合作为搜索落地页。

本次改造目标不是做后台配置页，而是先补齐官网最基础的 SEO 基础设施。

## 目标

1. 让 Google 能稳定识别 `oneceo` 的品牌名、站点定位与首页入口。
2. 让首页成为唯一主索引落地页。
3. 控制抓取边界，避免搜索引擎把登录态工作台和技术接口误当成公开内容。
4. 补齐社交分享元信息，保证外部传播时标题、摘要和封面稳定。

## 本次范围

### 1. 静态 Head 信息

- 首页默认 `title`
- `meta description`
- canonical
- Open Graph
- Twitter Card
- theme-color

### 2. 结构化数据

- `Organization`
- `WebSite`

仅声明已有事实，不写虚假的评分、价格、人数或 FAQ rich result 诱导字段。

### 3. 服务端抓取控制

- `robots.txt`
- `sitemap.xml`
- 对非首页路由返回 `X-Robots-Tag: noindex, nofollow`
- 对 `/api`、`/socket.io` 在 `robots.txt` 中明确禁止抓取

## 索引策略

### 应索引

- `/`

### 不应索引

- `/login`
- `/register`
- `/home`
- `/search`
- `/library`
- `/projects`
- `/project/:id`
- `/manager-node`
- `/manager-view`
- `/new-task`
- `/session/:sessionId`
- `/task/:projectId/:managerId/:taskId`
- 所有 OAuth callback 路径
- `/api/*`
- `/socket.io/*`

原则：当前阶段只把首页作为品牌与获客入口，产品工作台保持可访问但不参与自然搜索竞争。

## 实现方案

### 前端

- 在 `apps/web/client/index.html` 写入默认 SEO 元信息与结构化数据。
- 在客户端按路由同步 `title / description / robots / canonical / og:url`。

### 服务端

- 在 `apps/web/server/index.ts` 基于 `FRONTEND_URL` 动态输出 `robots.txt` 与 `sitemap.xml`。
- 对非首页 HTML 路由设置 `X-Robots-Tag`，避免 Google 继续索引工作台薄页面。

### 共享配置

- 在 `apps/web/shared/` 维护站点 SEO 常量、标题文案、路径索引策略和 sitemap/robots 生成逻辑。

## 非目标

- 不做后台“SEO 设置页”配置化。
- 不新增首页营销文案、博客、案例库或文档中心等内容体系。
- 不做 SSR/SSG 重构。
- 不承诺“保证有流量”，只负责把站内 SEO 基础设施和可索引内容补到位。

## 验证

1. `pnpm check`
2. 定向单测验证 `robots/sitemap/indexable route` 逻辑
3. 本地启动后检查：
   - `/robots.txt`
   - `/sitemap.xml`
   - `/` 的标题、描述、canonical、OG 标签
   - `/home` 响应头是否带 `X-Robots-Tag`

## 后续建议

- 接入 Google Search Console，提交 `https://oneceo.ai/sitemap.xml`
- 结合 Umami 观察首页来源、着陆页与注册转化
- 后续如果要扩大自然流量，应新增公开内容页，而不是继续把工作台页面暴露给搜索引擎
