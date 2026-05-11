import type { ComponentType, SVGProps } from "react";
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
export type ConnectorIcon = LucideIcon | ComponentType<SVGProps<SVGSVGElement>>;

function GoogleWorkspaceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.24 1.06-3.71 1.06-2.87 0-5.3-1.94-6.16-4.54H2.18v2.84C3.99 20.53 7.7 23 12 23Z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11.01 11.01 0 0 0 0 9.86l3.66-2.84Z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.7 7.32 9.13 5.38 12 5.38Z"
      />
    </svg>
  );
}

export function resolveConnectorIcon(icon: string): ConnectorIcon {
  const iconMap: Record<string, ConnectorIcon> = {
    github: Github,
    slack: Slack,
    notion: NotepadText,
    supabase: Database,
    figma: Figma,
    google: GoogleWorkspaceIcon,
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
