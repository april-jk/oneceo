# Manus 参考项目拆解 [尚未采用]

## 1. 拆解范围

本次直接对照的参考项目是：

- `referance/game-2048/package.json`
- `referance/game-2048/vite.config.ts`
- `referance/game-2048/client/index.html`
- `referance/game-2048/client/src/main.tsx`
- `referance/game-2048/client/src/const.ts`
- `referance/game-2048/client/src/_core/hooks/useAuth.ts`
- `referance/game-2048/server/_core/index.ts`
- `referance/game-2048/server/routers.ts`
- `referance/game-2048/server/_core/context.ts`
- `referance/game-2048/server/_core/sdk.ts`
- `referance/game-2048/server/storage.ts`
- `referance/game-2048/server/_core/notification.ts`
- `referance/game-2048/drizzle/schema.ts`
- `referance/game-2048/client/public/__manus__/debug-collector.js`

目标不是复刻 2048 业务，而是识别 Manus 在“可生成、可运行、可部署、可追踪”上的平台性做法。

## 2. 参考项目已经体现出的平台化能力

### 2.1 目录结构被刻意模板化

参考项目不是随意堆代码，而是天然具备统一结构：

- `client/`：Vite 前端
- `server/`：Express + tRPC 服务端
- `shared/`：共享常量和错误定义
- `drizzle/`：数据库 schema 与 migration
- `client/public/__manus__/`：平台调试资源

这说明 Manus 并不是“让 agent 自由发挥项目骨架”，而是先给出稳定骨架，再让 agent 填业务。

### 2.2 构建链路被刻意压成单一形态

`package.json` 里只有一套清晰的脚本：

- `dev`: `tsx watch server/_core/index.ts`
- `build`: `vite build` + `esbuild` 打包服务端
- `start`: `node dist/index.js`
- `check`: `tsc --noEmit`
- `test`: `vitest run`

这类模板的价值在于：

- agent 不需要为“如何启动、如何构建、如何检查”临时做决定
- 部署平台可以稳定读取统一入口
- 部署失败时更容易自动诊断

### 2.3 平台运行时是通过注入而不是业务代码硬编码完成的

参考项目里可以看到三类注入：

1. `vite.config.ts`
   - 注入 `vite-plugin-manus-runtime`
   - 开发态把 `debug-collector.js` 自动插入页面
2. `client/index.html`
   - 通过环境变量注入 Umami 统计脚本
3. `server/_core/env.ts`
   - 通过环境变量注入 OAuth、存储、通知等平台能力

这说明 Manus 的关键思路不是让业务应用自己选统计、自己配 OAuth、自己接日志，而是由模板预留钩子、由平台在运行时填值。

### 2.4 调试采集是模板原生能力

`client/public/__manus__/debug-collector.js` 和 `vite.config.ts` 组成了一条开发态调试链路：

- 自动采集 console
- 自动采集 network request
- 自动采集语义化 UI 事件
- 自动做敏感字段脱敏
- 自动上报到 `/__manus__/logs`
- 自动在本地写入 `.manus-logs/*.log`

这类能力非常关键，因为它让平台在“生成之后但没完全稳定之前”还能观察真实行为。

### 2.5 认证、存储、通知都被平台代理化

参考项目并没有把第三方 SDK 铺到业务层，而是走平台封装：

- `server/_core/sdk.ts`：Manus OAuth 认证与 session
- `server/storage.ts`：平台提供的 storage proxy
- `server/_core/notification.ts`：平台通知服务

这个模式值得复用，因为它降低了 agent 写业务代码时的上下文负担。

## 3. 参考项目默认使用的包，透露了什么策略

## 3.1 栈选择倾向

参考项目核心包可以归纳为：

- 前端：`react`、`vite`
- UI：`tailwindcss`、`shadcn/radix`
- API：`express`、`@trpc/*`
- 类型与校验：`typescript`、`zod`、`superjson`
- 数据：`drizzle-orm`
- 状态与数据请求：`@tanstack/react-query`
- 构建：`tsx`、`esbuild`
- 测试：`vitest`

