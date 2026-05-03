import { describe, expect, it } from "vitest";
import {
  getScaledWebPreviewFrame,
  resolveArtifactDeploymentPreviewUrl,
} from "../components/AltusArtifactPreviewCard";

describe("altus artifact preview card scaled web preview", () => {
  it("scales a web preview down to fit the card container", () => {
    expect(getScaledWebPreviewFrame(800, 400)).toEqual({
      width: 1280,
      height: 640,
      scale: 0.625,
    });
  });

  it("keeps large preview containers at native scale", () => {
    expect(getScaledWebPreviewFrame(1440, 500)).toEqual({
      width: 1440,
      height: 500,
      scale: 1,
    });
  });
});

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
