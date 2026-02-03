# oneceo.ai - AI Agent 项目管理平台

一个基于 AI Agent 的智能项目管理平台，支持项目-经理-员工三层级智能调度系统。

## 项目简介

oneceo.ai 是一个创新的项目管理平台，通过 AI Agent 技术实现智能化的项目规划、任务分配和执行管理。系统采用三层级架构：

**CEO Agent（总经理）**：负责项目规划、资源分配和战略决策  
**Manager Agent（项目经理）**：负责任务分解、团队管理和进度跟踪  
**Employee Agent（员工）**：负责具体任务执行和交付

## 项目结构

```
oneceo/
├── apps/
│   ├── web/          # 前端应用（React + Vite + Tailwind CSS）
│   └── api/          # 后端 API（Express + Socket.io + BullMQ）
├── packages/
│   ├── shared/       # 共享类型定义和工具函数
│   ├── database/     # 数据库 Schema 和迁移（Prisma）
│   └── config/       # 共享配置文件
├── docs/             # 项目文档
│   ├── api/         # API 文档
│   ├── architecture/# 架构设计文档
│   └── development/ # 开发指南
└── scripts/          # 构建和部署脚本
```

## 快速开始

### 环境要求

- **Node.js**: 18.0 或更高版本
- **pnpm**: 8.0 或更高版本
- **PostgreSQL**: 14 或更高版本（可选，用于数据持久化）
- **Redis**: 7 或更高版本（可选，用于任务队列）

### 安装依赖

```bash
# 克隆仓库
git clone https://github.com/april-jk/oneceo.git
cd oneceo

# 安装所有依赖
pnpm install

# 构建共享包
pnpm --filter @oneceo/shared build
```

### 开发模式

```bash
# 同时启动前端和后端开发服务器
pnpm dev

# 或者分别启动
pnpm dev:web    # 前端：http://localhost:3000
pnpm dev:api    # 后端：http://localhost:4000
```

### 生产构建

```bash
# 构建所有应用
pnpm build

# 或者分别构建
pnpm build:web
pnpm build:api
```

## 技术栈

### 前端技术栈

| 技术 | 版本 | 用途 |
|-----|------|------|
| React | 19.2.1 | UI 框架 |
| TypeScript | 5.6.3 | 类型系统 |
| Tailwind CSS | 4.1.14 | 样式框架 |
| Vite | 7.1.7 | 构建工具 |
| Wouter | 3.3.5 | 路由管理 |
| Framer Motion | 12.23.22 | 动画库 |
| Radix UI | - | UI 组件库 |
| Socket.io Client | - | 实时通信 |

### 后端技术栈

| 技术 | 版本 | 用途 |
|-----|------|------|
| Node.js | 18+ | 运行时环境 |
| Express | 4.21.2 | Web 框架 |
| TypeScript | 5.6.3 | 类型系统 |
| Socket.io | 4.8.1 | WebSocket 服务 |
| BullMQ | 5.36.3 | 任务队列 |
| Prisma | 6.5.0 | ORM |
| PostgreSQL | 14+ | 关系数据库 |
| Redis | 7+ | 缓存和队列 |

## 核心功能

### 已实现功能

- ✅ **项目管理系统**：项目-经理-员工三层级管理架构
- ✅ **总经理视图**：统计数据展示和 AI 对话界面
- ✅ **任务详情页面**：对话式任务管理界面
- ✅ **用户系统**：用户信息、积分和会员状态管理
- ✅ **响应式设计**：支持桌面端和移动端
- ✅ **实时通信**：WebSocket 基础架构
- ✅ **类型共享**：前后端共享 TypeScript 类型定义

### 开发中功能

- 🚧 **AI Agent 调度系统**：CEO/Manager/Employee Agent 智能调度
- 🚧 **LLM 集成**：OpenAI GPT-4 / Anthropic Claude 集成
- 🚧 **任务队列系统**：基于 BullMQ 的异步任务处理
- 🚧 **数据持久化**：Prisma + PostgreSQL 数据库集成
- 🚧 **用户认证系统**：JWT 身份验证和权限管理
- 🚧 **文件上传功能**：支持附件上传和管理

### 计划中功能

- 📋 **实时协作**：多用户实时协作编辑
- 📋 **通知系统**：任务提醒和进度通知
- 📋 **数据分析**：项目数据可视化和报表
- 📋 **API 文档**：自动生成的 API 文档
- 📋 **单元测试**：完整的测试覆盖
- 📋 **CI/CD**：自动化测试和部署

## 开发指南

### 添加新的 API 端点

在 `apps/api/src/index.ts` 中添加新的路由：

```typescript
app.get('/api/your-endpoint', (req, res) => {
  res.json({ success: true, data: {} });
});
```

### 添加新的共享类型

在 `packages/shared/src/types/index.ts` 中定义类型：

```typescript
export interface YourType {
  id: string;
  name: string;
}
```

然后在前端或后端导入使用：

```typescript
import type { YourType } from '@oneceo/shared';
```

### 前端使用共享类型

在 `apps/web` 中导入共享类型：

```typescript
import type { Project, Task, Message } from '@oneceo/shared';
```

## 配置说明

### 环境变量

复制 `apps/api/.env.example` 到 `apps/api/.env` 并填写配置：

```bash
cp apps/api/.env.example apps/api/.env
```

主要配置项：

- `PORT`: API 服务器端口（默认 4000）
- `FRONTEND_URL`: 前端应用 URL（用于 CORS）
- `DATABASE_URL`: PostgreSQL 连接字符串
- `REDIS_URL`: Redis 连接字符串
- `OPENAI_API_KEY`: OpenAI API 密钥

## 部署指南

### 使用 Docker（推荐）

```bash
# 构建镜像
docker-compose build

# 启动服务
docker-compose up -d
```

### 手动部署

```bash
# 构建应用
pnpm build

# 启动前端（静态文件服务）
cd apps/web/dist && npx serve -s

# 启动后端
cd apps/api && node dist/index.js
```

## 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'Add some feature'`
4. 推送到分支：`git push origin feature/your-feature`
5. 提交 Pull Request

## 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## 联系方式

- **GitHub**: https://github.com/april-jk/oneceo
- **Issues**: https://github.com/april-jk/oneceo/issues

---

**开发状态**: 🚧 活跃开发中  
**版本**: 1.0.0  
**最后更新**: 2026-02-03
