# 0001: 学习者已具备编程基础，前端薄弱

用户明确表示：学过其他编程语言（变量、函数、循环、条件等概念已懂），但 JavaScript 基本没学；HTML/CSS 只入门，很多基础标签不会用，DOM 与浏览器 API 是空白。目标为读懂 Firefly 博客（Astro + Svelte + TS）。

**Evidence**: 课程启动访谈时用户亲口陈述；后续问题可据此设计难度。

**Implications**: 教学不应重复"什么是 if/for/函数"这类通用概念，而应聚焦 JS 特有的语法（`const`/`let`、箭头函数、模板字符串、`switch`、`&&` 短路、模块导入导出）以及浏览器环境（`document`、`window`、`localStorage`、事件）。第一课直接拿真实代码 `src/scripts/theme-manager.js` 讲解，在用户已知概念之上搭 JS 特有知识。HTML/CSS 基础标签薄弱，后续涉及模板/样式时要顺带补充。
