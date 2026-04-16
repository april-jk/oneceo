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
      "GitHub 连接器在 sandbox 外完成授权。优先使用 GitHub OAuth；平台会自动创建默认 profile，并在回调后把授权结果应用到当前会话。",
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
      "在 GitHub 授权页确认当前账号、组织和仓库授权范围。",
      "若 GitHub App 已授权，可能会直接回跳 oneceo，这是 GitHub 的正常行为。",
      "如需扩大仓库范围或更新权限，请在 GitHub 侧完成授权或安装更新后再重新连接。",
    ],
    tips: [
      "组织仓库若启用了 SSO，完成授权后可能还需要额外在 GitHub 侧确认。",
      "本地清除授权只会移除 oneceo 中保存的授权状态，不会自动撤销 GitHub 侧的远端授权。",
    ],
  },
  slack: {
    intro:
      "Slack 连接器只保留 OAuth 授权路径。当前链路获取的是 Slack User OAuth 授权。",
    quickLinks: [
      {
        label: "Slack Your Apps",
        href: "https://api.slack.com/apps/",
        description: "查看当前 Slack App 与 OAuth 配置",
      },
      {
        label: "Slack OAuth Docs",
        href: "https://docs.slack.dev/authentication/installing-with-oauth/",
        description: "了解 User OAuth 安装与授权方式",
      },
      {
        label: "Slack MCP Docs",
        href: "https://docs.slack.dev/ai/slack-mcp-server/",
        description: "查看 Slack MCP 的能力和权限要求",
      },
    ],
    steps: [
      "点击连接后，在 Slack 授权页确认你要使用的 workspace 和账号。",
      "完成授权并返回 oneceo，系统会自动保存默认 profile，并在需要时挂载到当前会话。",
      "如果读取不到频道或消息，先检查该 Slack 用户本身是否拥有对应访问权限。",
    ],
    tips: [
      "如果切换了 workspace、账号或 scopes，需要重新连接，不能继续沿用旧授权。",
    ],
  },
  notion: {
    intro:
      "Notion 连接器只保留 OAuth 授权路径。完成 OAuth 后，真正可访问的内容范围仍取决于目标 page 或 database 是否已经共享给对应 integration。",
    quickLinks: [
      {
        label: "My Integrations",
        href: "https://www.notion.so/my-integrations",
        description: "查看 Notion integration 与工作区绑定",
      },
      {
        label: "Notion Authorization",
        href: "https://developers.notion.com/guides/get-started/authorization",
        description: "查看 Notion OAuth 授权说明",
      },
      {
        label: "Notion MCP Docs",
        href: "https://developers.notion.com/docs/mcp",
        description: "查看 Notion MCP 能力与接入方式",
      },
    ],
    steps: [
      "点击连接并完成 Notion OAuth 授权，确认当前使用的是正确的 workspace。",
      "回到 Notion，把目标 page 或 database 通过 Add connections 共享给对应 integration。",
      "返回 oneceo 再使用 Notion MCP；如当前在会话中授权，系统会自动把连接结果挂载到该会话。",
    ],
    tips: [
      "连接成功不等于内容已可访问；未共享页面时，授权成功后仍会读不到内容。",
      "如果切换 workspace、integration 权限或共享范围，请重新连接并重新检查页面共享关系。",
    ],
  },
  supabase: {
    intro:
      "Supabase 是独立连接器，不替代 postgres。请在 sandbox 外配置 access token，平台会在 sandbox 内通过本地桥接挂载 MCP。",
    quickLinks: [
      {
        label: "Supabase Access Tokens",
        href: "https://supabase.com/dashboard/account/tokens",
        description: "创建或管理 access token",
      },
    ],
    steps: [
      "在 account tokens 页面创建或复制 access token。",
      "把 token 填入连接器配置，sandbox 内会复用该配置访问 Supabase 能力。",
    ],
    tips: [
      "不要把 Supabase 当作 postgres 的替代项；它是独立连接器。",
      "Profile Name 和 Display Name 都可以留空，系统会自动补齐默认 profile 名称。",
      "保存后可以附带一个 display name，方便后续在会话里识别。",
    ],
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
      "Vercel 连接器使用官方 MCP 地址 https://mcp.vercel.com。优先使用 Vercel OAuth；如果当前环境尚未配置 OAuth，再使用 Personal Access Token 作为过渡。",
    quickLinks: [
      {
        label: "Vercel Tokens",
        href: "https://vercel.com/account/tokens",
        description: "创建或管理 access token",
      },
      {
        label: "Vercel MCP Docs",
        href: "https://vercel.com/docs/agent-resources/vercel-mcp",
        description: "查看官方 MCP 能力与授权方式",
      },
    ],
    steps: [
      "如果部署已配置 Vercel OAuth，优先点击连接并完成官方授权。",
      "如果当前环境尚未配置 OAuth，就在 Vercel 账号设置中创建 Personal Access Token。",
      "保存后，sandbox 会通过官方 MCP 地址复用该授权。",
    ],
    tips: [
      "Team ID 仍然是可选项，用于限定团队上下文。",
      "如果部署或项目能力异常，先检查 token 权限范围，或确认 OAuth 已授权到目标团队。",
    ],
  },
  postgres: {
    intro:
      "Postgres 连接器已暂时弃用，不会出现在阶段一连接器菜单中；这里只保留兼容说明，避免旧数据渲染失败。",
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
