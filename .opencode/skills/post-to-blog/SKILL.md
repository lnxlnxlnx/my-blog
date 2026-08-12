---
name: post-to-blog
description: Summarize external content (web articles, papers, docs, Yuque notes, videos) into a structured blog post and publish it to this repo. Use when the user says 总结成博客, 发布到博客, 总结文章, 写篇博客, put this on the blog, blog post, summarize for the blog — or drops a URL and asks to turn it into a post.
---

# Summarize content → publish blog post

Pipeline: **fetch source → summarize per house style → write post with correct frontmatter → verify build → (optional) publish**.

This repo is the Firefly Astro blog (`src/content/posts/`). Publishing = committing the markdown to `main`; Vercel auto-deploys.

## 1. Fetch the source content

- Plain HTML pages: use `webfetch` (markdown format) directly.
- **Yuque (语雀) pages are JS-rendered** — normal fetch returns only the title. The article body is served by an API endpoint. To get it:
  1. Fetch the page HTML, extract the URI-encoded JSON from `window.appData = JSON.parse(decodeURIComponent("..."))`.
  2. From it read the **numeric** `doc.id` and `book.id` (the slug `book_id` fails).
  3. Fetch `https://www.yuque.com/api/docs/{doc.id}?book_id={book.id}&mode=markdown` with a browser User-Agent; the markdown is in `data.sourcecode`.
- If the article is well-known (e.g. a famous author's post), search for public mirrors before giving up.
- Save the raw source to a temp file so it survives context compaction.

## 2. Summarize (house style)

- **Form**: structured distillation — keep the original's section skeleton and all core points, compressed. Not a full translation, not a personal essay.
- **Length**: medium, roughly 2500–4000 Chinese characters. Use tables and bullet lists for dense material (naming rules, config lists, comparisons).
- **Structure**:
  - Opening blockquote: 原文出处（作者 + 链接）+ 说明这是精读/总结笔记.
  - Section per original part, with the original's own headings preserved where possible.
  - A short closing "我的收获" section (3–5 bullets, your own takeaway) — keep it brief, the post is a summary, not an essay.
- **Attribution**: always credit the original author and source. If the content is not the user's own, the post must not pass it off as original.
- **Images**: do not copy images from the source; describe key figures in words (avoids external CDN dependency).

## 3. Write the post

**Location**: `src/content/posts/<category>/<filename>.md` — category = a subdirectory. Create the subdirectory if the category is new.

**Filename**: descriptive, Chinese OK, e.g. `研究经验总结（HandyEXP）精读.md`.

**Frontmatter** (schema in `src/content.config.ts`; `published` is required, `date` is NOT used):

```yaml
---
title: <post title, Chinese>
published: <YYYY-MM-DD, today>
description: <one or two sentences, what the post covers>
tags: [<3-6 lowercase or Chinese tags>]
category: <category name, matches the folder>
draft: false
author: <original author for summaries/reposts, else leave out>
sourceLink: <original URL, required when summarizing external content>
---
```

Category conventions in this blog: folder name = category name. Existing ones include 嵌入式开发, Qt, 马克思主义基本原理, 自动控制原理, AI应用, 科研经验, study python, etc. Reuse an existing category unless the topic genuinely needs a new one.

## 4. Verify

```bash
pnpm astro check
```

Must pass before finishing. Fix any errors it reports (usually frontmatter issues). If `astro check` is unavailable or unrelated failures appear, run `pnpm astro build` as fallback.

## 5. Publish (optional, ask if unsure)

```bash
git add <post file>
git commit -m "feat(blog): <title>"
git push
```

- Default: commit + push to `main` (Vercel auto-deploys). User can opt out.
- Never commit unrelated files; only stage the post (and the skill file if changed).
