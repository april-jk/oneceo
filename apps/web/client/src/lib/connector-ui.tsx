import type { LucideIcon } from "lucide-react";
import {
  Blocks,
  Braces,
  Cloud,
  Database,
  Figma,
  Github,
  Link2,
  NotepadText,
  Slack,
} from "lucide-react";

export type ConnectorCategory = "app" | "custom_api" | "custom_mcp";

export function resolveConnectorIcon(icon: string): LucideIcon {
  const iconMap: Record<string, LucideIcon> = {
    github: Github,
    slack: Slack,
    notion: NotepadText,
    supabase: Database,
    figma: Figma,
    vercel: Cloud,
    postgres: Database,
    api: Braces,
    mcp: Blocks,
  };
  return iconMap[icon] || Link2;
}

export function formatConnectorStatus(value: string | null | undefined) {
  if (!value) return "unknown";
  return value.replaceAll("_", " ");
}

export function connectorStatusTone(value: string) {
  switch (value) {
    case "authorized":
    case "connected":
      return "default" as const;
    case "needs_auth":
    case "not_configured":
    case "connecting":
    case "pending_recover":
    case "recovering":
      return "secondary" as const;
    case "error":
    case "failed":
    case "unavailable":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

export function connectorStatusText(input: {
  available: boolean;
  authStatus?: string | null;
}) {
  if (!input.available) return "unavailable";
  return input.authStatus || "not_configured";
}
