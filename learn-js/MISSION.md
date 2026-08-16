# Mission: JavaScript — 读懂 Firefly 博客代码

## Why

我想看懂这个博客项目的源码：它是用 Astro + Svelte + Tailwind 搭建的（就在 `E:\SC_project\front_end\my_blog\Firefly`）。我之前没怎么学过 JavaScript，但学过其他编程语言（HTML/CSS 只会一点、很多基础标签不会用）。目标是逐步学会 JS，直到能读懂这个项目里每一段 `.js`、`.ts`、`.astro`、`.svelte` 代码，理解博客是怎么工作的。

## Success looks like

- 能独立读懂 `src/scripts/theme-manager.js` 这样一整段真实 JS 文件，并跟别人讲清楚它在做什么
- 遇到博客里任何一个 `.ts` / `.astro` / `.svelte` 文件，能说出：这段代码里 JS 的部分做了什么、HTML 模板的部分在哪、数据从哪来
- 知道 `node_modules`、`import`、`export`、TypeScript 类型标注这些概念，不再把它们当黑盒
- 能打开 DevTools 控制台，自己动手验证博客里某个变量的值、某个函数的返回值

## Constraints

- 之前有编程经验（变量、函数、循环、条件这些概念已经懂，不用从零教"什么是 if"）
- HTML/CSS 只入门，前端概念（DOM、浏览器 API）基本空白，需要从这补起
- 课程材料用中文为主，术语保留英文原文
- 教学文件放在本仓库的 `learn-js/` 目录下
- 浏览器是主要运行环境，Node.js 是次要环境（构建脚本用）

## Out of scope

- 不打算学写完整的 React/Vue 应用
- 不追求背下所有 Web API，按需学，以能读懂本博客为准
- 不学 TypeScript 的深水区（泛型、类型体操），够读懂 `.ts` 文件即可
