import { describe, expect, it } from "vitest";

import { buildManagedMcpToolConfirmationInput } from "@/lib/mcp-tool-confirmation";

describe("buildManagedMcpToolConfirmationInput", () => {
  const confirmation = {
    confirmationId: "confirmation-1",
    agentRunId: "run-1",
    connectorKey: "google_super",
    toolName: "google_super__GMAIL_SEND_EMAIL",
    action: "send_email",
    target: "user@example.com",
    impact: "Send one email from the connected Google account.",
    parameterSummary: {
      to: "user@example.com",
    },
  };

  it("builds managed metadata for approval", () => {
    expect(
      buildManagedMcpToolConfirmationInput({
        action: "approve",
        confirmation,
        confirmationToken: "token-1",
      }),
    ).toEqual({
      content: "",
      metadata: {
        source: "mcp_tool_confirmation_approved",
        confirmationId: "confirmation-1",
        mcpToolConfirmation: {
          action: "approve",
          connectorKey: "google_super",
          confirmationId: "confirmation-1",
          toolName: "google_super__GMAIL_SEND_EMAIL",
          confirmationToken: "token-1",
          confirmationAgentRunId: "run-1",
          summary: {
            action: "send_email",
            target: "user@example.com",
            impact: "Send one email from the connected Google account.",
            parameterSummary: {
              to: "user@example.com",
            },
          },
        },
      },
    });
  });

  it("builds managed metadata for rejection", () => {
    expect(
      buildManagedMcpToolConfirmationInput({
        action: "reject",
        confirmation,
      }),
    ).toEqual({
      content: "",
      metadata: {
        source: "mcp_tool_confirmation_rejected",
        confirmationId: "confirmation-1",
        mcpToolConfirmation: {
          action: "reject",
          connectorKey: "google_super",
          confirmationId: "confirmation-1",
          toolName: "google_super__GMAIL_SEND_EMAIL",
          confirmationAgentRunId: "run-1",
          summary: {
            action: "send_email",
            target: "user@example.com",
            impact: "Send one email from the connected Google account.",
            parameterSummary: {
              to: "user@example.com",
            },
          },
        },
      },
    });
  });

  it("keeps approval follow-up content empty so backend can continue implicitly", () => {
    const result = buildManagedMcpToolConfirmationInput({
      action: "approve",
      confirmation,
      confirmationToken: "token-2",
    });

    expect(result.content).toBe("");
    expect(result.metadata.mcpToolConfirmation.confirmationToken).toBe("token-2");
  });
});
