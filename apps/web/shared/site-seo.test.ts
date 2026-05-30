import { describe, expect, it } from "vitest";
import {
  buildAbsoluteUrl,
  buildRobotsTxt,
  buildSitemapXml,
  isIndexablePath,
  resolveSiteOrigin,
} from "./site-seo";

describe("site-seo", () => {
  it("normalizes the configured site origin", () => {
    expect(resolveSiteOrigin("https://oneceo.ai/")).toBe("https://oneceo.ai");
    expect(resolveSiteOrigin("")).toBe("https://oneceo.ai");
  });

  it("builds absolute urls from the canonical origin", () => {
    expect(buildAbsoluteUrl("https://oneceo.ai", "/sitemap.xml")).toBe(
      "https://oneceo.ai/sitemap.xml",
    );
  });

  it("limits indexing to the public homepage", () => {
    expect(isIndexablePath("/")).toBe(true);
    expect(isIndexablePath("/home")).toBe(false);
    expect(isIndexablePath("/login")).toBe(false);
  });

  it("generates robots.txt with the sitemap and technical exclusions", () => {
    const robots = buildRobotsTxt("https://oneceo.ai/");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Disallow: /socket.io/");
    expect(robots).toContain("Sitemap: https://oneceo.ai/sitemap.xml");
  });

  it("generates a sitemap containing only the homepage", () => {
    const sitemap = buildSitemapXml("https://oneceo.ai/");
    expect(sitemap).toContain("<loc>https://oneceo.ai/</loc>");
    expect(sitemap).not.toContain("/home");
  });
});
