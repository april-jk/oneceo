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
      "连接器在 sandbox 外完成配置，进入 sandbox 后只消费已保存的授权。GitHub 推荐优先使用 OAuth；如果你已经有 Personal Access Token，也可以直接粘贴后保存。",
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
      "在 sandbox 外打开 GitHub token 页面，优先创建 fine-grained PAT 或直接走 OAuth。",
      "给目标仓库和需要的 API 权限授权，通常至少需要仓库读取权限。",
      "复制新生成的 token；GitHub 只会完整展示一次。",
    ],
    tips: [
      "如果仓库在组织下并启用了 SSO，token 创建后可能还需要额外授权。",
      "手动保存 token 时会加密存储；留空不会覆盖当前 secret，sandbox 内部会自动复用。",
    ],
  },
  slack: {
    intro:
      "Slack 连接器在 sandbox 外配置，sandbox 内只使用已绑定的 workspace 凭据。优先使用 Slack OAuth；如果你已经在 Slack App 后台拿到 token，也可以直接手动配置。",
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
      "如果能力不生效，先检查 workspace install 和 scopes 是否完整，sandbox 内不会再要求重复授权。",
    ],
  },
  notion: {
    intro:
      "Notion 连接器在 sandbox 外配置，sandbox 内直接复用已保存的授权。优先使用 Notion OAuth；如果你已经创建了 integration，也可以直接粘贴 integration secret。",
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
      "留空 secret 字段会保留当前已保存的凭据，sandbox 内会继续使用旧配置。",
    ],
  },
  supabase: {
    intro:
      "Supabase 是独立连接器，不替换 postgres。请在 sandbox 外配置好 project ref 和 access token，sandbox 内会直接使用这些已保存的凭据。",
    quickLinks: [
      {
        label: "Supabase Project Settings",
        href: "https://supabase.com/dashboard/project/_/settings/general",
        description: "查看 project ref",
      },
      {
        label: "Supabase Access Tokens",
        href: "https://supabase.com/dashboard/account/tokens",
        description: "创建或管理 access token",
      },
    ],
    steps: [
      "在 Supabase 控制台打开目标 project，复制 project ref。",
      "在 account tokens 页面创建或复制 access token。",
      "把这两个值填入连接器配置，sandbox 内会复用该配置访问 Supabase 能力。",
    ],
    tips: [
      "不要把 Supabase 当作 postgres 的替代项；它是独立连接器。",
      "保存后可以附带一个 display name，方便后续在会话里识别。",
    ],
    exampleLabel: "Copy Project Ref Template",
    exampleValue: "project_ref=your-project-ref",
  },
  figma: {
    intro:
      "Figma 连接器在 sandbox 外配置 access token，sandbox 内直接复用该凭据访问 Figma 能力。",
    quickLinks: [
      {
        label: "Figma Personal Access Tokens",
        href: "https://www.figma.com/developers/api#access-tokens",
        description: "创建或管理 token",
      },
    ],
    steps: [
      "在 Figma 开发者页面创建 Personal Access Token。",
      "复制 token 并回到连接器配置页保存。",
      "sandbox 内将直接使用该 token，不需要重复授权。",
    ],
    tips: [
      "Token 一旦泄露应立即撤销并重新生成。",
      "留空 secret 不会覆盖当前配置。",
    ],
  },
  vercel: {
    intro:
      "Vercel 连接器在 sandbox 外完成 token 配置，sandbox 内会直接复用该授权执行相关能力。",
    quickLinks: [
      {
        label: "Vercel Tokens",
        href: "https://vercel.com/account/tokens",
        description: "创建或管理 access token",
      },
    ],
    steps: [
      "在 Vercel 账号设置中创建 Personal Access Token。",
      "复制 token 并保存到连接器配置中。",
      "sandbox 内会直接使用该 token，无需在执行时重新登录。",
    ],
    tips: [
      "建议为不同环境使用独立 token。",
      "如果部署或项目能力异常，先检查 token 权限范围。",
    ],
  },
  postgres: {
    intro:
      "Postgres 连接器已暂时弃用，不会出现在阶段一连接器菜单中；这里仅保留兼容说明，避免旧数据渲染失败。",
    quickLinks: [
      {
        label: "PostgreSQL DSN Docs",
        href: "https://www.postgresql.org/docs/current/libpq-connect.html",
        description: "查看官方 connection string / URI 格式",
      },
    ],
    steps: [
      "如果你仍需要读取旧配置，可以继续沿用已有 DSN。",
      "新的阶段一接入请优先使用 Supabase，而不是继续新增 Postgres 配置。",
    ],
    tips: [
      "该项仅用于兼容旧数据，不建议继续创建新连接器。",
    ],
    exampleLabel: "Copy DSN Template",
    exampleValue: POSTGRES_DSN_TEMPLATE,
  },
};
