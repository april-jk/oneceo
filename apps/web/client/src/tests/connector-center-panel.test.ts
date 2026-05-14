import { describe, expect, it } from "vitest";

import {
  cleanupConnectorQuery,
  FIGMA_FIXED_CALLBACK_PATH,
  GITHUB_FIXED_CALLBACK_PATH,
  GOOGLE_SUPER_FIXED_CALLBACK_PATH,
  normalizeEditableProfileId,
  resolveAuthorizedRepositoryLabel,
  resolveConnectorOauthCallbackContext,
  SLACK_FIXED_CALLBACK_PATH,
  VERCEL_FIXED_CALLBACK_PATH,
  shouldUseConnectorLevelOauth,
  shouldUseUnifiedConnectorCard,
} from "@/components/ConnectorCenterPanel";

describe("connector center panel profile id normalization", () => {
  it("treats __new__ as create mode instead of a persisted profile id", () => {
    expect(normalizeEditableProfileId("__new__")).toBeNull();
  });

  it("keeps persisted profile ids unchanged", () => {
    expect(normalizeEditableProfileId("profile-123")).toBe("profile-123");
  });

  it("uses connector-level OAuth for GitHub, Notion, Figma, Slack, and Vercel", () => {
    expect(shouldUseConnectorLevelOauth("github")).toBe(true);
    expect(shouldUseConnectorLevelOauth("notion")).toBe(true);
    expect(shouldUseConnectorLevelOauth("figma")).toBe(true);
    expect(shouldUseConnectorLevelOauth("google_super")).toBe(true);
    expect(shouldUseConnectorLevelOauth("slack")).toBe(true);
    expect(shouldUseConnectorLevelOauth("vercel")).toBe(true);
  });

  it("uses the unified OAuth card layout for GitHub, Slack, and Notion", () => {
    expect(shouldUseUnifiedConnectorCard("github")).toBe(true);
    expect(shouldUseUnifiedConnectorCard("slack")).toBe(true);
    expect(shouldUseUnifiedConnectorCard("notion")).toBe(true);
    expect(shouldUseUnifiedConnectorCard("figma")).toBe(true);
    expect(shouldUseUnifiedConnectorCard("google_super")).toBe(true);
    expect(shouldUseUnifiedConnectorCard("vercel")).toBe(true);
    expect(shouldUseUnifiedConnectorCard("supabase")).toBe(true);
  });

  it("uses the fixed Slack callback path", () => {
    expect(SLACK_FIXED_CALLBACK_PATH).toBe("/slack/callback");
  });

  it("uses the fixed GitHub callback path", () => {
    expect(GITHUB_FIXED_CALLBACK_PATH).toBe("/github/callback");
  });

  it("uses the fixed Vercel callback path", () => {
    expect(VERCEL_FIXED_CALLBACK_PATH).toBe("/vercel/callback");
  });

  it("uses the fixed Figma callback path", () => {
    expect(FIGMA_FIXED_CALLBACK_PATH).toBe("/figma/callback");
  });

  it("uses the fixed Google Super callback path", () => {
    expect(GOOGLE_SUPER_FIXED_CALLBACK_PATH).toBe("/google-super/callback");
  });

  it("recognizes Slack fixed callback pages as connector OAuth callbacks", () => {
    const params = new URLSearchParams("code=oauth-code&state=oauth-state");
    const callback = resolveConnectorOauthCallbackContext("http://localhost/slack/callback", params);

    expect(callback.connector).toBe("slack");
    expect(callback.isFixedCallback).toBe(true);
    expect(callback.shouldHandle).toBe(true);
  });

  it("recognizes GitHub fixed callback pages as connector OAuth callbacks", () => {
    const params = new URLSearchParams("code=oauth-code&state=oauth-state");
    const callback = resolveConnectorOauthCallbackContext("http://localhost/github/callback", params);

    expect(callback.connector).toBe("github");
    expect(callback.isFixedCallback).toBe(true);
    expect(callback.shouldHandle).toBe(true);
  });

  it("recognizes Vercel fixed callback pages as connector OAuth callbacks", () => {
    const params = new URLSearchParams("code=oauth-code&state=oauth-state");
    const callback = resolveConnectorOauthCallbackContext("http://localhost/vercel/callback", params);

    expect(callback.connector).toBe("vercel");
    expect(callback.isFixedCallback).toBe(true);
    expect(callback.shouldHandle).toBe(true);
  });

  it("recognizes Figma fixed callback pages as connector OAuth callbacks", () => {
    const params = new URLSearchParams("code=oauth-code&state=oauth-state");
    const callback = resolveConnectorOauthCallbackContext("http://localhost/figma/callback", params);

    expect(callback.connector).toBe("figma");
    expect(callback.isFixedCallback).toBe(true);
    expect(callback.shouldHandle).toBe(true);
  });

  it("recognizes Google Super fixed callback pages as connector OAuth callbacks", () => {
    const params = new URLSearchParams("code=oauth-code&state=oauth-state");
    const callback = resolveConnectorOauthCallbackContext("http://localhost/google-super/callback", params);

    expect(callback.connector).toBe("google_super");
    expect(callback.isFixedCallback).toBe(true);
    expect(callback.shouldHandle).toBe(true);
  });

  it("redirects Slack callback pages back to the target session after cleanup", () => {
    expect(
      cleanupConnectorQuery("/slack/callback", "?code=oauth-code&state=oauth-state", {
        targetSessionId: "session-slack-1",
      })
    ).toBe("/session/session-slack-1");
  });

  it("redirects Slack callback pages to home when no session is restored", () => {
    expect(cleanupConnectorQuery("/slack/callback", "?code=oauth-code&state=oauth-state")).toBe("/home");
  });

  it("redirects GitHub callback pages back to the target session after cleanup", () => {
    expect(
      cleanupConnectorQuery("/github/callback", "?code=oauth-code&state=oauth-state", {
        targetSessionId: "session-github-1",
      })
    ).toBe("/session/session-github-1");
  });

  it("redirects Vercel callback pages back to the target session after cleanup", () => {
    expect(
      cleanupConnectorQuery("/vercel/callback", "?code=oauth-code&state=oauth-state", {
        targetSessionId: "session-vercel-1",
      })
    ).toBe("/session/session-vercel-1");
  });

  it("redirects Figma callback pages back to the target session after cleanup", () => {
    expect(
      cleanupConnectorQuery("/figma/callback", "?code=oauth-code&state=oauth-state", {
        targetSessionId: "session-figma-1",
      })
    ).toBe("/session/session-figma-1");
  });

  it("redirects Google Super callback pages back to the target session after cleanup", () => {
    expect(
      cleanupConnectorQuery("/google-super/callback", "?code=oauth-code&state=oauth-state", {
        targetSessionId: "session-google-1",
      })
    ).toBe("/session/session-google-1");
  });

  it("shows the selected GitHub repository name when profile config has repositories", () => {
    expect(
      resolveAuthorizedRepositoryLabel({
        profileId: "profile-github",
        connectorKey: "github",
        profileName: "GitHub Default",
        displayName: "octocat",
        authMode: "oauth",
        authStatus: "authorized",
        config: {
          repositories: ["octocat/hello-world", "octocat/private-repo"],
        },
        isDefault: true,
      })
    ).toBe("octocat/hello-world +1");
  });
});
