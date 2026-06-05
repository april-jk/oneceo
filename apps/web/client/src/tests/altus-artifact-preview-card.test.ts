import { describe, expect, it } from "vitest";
import {
  canUseSimpleHtmlSnapshotFallback,
  getWebsitePreviewSnapshotIssue,
  getScaledWebPreviewFrame,
  resolveArtifactOpenTarget,
  resolveArtifactDeploymentPreviewUrl,
  shouldShowArtifactSourceControls,
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

describe("altus artifact preview card delivery actions", () => {
  it("hides source controls for website delivery cards", () => {
    expect(shouldShowArtifactSourceControls("web-preview")).toBe(false);
    expect(shouldShowArtifactSourceControls("artifact-browser")).toBe(true);
  });

  it("opens website delivery cards through remote debug instead of raw files", () => {
    expect(
      resolveArtifactOpenTarget({
        displayMode: "web-preview",
        remoteDebugAvailable: true,
        selectedFileOpenUrl:
          "/api/task-creation/sessions/session-1/workspace/raw/client/index.html",
      }),
    ).toEqual({ kind: "remote-debug" });
  });

  it("does not expose transient raw urls for website delivery cards without debug", () => {
    expect(
      resolveArtifactOpenTarget({
        displayMode: "web-preview",
        remoteDebugAvailable: false,
        selectedFileOpenUrl:
          "/api/task-creation/sessions/session-1/workspace/raw/client/index.html",
      }),
    ).toBeNull();
  });

  it("keeps file url opening for regular artifact browsing", () => {
    expect(
      resolveArtifactOpenTarget({
        displayMode: "artifact-browser",
        remoteDebugAvailable: true,
        selectedFileOpenUrl:
          "/api/task-creation/sessions/session-1/workspace/raw/client/index.html",
      }),
    ).toEqual({
      kind: "file-url",
      url: "/api/task-creation/sessions/session-1/workspace/raw/client/index.html",
    });
  });
});

describe("altus artifact preview card snapshot issues", () => {
  it("summarizes failed visual checks without duplicating the reason prefix", () => {
    expect(
      getWebsitePreviewSnapshotIssue({
        kind: "website_screenshot",
        status: "capture_failed",
        reasonCode: "preview_visual_check_failed",
        message: "app_runtime_error: 页面浏览器运行时报错：React is not defined",
        visualCheck: {
          status: "failed",
          reasonCode: "app_runtime_error",
          message: "页面浏览器运行时报错：React is not defined",
        },
      }),
    ).toEqual({
      reasonCode: "app_runtime_error",
      message: "页面浏览器运行时报错：React is not defined",
      visualStatus: "failed",
      status: "capture_failed",
    });
  });

  it("treats a captured screenshot with failed visualCheck as an issue", () => {
    const issue = getWebsitePreviewSnapshotIssue({
      kind: "website_screenshot",
      status: "captured",
      storageKey: "sessions/session-1/previews/run-1/snapshot.png",
      visualCheck: {
        status: "failed",
        reasonCode: "visible_text_too_short",
        message: "页面可见文本和元素过少，疑似白屏或空页面。",
      },
    });

    expect(issue?.reasonCode).toBe("visible_text_too_short");
  });

  it("marks a missing snapshot image as a delivery preview issue", () => {
    expect(
      getWebsitePreviewSnapshotIssue(
        {
          kind: "website_screenshot",
          status: "captured",
          storageKey: "sessions/session-1/previews/run-1/snapshot.png",
        },
        { imageFailed: true, hasPreviewPath: true },
      ),
    ).toMatchObject({
      reasonCode: "snapshot_image_load_failed",
      status: "captured",
    });
  });

  it("allows raw html fallback only when snapshot capture found no website service", () => {
    expect(
      canUseSimpleHtmlSnapshotFallback(
        {
          kind: "website_screenshot",
          status: "capture_unavailable",
          reasonCode: "preview_start_command_missing",
        },
        { hasPreviewPath: true },
      ),
    ).toBe(true);

    expect(
      canUseSimpleHtmlSnapshotFallback(
        {
          kind: "website_screenshot",
          status: "capture_failed",
          reasonCode: "preview_port_not_ready",
        },
        { hasPreviewPath: true },
      ),
    ).toBe(false);
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
