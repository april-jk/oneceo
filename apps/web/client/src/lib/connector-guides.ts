import type { TFunction } from "i18next";

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

export function getConnectorGuides(t: TFunction): Partial<Record<ConnectorKey, ConnectorGuide>> {
  return {
    github: {
      intro: t("connectors.guides.github.intro"),
      quickLinks: [
        {
          label: t("connectors.guides.github.links.tokenPage.label"),
          href: "https://github.com/settings/personal-access-tokens/new",
          description: t("connectors.guides.github.links.tokenPage.description"),
        },
        {
          label: t("connectors.guides.github.links.docs.label"),
          href: "https://docs.github.com/github/extending-github/git-automation-with-oauth-tokens",
          description: t("connectors.guides.github.links.docs.description"),
        },
      ],
      steps: [
        t("connectors.guides.github.steps.0"),
        t("connectors.guides.github.steps.1"),
        t("connectors.guides.github.steps.2"),
      ],
      tips: [
        t("connectors.guides.github.tips.0"),
        t("connectors.guides.github.tips.1"),
      ],
    },
    slack: {
      intro: t("connectors.guides.slack.intro"),
      quickLinks: [
        {
          label: t("connectors.guides.slack.links.composioToolkit.label"),
          href: "https://docs.composio.dev/toolkits/slack",
          description: t("connectors.guides.slack.links.composioToolkit.description"),
        },
      ],
      steps: [
        t("connectors.guides.slack.steps.0"),
        t("connectors.guides.slack.steps.1"),
        t("connectors.guides.slack.steps.2"),
      ],
      tips: [t("connectors.guides.slack.tips.0")],
    },
    notion: {
      intro: t("connectors.guides.notion.intro"),
      quickLinks: [
        {
          label: t("connectors.guides.notion.links.composioToolkit.label"),
          href: "https://docs.composio.dev/toolkits/notion_mcp_oauth",
          description: t("connectors.guides.notion.links.composioToolkit.description"),
        },
      ],
      steps: [
        t("connectors.guides.notion.steps.0"),
        t("connectors.guides.notion.steps.1"),
        t("connectors.guides.notion.steps.2"),
      ],
      tips: [
        t("connectors.guides.notion.tips.0"),
        t("connectors.guides.notion.tips.1"),
      ],
    },
    supabase: {
      intro: t("connectors.guides.supabase.intro"),
      quickLinks: [
        {
          label: t("connectors.guides.supabase.links.composioToolkit.label"),
          href: "https://docs.composio.dev/toolkits/supabase",
          description: t("connectors.guides.supabase.links.composioToolkit.description"),
        },
      ],
      steps: [
        t("connectors.guides.supabase.steps.0"),
        t("connectors.guides.supabase.steps.1"),
        t("connectors.guides.supabase.steps.2"),
      ],
      tips: [
        t("connectors.guides.supabase.tips.0"),
        t("connectors.guides.supabase.tips.1"),
      ],
    },
    figma: {
      intro: t("connectors.guides.figma.intro"),
      quickLinks: [
        {
          label: t("connectors.guides.figma.links.composioToolkit.label"),
          href: "https://docs.composio.dev/toolkits/figma/",
          description: t("connectors.guides.figma.links.composioToolkit.description"),
        },
      ],
      steps: [
        t("connectors.guides.figma.steps.0"),
        t("connectors.guides.figma.steps.1"),
        t("connectors.guides.figma.steps.2"),
      ],
      tips: [
        t("connectors.guides.figma.tips.0"),
        t("connectors.guides.figma.tips.1"),
      ],
    },
    vercel: {
      intro: t("connectors.guides.vercel.intro"),
      quickLinks: [
        {
          label: t("connectors.guides.vercel.links.oauthDocs.label"),
          href: "https://vercel.com/docs/sign-in-with-vercel/authorization-server-api",
          description: t("connectors.guides.vercel.links.oauthDocs.description"),
        },
        {
          label: t("connectors.guides.vercel.links.restApi.label"),
          href: "https://vercel.com/docs/rest-api/reference",
          description: t("connectors.guides.vercel.links.restApi.description"),
        },
      ],
      steps: [
        t("connectors.guides.vercel.steps.0"),
        t("connectors.guides.vercel.steps.1"),
        t("connectors.guides.vercel.steps.2"),
      ],
      tips: [
        t("connectors.guides.vercel.tips.0"),
        t("connectors.guides.vercel.tips.1"),
      ],
    },
    postgres: {
      intro: t("connectors.guides.postgres.intro"),
      quickLinks: [
        {
          label: t("connectors.guides.postgres.links.dsnDocs.label"),
          href: "https://www.postgresql.org/docs/current/libpq-connect.html",
          description: t("connectors.guides.postgres.links.dsnDocs.description"),
        },
      ],
      steps: [
        t("connectors.guides.postgres.steps.0"),
        t("connectors.guides.postgres.steps.1"),
      ],
      tips: [t("connectors.guides.postgres.tips.0")],
      exampleLabel: t("connectors.guides.postgres.exampleLabel"),
      exampleValue: POSTGRES_DSN_TEMPLATE,
    },
  };
}
