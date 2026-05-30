import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

export async function GET(context: { site: URL | undefined }) {
  const posts = (await getCollection("blog", ({ data }) => !data.draft)).sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
  );

  return rss({
    title: "oneceo blog",
    description: "Docs, workflows, and product notes from oneceo.",
    site: context.site ?? "https://blog.oneceo.ai",
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.id}/`,
    })),
  });
}
