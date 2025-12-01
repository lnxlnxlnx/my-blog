---
title: ruff基础使用
published: 2025-12-01
pinned: false
description: A simple example of a Markdown blog post.
tags: [Markdown, Blogging,uv,python]
category: study python
licenseName: "Unlicensed"
author: lnxlnxlnx
sourceLink: "https://github.com/emn178/markdown"
draft: false
date: 2025-12-01
image: ./yuki.jpg
pubDate: 2025-12-01
---
# ruff功能一览:
![ruff功能图](image.png)

| 任务 | 命令 |
| --- | --- |
| **格式化我的代码** | `ruff format .` |
| **检查代码问题并自动修复** | `ruff check . --fix` |
| **在 CI/CD 中验证格式** | `ruff format . --check` |
| **在 CI/CD 中检查代码质量** | `ruff check .` |
| **开发时实时检查** | `ruff check . --watch` |
| **搞不清某条规则是什么意思** | `ruff rule <RULE_CODE>` |
| **清理缓存** | `ruff cache clean` |
| **终极清理** | `ruff format . && ruff check . --fix` |