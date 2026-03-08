import type { ConnectorKey } from "@/lib/connectors-client";

export type ConnectorGuideLink = {
  label: string;
  href: string;
  description: string;
};

export type ConnectorGuide = {
  intro: string;
  quickLinks: ConnectorGuideLink[];
  steps: string[];
  tips?: string[];
  exampleLabel?: string;
  exampleValue?: string;
};

export const POSTGRES_DSN_TEMPLATE =
  "postgresql://user:password@host:5432/database?sslmode=require";

export const CONNECTOR_GUIDES: Record<ConnectorKey, ConnectorGuide> = {
  github: {
    intro:
      "推荐优先使用 GitHub OAuth；如果你已经有 Personal Access Token，也可以直接粘贴后保存。",
    quickLinks: [
      {
        label: "GitHub Token Page",
        href: "https://github.com/settings/personal-access-tokens/new",
        description: "创建 fine-grained personal access token",
      },
      {
        label: "GitHub Docs",
        href: "https://docs.github.com/github/extending-github/git-automation-with-oauth-tokens",
        description: "查看 token 类型、权限和常见限制",
      },
    ],
    steps: [
      "打开 GitHub token 页面，优先创建 fine-grained PAT。",
      "给目标仓库和需要的 API 权限授权，通常至少需要仓库读取权限。",
      "复制新生成的 token；GitHub 只会完整展示一次。",
    ],
    tips: [
      "如果仓库在组织下并启用了 SSO，token 创建后可能还需要额外授权。",
      "手动保存 token 时会加密存储；留空不会覆盖当前 secret。",
    ],
  },
  slack: {
    intro:
      "优先使用 Slack OAuth；如果你已经在 Slack App 后台拿到 token，也可以直接手动配置。",
    quickLinks: [
      {
        label: "Slack Your Apps",
        href: "https://api.slack.com/apps/",
        description: "创建或打开现有 Slack App",
      },
      {
        label: "Slack Token Types",
        href: "https://api.slack.com/concepts/token-types",
        description: "确认应使用 bot token、user token 还是 app token",
      },
    ],
    steps: [
      "进入 Your Apps，创建或选择一个 Slack App。",
      "在 OAuth & Permissions 中配置 scopes，并安装到目标 workspace。",
      "复制生成的 token；通常填 bot token，格式类似 xoxb-...",
    ],
    tips: [
      "具体填哪种 token 取决于部署里的 Slack MCP adapter，默认优先使用 Bot token。",
      "如果能力不生效，先检查 workspace install 和 scopes 是否完整。",
    ],
  },
  notion: {
    intro:
      "优先使用 Notion OAuth；如果你已经创建了 integration，也可以直接粘贴 integration secret。",
    quickLinks: [
      {
        label: "My Integrations",
        href: "https://www.notion.so/my-integrations",
        description: "创建或管理 Notion integration",
      },
      {
        label: "Notion Integration Guide",
        href: "https://developers.notion.com/docs/create-a-notion-integration",
        description: "查看 integration 创建和授权说明",
      },
      {
        label: "Notion Authorization",
        href: "https://developers.notion.com/guides/get-started/authorization",
        description: "查看 OAuth 和页面授权方式",
      },
    ],
    steps: [
      "打开 My integrations，新建或进入已有 integration。",
      "在 integration 配置页复制 Internal Integration Secret 或 access token。",
      "回到 Notion 页面，把目标 page/database 通过 Add connections 分享给该 integration。",
    ],
    tips: [
      "没有把页面或数据库共享给 integration 时，连接成功后仍会因为权限不足而读不到内容。",
      "留空 secret 字段会保留当前已保存的凭据。",
    ],
  },
  postgres: {
    intro:
      "从你的数据库托管平台控制台复制标准 PostgreSQL DSN/URI 即可，无需 OAuth。",
    quickLinks: [
      {
        label: "PostgreSQL DSN Docs",
        href: "https://www.postgresql.org/docs/current/libpq-connect.html",
        description: "查看官方 connection string / URI 格式",
      },
    ],
    steps: [
      "在数据库提供商控制台找到 connection string、URI 或 connection details。",
      "复制完整 DSN，保留 host、port、database 和 sslmode 等参数。",
      "如果用户名或密码包含特殊字符，确保它们已经做过 URL encode。",
    ],
    tips: [
      "常见云数据库会要求 sslmode=require 或等效 SSL 参数。",
      "保存时可以附带一个 display name，方便后续在会话里识别。",
    ],
    exampleLabel: "Copy DSN Template",
    exampleValue: POSTGRES_DSN_TEMPLATE,
  },
};
