import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://blog.oneceo.ai",
  integrations: [mdx(), sitemap()],
  markdown: {
    syntaxHighlight: "shiki",
  },
});