这套组合的特点是：

- 全 TypeScript
- 全栈结构统一
- build 和 start 很容易平台化
- agent 改代码时容易保持一致风格

## 3.2 参考项目中值得保留的依赖策略

值得保留：

- `react + vite + express` 这一类前后端同仓模板
- `tRPC + react-query + zod + superjson`
- `drizzle` 作为 schema 与迁移入口
- `vitest` 作为默认单元测试
- `shadcn/radix` 作为按需 UI 组件来源

## 3.3 参考项目中不应直接继承的依赖策略

不应直接继承：

- `mysql2`
  - OneCEO 当前部署工作台与 `platform-deployment-account-service` 已明确围绕 Railway Postgres
- `vite-plugin-manus-runtime`
  - 这是 Manus 私有运行时插件，不是 OneCEO 可直接复用的契约
- Manus OAuth / forge storage / forge notification 私有链路
  - 这些都要换成 OneCEO 平台自己的运行时与服务代理
- 全量 UI 依赖一次性装满
  - 参考项目里包含大量 Radix 组件，但 OneCEO 官方模板不应该默认把所有组件都塞进去

## 4. 参考项目最有价值的注入点

| 注入点 | 参考实现 | 能学到的东西 | OneCEO 处理方式 |
| --- | --- | --- | --- |
| 页面头部统计脚本 | `client/index.html` | 统计要模板预留，不要事后手工补 | 保留思路，改成 OneCEO 统计入口 |
| 开发态调试脚本 | `vite.config.ts` + `debug-collector.js` | 调试采集要自动开启而不是靠开发者自觉 | 复用思路，换成 OneCEO debug collector |
| 认证重定向 | `client/src/const.ts` | 回调地址要在运行时根据当前 origin 计算 | 继续保留运行时生成逻辑 |
| 认证上下文 | `server/_core/context.ts` | 平台身份识别要在服务端统一收口 | OneCEO 走自己的 app user / session 体系 |
| 存储与通知 | `server/storage.ts` / `notification.ts` | 对外能力要统一代理 | OneCEO 应提供平台 SDK 或 BFF 代理 |

## 5. 对 OneCEO 最有启发的不是“代码”，而是“约束”

从参考项目里抽出的真正方法论是：

1. 官方模板先行
2. 平台能力注入化
3. 统一脚本契约
4. 统一健康检查
5. 统一日志与调试采集
6. 统一身份与统计契约

如果没有这些约束，只是让 agent “尽量写一个可部署项目”，部署成功率、统计一致性和后续维护成本都会失控。

## 6. OneCEO 需要保留、替换、禁止的部分

### 6.1 必须保留

- 模板化目录结构
- 统一 dev/build/start/check/test 脚本
- HTML / 服务端双层注入能力
- 默认健康检查入口
- 调试采集与日志基线

### 6.2 必须替换

- Manus OAuth -> OneCEO 用户态身份体系
- Manus runtime plugin -> OneCEO runtime package / Vite plugin
- Umami 直接占位 -> OneCEO 统计注入入口
- `mysql2` -> `pg` + Drizzle Postgres
- forge storage/notification -> OneCEO 平台代理

### 6.3 必须禁止

- 每个生成项目自由选择部署栈
- 每个项目自行挑统计 SDK
- 业务代码直连平台私有凭据
- 没有 manifest 和健康检查就进入部署

## 7. 结论

参考项目给 OneCEO 的最重要启发不是“照搬包名”，而是：

- 平台必须先把“部署模板、注入契约、统计契约、调试契约”做成默认设施，
- agent 再在设施上生成业务应用。

这也是后续文档全部围绕“官方模板 + 运行时注入 + 平台统计 + agent 合规检查”展开的原因。
