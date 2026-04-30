import { describe, expect, it } from "vitest";

import { resolveGithubRepositoryOptions } from "@/components/ConnectorDialog";

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
