import { describe, expect, it } from "vitest";
import { resolveArtifactDeploymentPreviewUrl } from "../components/AltusArtifactPreviewCard";

describe("altus artifact preview card deployment preview selection", () => {
  it("prefers the selected deployment public url", () => {
    expect(
      resolveArtifactDeploymentPreviewUrl({
        configured: true,
        canDeploy: true,
        bindingState: "ready",
        activeDeploymentPending: false,
        domains: ["https://domain.example"],
        deployments: [
          {
            id: "dep-old",
            status: "SUCCESS",
            staticUrl: "https://old.example",
          },
          {
            id: "dep-current",
            status: "SUCCESS",
            staticUrl: "https://current.example",
          },
        ],
        logs: [],
        missing: [],
        deploymentId: "dep-current",
        latestStaticUrl: "https://latest.example",
      }),
    ).toBe("https://current.example");
  });

  it("falls back to the latest successful deployment url", () => {
    expect(
      resolveArtifactDeploymentPreviewUrl({
        configured: true,
        canDeploy: true,
        bindingState: "ready",
        activeDeploymentPending: false,
        domains: ["https://domain.example"],
        deployments: [
          {
            id: "dep-failed",
            status: "FAILED",
            staticUrl: "https://failed.example",
          },
          {
            id: "dep-success",
            status: "SUCCESS",
            url: "https://success.example",
          },
        ],
        logs: [],
        missing: [],
      }),
    ).toBe("https://success.example");
  });

  it("falls back to panel urls and domains when deployment records are missing", () => {
    expect(
      resolveArtifactDeploymentPreviewUrl({
        configured: true,
        canDeploy: true,
        bindingState: "ready",
        activeDeploymentPending: false,
        domains: ["https://domain.example"],
        deployments: [],
        logs: [],
        missing: [],
        latestStaticUrl: "https://static.example",
      }),
    ).toBe("https://static.example");

    expect(
      resolveArtifactDeploymentPreviewUrl({
        configured: true,
        canDeploy: true,
        bindingState: "ready",
        activeDeploymentPending: false,
        domains: ["https://domain.example"],
        deployments: [],
        logs: [],
        missing: [],
      }),
    ).toBe("https://domain.example");
  });
});
