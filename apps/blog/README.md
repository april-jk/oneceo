# oneceo blog

This app hosts the standalone blog subsite for `blog.oneceo.ai`.

## Stack

- Astro
- MDX
- Static output for GitHub Pages

## Commands

```bash
pnpm --dir apps/blog dev
pnpm --dir apps/blog build
pnpm --dir apps/blog preview
```

## Content

Write posts in:

```txt
src/content/blog/
```

Each post uses frontmatter:

```md
---
title: "Post title"
description: "Post summary"
pubDate: 2026-05-30
updatedDate: 2026-05-30
tags:
  - workflow
draft: false
---
```

## GitHub Pages

- Custom domain file is already set in `public/CNAME`
- Keep the deployed host as `blog.oneceo.ai`
- DNS should point the subdomain to GitHub Pages as a `CNAME`
- Workflow file: `.github/workflows/blog-github-pages.yml`
