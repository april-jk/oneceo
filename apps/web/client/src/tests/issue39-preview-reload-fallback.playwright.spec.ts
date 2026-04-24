import { expect, test } from "@playwright/test";
import {
  appendPreviewCacheBust,
  mapWorkspaceRawPreviewHeadResult,
} from "../lib/workspace-preview";
import i18n from "../i18n";

test("issue39: runtime closed maps to reloadable placeholder state", async () => {
  const result = mapWorkspaceRawPreviewHeadResult({
    ok: false,
    status: 409,
  });

  expect(result.state).toBe("runtime_unavailable");
  expect(result.message).toBe(i18n.t("workspacePreview.runtimeUnavailable"));
});

test("issue39: network error maps to friendly retry message", async () => {
  const result = mapWorkspaceRawPreviewHeadResult({
    ok: false,
    status: 0,
    networkError: true,
  });

  expect(result.state).toBe("fetch_failed");
  expect(result.message).toBe(i18n.t("workspacePreview.networkError"));
});

test("issue39: server 500 maps to runtime recovering message", async () => {
  const result = mapWorkspaceRawPreviewHeadResult({
    ok: false,
    status: 500,
  });

  expect(result.state).toBe("runtime_unavailable");
  expect(result.message).toBe(i18n.t("workspacePreview.recovering"));
});

test("issue39: 404 maps to auto-recovering preview message", async () => {
  const result = mapWorkspaceRawPreviewHeadResult({
    ok: false,
    status: 404,
  });

  expect(result.state).toBe("runtime_unavailable");
  expect(result.message).toBe(i18n.t("workspacePreview.preparing"));
});

test("issue39: successful head check maps to ready state", async () => {
  const result = mapWorkspaceRawPreviewHeadResult({
    ok: true,
    status: 200,
  });

  expect(result.state).toBe("ready");
  expect(result.message).toBe("");
});

test("issue39: cache bust appends query correctly", async () => {
  expect(appendPreviewCacheBust("http://localhost:4000/a.html", 123)).toBe(
    "http://localhost:4000/a.html?_preview=123",
  );
  expect(appendPreviewCacheBust("http://localhost:4000/a.html?v=1", 456)).toBe(
    "http://localhost:4000/a.html?v=1&_preview=456",
  );
});
