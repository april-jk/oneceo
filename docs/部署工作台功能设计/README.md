# 部署工作台功能设计

本目录用于沉淀 OneCEO 内容预览中“部署”工作台的功能层级、文档结构与后续设计方案。

## 目录结构

```text
docs/部署工作台功能设计/
├── README.md
├── 00_信息架构与设计原则.md
├── 01_发布与访问/
│   └── 功能设计.md
├── 02_仪表盘/
│   ├── 功能设计.md
│   ├── 01_部署数据.md
│   └── 02_站点数据.md
├── 03_数据库/
│   ├── 功能设计.md
│   ├── 01_数据浏览与编辑.md
│   ├── 02_数据库设置与结构管理.md
│   └── 03_Railway_Postgres创建与连接信息.md
├── 04_存储桶/
│   └── 功能设计.md
└── 05_设置/
    ├── README.md
    ├── 01_通用.md
    ├── 02_域名.md
    ├── 03_通知.md
    ├── 04_支付.md
    ├── 05_SEO.md
    ├── 06_密钥.md
    └── 07_GitHub.md
```

## 功能层级

一级功能：
- 部署工作台

二级功能：
- 发布与访问
- 仪表盘
- 数据库
- 存储桶
- 设置

仪表盘内部切换视图：
- 仪表盘 / 部署数据
- 仪表盘 / 站点数据

三级功能：
- 设置 / 通用
- 设置 / 域名
- 设置 / 通知
- 设置 / 支付
- 设置 / SEO
- 设置 / 密钥
- 设置 / GitHub

## 文档目标

- 明确部署工作台的产品边界与信息架构。
- 区分“已经有前端壳子”和“需要后端能力支撑”的部分。
- 为后续 API、数据模型、交互实现提供审查基线。
- 明确哪些模块当前只保留入口、不进入开发。

当前额外约束：

- `存储桶` 只保留入口，不进入当前开发。
- `设置` 保留前端 UI，但其具体子条目当前不进入设计，等待后续统一规划。

## 审核建议

- 先看 [00_信息架构与设计原则.md](/Users/eunice/codingProject/oneceo/docs/部署工作台功能设计/00_信息架构与设计原则.md)。
- 再按二级功能逐个审查。
- 仪表盘建议继续看：
  - [02_仪表盘/功能设计.md](/Users/eunice/codingProject/oneceo/docs/部署工作台功能设计/02_仪表盘/功能设计.md)
  - [02_仪表盘/01_部署数据.md](/Users/eunice/codingProject/oneceo/docs/部署工作台功能设计/02_仪表盘/01_部署数据.md)
  - [02_仪表盘/02_站点数据.md](/Users/eunice/codingProject/oneceo/docs/部署工作台功能设计/02_仪表盘/02_站点数据.md)
- 数据库建议继续看：
  - [03_数据库/功能设计.md](/Users/eunice/codingProject/oneceo/docs/部署工作台功能设计/03_数据库/功能设计.md)
  - [03_数据库/01_数据浏览与编辑.md](/Users/eunice/codingProject/oneceo/docs/部署工作台功能设计/03_数据库/01_数据浏览与编辑.md)
  - [03_数据库/02_数据库设置与结构管理.md](/Users/eunice/codingProject/oneceo/docs/部署工作台功能设计/03_数据库/02_数据库设置与结构管理.md)
  - [03_数据库/03_Railway_Postgres创建与连接信息.md](/Users/eunice/codingProject/oneceo/docs/部署工作台功能设计/03_数据库/03_Railway_Postgres创建与连接信息.md)
- `设置` 当前只需确认保留 UI 入口，不需要继续审具体子条目设计，见 [05_设置/README.md](/Users/eunice/codingProject/oneceo/docs/部署工作台功能设计/05_设置/README.md)。
