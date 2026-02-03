# oneceo.ai - AI Agent 项目管理平台

一个高还原度的 AI Agent 项目管理平台，支持总经理视图、项目管理、任务分配、员工管理等核心功能。

## 快速开始

### 环境要求

- Node.js 18.0+
- pnpm 8.0+

### 安装

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build

# 启动生产服务器
pnpm start
```

### 访问应用

开发模式：http://localhost:3000

## 技术栈

- **前端框架**: React 19 + TypeScript
- **样式方案**: Tailwind CSS 4
- **路由管理**: Wouter
- **动画库**: Framer Motion
- **UI 组件**: Radix UI
- **构建工具**: Vite 7

## 核心功能

- ✅ 项目管理系统（项目-经理-员工三层级）
- ✅ 总经理视图（统计数据 + AI 对话）
- ✅ 任务详情页面（对话式布局）
- ✅ 用户菜单系统（用户信息 + 积分状态）
- ✅ 统一的输入框设计
- ✅ 响应式布局
- ✅ 可折叠侧边栏

## 项目结构

```
├── client/          # 前端代码
│   ├── public/     # 静态资源
│   └── src/        # 源代码
│       ├── components/  # 可复用组件
│       ├── pages/      # 页面组件
│       └── lib/        # 工具函数
├── server/         # 后端代码
├── shared/         # 共享类型
└── package.json    # 项目配置
```

## 文档

详细的技术文档和部署指南请参考 `oneceo-platform-delivery.md`

## 许可证

MIT License
