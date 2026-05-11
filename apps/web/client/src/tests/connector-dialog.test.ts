import { describe, expect, it } from "vitest";

import {
  resolveGithubRepositoryOptions,
  sortConnectorDialogEntries,
} from "@/components/ConnectorDialog";

describe("connector dialog github repository options", () => {
  it("prefers fetched GitHub repositories when available", () => {
    const result = resolveGithubRepositoryOptions({
      fetched: [
        {
          id: 1,
          owner: "octocat",
          name: "hello-world",
          fullName: "octocat/hello-world",
          private: false,
        },
      ],
      profile: {
        profileId: "profile-1",
        connectorKey: "github",
        profileName: "GitHub Default",
        authMode: "oauth",
        authStatus: "authorized",
        config: {
          repositories: ["ignored/repository"],
        },
        isDefault: true,
      },
    });

    expect(result.map((item) => item.fullName)).toEqual(["octocat/hello-world"]);
  });

  it("falls back to cached GitHub repositories from profile metadata and config", () => {
    const result = resolveGithubRepositoryOptions({
      fetched: [],
      profile: {
        profileId: "profile-1",
        connectorKey: "github",
        profileName: "GitHub Default",
        authMode: "oauth",
        authStatus: "authorized",
        config: {
          repositories: ["octocat/hello-world", "acme/platform"],
        },
        metadata: {
          composioRepositoryNames: ["octocat/hello-world", "team/app"],
        },
        isDefault: true,
      },
      session: {
        connectorKey: "github",
        name: "GitHub",
        icon: "github",
        authMode: "oauth",
        available: true,
        globalAuthStatus: "authorized",
        attached: true,
        desiredState: "attached",
        runtimeStatus: "connected",
        usageStatus: "idle",
        authorizedRepositories: ["team/app", "infra/api"],
      },
    });

    expect(result.map((item) => item.fullName)).toEqual([
      "octocat/hello-world",
      "acme/platform",
      "team/app",
      "infra/api",
    ]);
  });
});

describe("connector dialog ordering", () => {
  it("moves enabled connectors to the top without changing relative order", () => {
    const result = sortConnectorDialogEntries([
      connectorEntry("github", false),
      connectorEntry("notion", false),
      connectorEntry("slack", true),
      connectorEntry("google_super", true),
      connectorEntry("vercel", false),
    ]);

    expect(result.map((entry) => entry.rowKey)).toEqual([
      "slack",
      "google_super",
      "github",
      "notion",
      "vercel",
    ]);
  });

  it("treats a custom MCP row as enabled only when the selected profile is attached", () => {
    const result = sortConnectorDialogEntries([
      connectorEntry("github", false),
      connectorEntry("custom_mcp", true, {
        rowKey: "custom_mcp:one",
        selectedProfileId: "profile-one",
        attachedProfileId: "other-profile",
      }),
      connectorEntry("custom_mcp", true, {
        rowKey: "custom_mcp:two",
        selectedProfileId: "profile-two",
        attachedProfileId: "profile-two",
      }),
    ]);

    expect(result.map((entry) => entry.rowKey)).toEqual([
      "custom_mcp:two",
      "github",
      "custom_mcp:one",
    ]);
  });
});

function connectorEntry(
  key: string,
  attached: boolean,
  overrides: {
    rowKey?: string;
    selectedProfileId?: string | null;
    attachedProfileId?: string | null;
  } = {}
): Parameters<typeof sortConnectorDialogEntries>[0][number] {
  const selectedProfileId = overrides.selectedProfileId ?? `${key}-profile`;
  return {
    rowKey: overrides.rowKey || key,
    item: {
      key: key as any,
      category: key === "custom_mcp" ? "custom_mcp" : "app",
      name: key,
      description: key,
      icon: key,
      authMode: "oauth",
      available: true,
      configFields: [],
      activityMatcherVerified: true,
    },
    session: {
      connectorKey: key as any,
      name: key,
      icon: key,
      authMode: "oauth",
      available: true,
      globalAuthStatus: "authorized",
      attached,
      desiredState: attached ? "attached" : "detached",
      runtimeStatus: attached ? "connected" : "idle",
      usageStatus: "idle",
      attachedProfileId:
        overrides.attachedProfileId === undefined
          ? selectedProfileId
          : overrides.attachedProfileId,
    },
    connectorProfiles: [],
    selectedProfileId,
    selectedProfile: null,
  };
}
