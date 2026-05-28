import { describe, expect, it } from "vitest";
import {
  resolveHandledGoogleConfirmationIds,
  resolveHomeSubmitActiveSessionId,
  shouldRenderGoogleWorkspaceConfirmation,
} from "@/pages/Home";

describe("home managed session resolution", () => {
  it("treats new-task new token as a fresh submit even if stale session state exists", () => {
    const activeSessionId = resolveHomeSubmitActiveSessionId({
      routeForcesNewSession: true,
      sessionId: "previous-session",
      uploadSessionId: "previous-upload-session",
    });

    expect(activeSessionId).toBe("");
  });
});

describe("home managed mcp confirmation rendering", () => {
  it("hides confirmation cards once backend marks them consumed", () => {
    expect(
      shouldRenderGoogleWorkspaceConfirmation({
        confirmation: {
          confirmationId: "confirmation-1",
          status: "consumed",
        },
      }),
    ).toBe(false);
  });

  it("keeps realtime pending confirmation cards visible before status enrichment arrives", () => {
    expect(
      shouldRenderGoogleWorkspaceConfirmation({
        confirmation: {
          confirmationId: "confirmation-1",
        },
      }),
    ).toBe(true);
  });

  it("resolves handled confirmation ids from enriched history message statuses", () => {
    expect(
      resolveHandledGoogleConfirmationIds([
        {
          type: "executor_event",
          content: "",
          metadata: {
            mcpToolConfirmationStatuses: {
              "confirmation-1": "approved",
              "confirmation-2": "pending",
              "confirmation-3": "consumed",
            },
          },
        },
      ]),
    ).toEqual(["confirmation-1", "confirmation-3"]);
  });
});
