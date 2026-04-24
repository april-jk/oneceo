import { describe, expect, it } from "vitest";
import { resolveApiBaseUrlFromRuntime } from "./runtime-config";

describe("resolveApiBaseUrlFromRuntime", () => {
  it("prefers same-origin api base for localhost pages even when VITE_API_BASE_URL points remote", () => {
    expect(
      resolveApiBaseUrlFromRuntime("http://oneceo.ai:3000", "http://localhost:3002"),
    ).toBe("http://localhost:3002");
  });

  it("prefers same-origin api base for localhost pages even when VITE_API_BASE_URL points to another local host", () => {
    expect(
      resolveApiBaseUrlFromRuntime("http://127.0.0.1:4000", "http://localhost:3002"),
    ).toBe("http://localhost:3002");
  });

  it("keeps explicit remote api base on non-local pages", () => {
    expect(
      resolveApiBaseUrlFromRuntime("https://api.oneceo.ai", "https://dev.oneceo.ai"),
    ).toBe("https://api.oneceo.ai");
  });

  it("falls back to current origin when no explicit env base is provided", () => {
    expect(resolveApiBaseUrlFromRuntime("", "http://localhost:3002")).toBe("http://localhost:3002");
  });
});
