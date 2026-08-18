---
name: course-to-blog
description: Convert course materials (HTML lesson pages + Jupyter notebooks) from docs/ into a numbered series of blog posts merging theory, code, figures and exercises. Use when the user says 课程转博客, 把课程整理成博客, 课件/文档/ipynb 转博客, turn course notes into blog posts, convert notebooks to blog, or points at a docs folder full of lesson HTML + .ipynb files.
---

# Course materials → numbered blog post series

Pipeline: **inventory the course folder → extract figures from notebooks → write one post per lesson → verify build → publish**.

For simple "summarize a single article/video into a blog post" cases use the `post-to-blog` skill instead. This skill is for a whole course/lesson set.

## 1. Inventory the course folder

- The source lives under `docs/<CourseName>/` (e.g. `docs/机器学习/`). It typically contains:
  - `文档/000X-*.html` — one theory lesson page per lesson, numbered in learning order
  - `000X_*.ipynb` — one notebook per lesson (usually starting partway through the sequence)
- Determine: the numbering scheme, which lessons have only HTML (theory-only, no notebook), which have both, and the full lesson list in order.

## 2. Decide the structure (grill the user if not obvious)

Ask the user before starting unless they've already specified:

- **Granularity**: one post per lesson (recommended for a numbered series), or merged by topic.
- **Category**: new category named after the subject (e.g. `机器学习`), folder = category under `src/content/posts/`.
- **Figures**: notebooks embed matplotlib charts as base64 PNG inside the JSON. Extract ALL of them (recommended) or only key ones. Save to `src/content/posts/<Category>/images/<lessonNo>_figNN_<descriptor>.png` and reference with relative `./images/...` from the post.
- **Exercises/quizzes**: notebooks have tiered exercises (e.g. S/M/H) with answers in `# pass` answer cells; HTML pages have interactive quizzes (buttons with `data-ok="true"`). Include them with answers (recommended) — show answers in `<details><summary>答案</summary>...</details>` collapsible blocks so readers can try first.
- **Publishing**: stagger `published` dates across the series (one lesson per day, last lesson = today) so the blog's newest-first sort and prev/next navigation keep the series in order. Or ask the user.

## 3. Extract figures

Write a small Python script that parses each notebook JSON, walks cells in order, and for every `outputs[].data["image/png"]` decodes the base64 into a file. Name files `figNN.png` in order of appearance; append the nearest preceding markdown heading as a descriptor suffix. Put them in a shared `<Category>/images/` folder with a `<lessonNo>_` prefix.

Also dump each notebook's markdown + code cell text to UTF-8 .txt files so the post-writing agents can read them without hitting console encoding issues (Windows PowerShell uses GBK; Chinese text will garble on stdout — always write to files, never print Chinese to console).

## 4. Write the posts

- Post file: `src/content/posts/<Category>/<lessonNo>-<slug>.md` (one per lesson, Chinese slug OK).
- Frontmatter (schema in `src/content.config.ts`; `published` required, `date` is NOT used):
  ```yaml
  ---
  title: <中文标题>
  published: <YYYY-MM-DD, staggered>
  description: <one or two sentences in Chinese>
  tags: [<subject>, <topic tags>]
  category: <Category>
  draft: false
  ---
  ```
- Post body structure (per post):
  1. `# 标题` + intro paragraph (系列第 N 课, prerequisite, preview)
  2. `## 一、知识点` — theory from the HTML page. Convert `<pre>` formulas to KaTeX (blog has remark-math + rehype-katex): inline `$...$`, display `$$...$$`. Keep the 三要素 (模型/策略/算法) framing if the course uses it. Keep 推荐阅读 links.
  3. `## 二、动手实践` — the notebook code. Strip the matplotlib Chinese-font boilerplate (`import matplotlib as mpl` / font_manager / rcParams) from every code block. Explain each code block in Chinese; embed the matching figures.
  4. `## 三、练习` — tiered exercises with collapsible `<details>` answers (answers from the notebook's answer-cell comments / code).
  5. `## 四、测验` — HTML quizzes, each as question + options + collapsible answer (correct option = the `data-ok="true"` button; explanation = the `.reveal` text).
  6. Optional `## 五、小结` — 2-4 sentences linking to the series theme.
- Dispatch parallel sub-agents, each writing a contiguous slice of lessons (they read the HTML + notebook dumps + image filenames themselves). Give each a precise frontmatter template, the exact output paths, and the figure paths.

## 5. Verify

```bash
pnpm astro check
pnpm astro build
```

Both must pass. Check the build log lists every new post route (`/posts/<Category>/...`). Fix any frontmatter/image-reference errors.

## 6. Publish (optional, ask if unsure)

Stage only the new posts, the images folder, and any skill changes:

```bash
git add "src/content/posts/<Category>"
git commit -m "feat(blog): 发布机器学习课程系列笔记（0001-0012）"
git push
```

- Default: commit + push to `main` (Vercel auto-deploys). User can opt out.
- Never commit unrelated files.