export type ManagedMcpToolConfirmationInput = {
  confirmationId: string;
  agentRunId?: string;
  connectorKey: string;
  toolName: string;
  action: string;
  target: string;
  impact: string;
  parameterSummary: Record<string, unknown>;
};

export type ManagedMcpToolConfirmationMetadata = {
  source: "mcp_tool_confirmation_approved" | "mcp_tool_confirmation_rejected";
  confirmationId: string;
  mcpToolConfirmation: {
    action: "approve" | "reject";
    connectorKey: string;
    confirmationId: string;
    toolName: string;
    confirmationToken?: string;
    confirmationAgentRunId?: string;
    summary: {
      action: string;
      target: string;
      impact: string;
      parameterSummary: Record<string, unknown>;
    };
  };
};

export function buildManagedMcpToolConfirmationInput(payload: {
  action: "approve" | "reject";
  confirmation: ManagedMcpToolConfirmationInput;
  confirmationToken?: string;
}): {
  content: string;
  metadata: ManagedMcpToolConfirmationMetadata;
} {
  const { action, confirmation, confirmationToken } = payload;
  return {
    content: "",
    metadata: {
      source:
        action === "approve"
          ? "mcp_tool_confirmation_approved"
          : "mcp_tool_confirmation_rejected",
      confirmationId: confirmation.confirmationId,
      mcpToolConfirmation: {
        action,
        connectorKey: confirmation.connectorKey,
        confirmationId: confirmation.confirmationId,
        toolName: confirmation.toolName,
        ...(confirmationToken ? { confirmationToken } : {}),
        ...(confirmation.agentRunId
          ? { confirmationAgentRunId: confirmation.agentRunId }
          : {}),
        summary: {
          action: confirmation.action,
          target: confirmation.target,
          impact: confirmation.impact,
          parameterSummary: confirmation.parameterSummary || {},
        },
      },
    },
  };
}
