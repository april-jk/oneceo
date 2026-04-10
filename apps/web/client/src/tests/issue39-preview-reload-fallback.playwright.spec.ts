import { expect, test } from "@playwright/test";
import {
  appendPreviewCacheBust,
  mapWorkspaceRawPreviewHeadResult,
} from "../lib/workspace-preview";

test("issue39: runtime closed maps to reloadable placeholder state", async () => {
  const result = mapWorkspaceRawPreviewHeadResult({
    ok: false,
    status: 409,
  });

  expect(result.state).toBe("runtime_unavailable");
  expect(result.message).toContain("重新加载预览");
});

test("issue39: network error maps to friendly retry message", async () => {
  const result = mapWorkspaceRawPreviewHeadResult({
    ok: false,
    status: 0,
    networkError: true,
  });

  expect(result.state).toBe("fetch_failed");
  expect(result.message).toContain("网络异常");
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
