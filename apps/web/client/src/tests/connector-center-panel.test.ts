import { describe, expect, it } from "vitest";

import {
  cleanupConnectorQuery,
  normalizeEditableProfileId,
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

  it("uses connector-level OAuth for Notion", () => {
    expect(shouldUseConnectorLevelOauth("notion")).toBe(true);
    expect(shouldUseConnectorLevelOauth("slack")).toBe(true);
    expect(shouldUseConnectorLevelOauth("github")).toBe(false);
  });

  it("uses the unified OAuth card layout for GitHub, Slack, and Notion", () => {
    expect(shouldUseUnifiedConnectorCard("github")).toBe(true);
    expect(shouldUseUnifiedConnectorCard("slack")).toBe(true);
    expect(shouldUseUnifiedConnectorCard("notion")).toBe(true);
    expect(shouldUseUnifiedConnectorCard("vercel")).toBe(true);
    expect(shouldUseUnifiedConnectorCard("supabase")).toBe(false);
  });

  it("uses the fixed Slack callback path", () => {
    expect(SLACK_FIXED_CALLBACK_PATH).toBe("/slack/callback");
  });

  it("uses the fixed Vercel callback path", () => {
    expect(VERCEL_FIXED_CALLBACK_PATH).toBe("/vercel/callback");
  });

  it("recognizes Slack fixed callback pages as connector OAuth callbacks", () => {
    const params = new URLSearchParams("code=oauth-code&state=oauth-state");
    const callback = resolveConnectorOauthCallbackContext("http://localhost/slack/callback", params);

    expect(callback.connector).toBe("slack");
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

  it("redirects Vercel callback pages back to the target session after cleanup", () => {
    expect(
      cleanupConnectorQuery("/vercel/callback", "?code=oauth-code&state=oauth-state", {
        targetSessionId: "session-vercel-1",
      })
    ).toBe("/session/session-vercel-1");
  });
});
