# OneCEO 默认模板与包选型 [尚未采用]

## 1. 设计目标

OneCEO 第一阶段不做多模板并行，而是先确定一套官方模板，满足下面四件事：

1. agent 容易生成
2. 平台容易部署
3. 工作台容易识别
4. 统计、数据库、身份能力容易注入

## 2. 官方模板建议

建议第一阶段只维护一个官方模板：

- `react + vite + express + trpc + drizzle + pg`

原因：

- 与参考项目结构最接近，agent 学习成本最低
- 与 OneCEO 当前 Railway 部署链路兼容
- 与当前 `platform-deployment-account-service` 的 Postgres 能力对齐
- 既能承载纯前端网站，也能承载轻量全栈应用

## 3. 官方模板目录契约

建议官方模板固定为：

```text
/
├── client/
│   ├── index.html
│   ├── public/
│   └── src/
├── server/
│   ├── _core/
│   ├── index.ts
│   ├── routers.ts
│   └── db.ts
├── shared/
├── drizzle/
├── oneceo.manifest.json
├── package.json
├── vite.config.ts
├── tsconfig.json
└── vitest.config.ts
```

说明：

- 目录尽量延续参考项目，减少 agent 迁移成本。
- 新增 `oneceo.manifest.json` 作为平台识别与部署契约。

## 4. 默认包选型

## 4.1 必选包

| 层级 | 默认包 | 说明 |
| --- | --- | --- |
| 前端运行时 | `react` `react-dom` | 官方前端基线 |
| 构建 | `vite` `@vitejs/plugin-react` | 与参考项目保持接近 |
| 服务端 | `express` | 统一同源 API/BFF 与静态托管 |
| API 契约 | `@trpc/server` `@trpc/client` `@trpc/react-query` | 与当前模板链路最匹配 |
| 数据请求 | `@tanstack/react-query` | 与 tRPC 配套 |
| 类型与序列化 | `zod` `superjson` | 输入校验与序列化基线 |
| 数据层 | `drizzle-orm` `drizzle-kit` `pg` | 明确切到 Railway Postgres |
| 基础 UI | `tailwindcss` `@tailwindcss/vite` `clsx` `tailwind-merge` `lucide-react` | 保持轻量且统一 |
| 工具链 | `typescript` `tsx` `esbuild` | dev/build 基线 |
| 测试 | `vitest` | 默认单测能力 |
| 平台运行时 | `@oneceo/app-runtime` | OneCEO 自己的运行时注入包，第一阶段建议以 workspace package 形式维护 |

## 4.2 按需包

以下包不建议全量默认装入，而应按 agent 真实需要添加：

- `react-hook-form`
- `@hookform/resolvers`
- `framer-motion`
- `recharts`
- `sonner`
- `@radix-ui/*`
- `shadcn/ui` 组件集合

原则：

- OneCEO 应默认提供一个很小的基础模板。
- UI 复杂度上升时，再由 agent 按需装组件，而不是模板一次性灌满几十个包。

## 4.3 明确不作为默认包的依赖

以下不建议进入官方模板默认集：

- `mysql2`
- `vite-plugin-manus-runtime`
- Manus OAuth 相关 SDK
- forge storage / forge notification 私有依赖
- 带 patch 的 `wouter`

说明：

- 参考项目里 `wouter` 还带了 patch，这对 OneCEO 的稳定性不是好信号。
- 官方模板不应继承这种“已经需要补丁”的路由依赖。
- 第一阶段如只有单页，不必强制路由依赖；如必须多页，优先使用稳定且无 patch 的官方路由方案。

## 5. 官方脚本契约

官方模板必须保证以下脚本存在：

```json
{
  "scripts": {
    "dev": "tsx watch server/index.ts",
    "build": "vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
    "start": "node dist/index.js",
    "check": "tsc --noEmit",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  }
}
```

说明：

- `dev/build/start/check/test` 是部署合规最小集合。
- `db:*` 只有 manifest 声明数据库能力时才强制要求。

## 6. `oneceo.manifest.json` 契约

每个生成应用必须默认产出一个 manifest。

建议结构：

```json
{
  "templateVersion": "1.0.0",
  "appType": "web_app",
  "stack": "react_vite_express_trpc_pg",
  "build": {
    "command": "pnpm build",
    "outputDir": "dist/public"
  },
  "start": {
    "command": "node dist/index.js",
    "portEnv": "PORT"
  },
  "healthcheck": {
    "path": "/api/system/health"
  },
  "features": {
    "analytics": true,
    "userTracking": true,
    "database": "railway_postgres",
    "auth": "optional",
    "objectStorage": false
  },
  "runtime": {
    "framework": "vite",
    "transport": "trpc"
  }
}
```

manifest 的意义：

- agent 输出的项目有明确部署说明
- 平台在部署前能做自动合规检查
- 工作台能知道该项目支持哪些能力

## 7. 官方模板必须内建的文件

至少需要内建：

- `client/index.html`
  - 允许平台注入统计脚本
- `server/index.ts`
  - 启动 Express 与静态服务
- `server/routers.ts`
  - 提供业务与系统路由
- `server/_core/context.ts`
  - 注入身份上下文
- `server/db.ts`
  - 懒加载数据库连接
- `drizzle/schema.ts`
  - 数据模型基线
- `shared/const.ts`
  - 共享常量

## 8. 模板裁剪原则

为了稳定性，模板必须满足：

1. 先保证部署成功率，再谈功能富集。
2. 先保证统计与身份契约统一，再谈业务自由度。
3. 先保证平台能自动识别，再谈 agent 个性化发挥。

## 9. 当前建议的审查点

- 是否同意第一阶段只保留一套官方模板。
- 是否同意数据库明确切到 `pg`。
- 是否同意 `oneceo.manifest.json` 成为强制产物。
- 是否同意把很多 UI 依赖从“默认安装”改为“按需注入”。
