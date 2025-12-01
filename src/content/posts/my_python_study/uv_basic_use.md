---
title: uv基础使用
published: 2025-12-01
pinned: true
description: A simple example of a Markdown blog post.
tags: [Markdown, Blogging,uv,python]
category: study python
licenseName: "Unlicensed"
author: lnxlnxlnx
sourceLink: "https://github.com/emn178/markdown"
draft: false
date: 2025-12-01
image: ./cover.jpg
pubDate: 2025-12-01
---
## 常用操作:
``` shell
uv venv                     # 创建环境
uv venv my-env -p 3.11      # 指定环境名字和python版本
uv venv -p python@3.11 # 使用 python3.11 创建 .venv
source .venv/bin/activate   # 激活环境 (此步仍然需要)
uv init # 初始化uv项目
uv pip install # 装包
uv add # 为项目加包
uv sync # 如果有拉取一个uv的项目，直接sync即可配置好环境
uv pip freeze > requirements.txt # 生成一个包含所有已安装包及其精确版本的列表，格式与 pip freeze 的输出相同，常用于生成 requirements.txt 文件
```

## 进阶:
``` toml
# pyproject.toml

# 1. 构建系统配置
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

# 2. 项目核心元数据
[project]
name = "data-analyzer"
version = "1.0.0"
description = "A tool for analyzing data sets."
readme = "README.md"
requires-python = ">=3.9"
license = { text = "MIT" }
authors = [{ name = "Data Team", email = "data@example.com" }]

dependencies = [
  "pandas>=2.0.0",
  "numpy",
  "matplotlib",
]

[project.optional-dependencies]
dev = [
  "pytest",
  "ruff",
  "uv >= 0.1.0",
]

[project.scripts]
analyze = "data_analyzer.main:run"

[project.urls]
Repository = "https://github.com/example/data-analyzer"

# 3. 第三方工具配置
[tool.ruff]
line-length = 99
select = ["E", "F", "W", "I", "N", "D"]
ignore = ["D100", "D104"] # 忽略部分文档字符串规则

[tool.pytest.ini_options]
minversion = "6.0"
addopts = "-ra -q"
testpaths = [
    "tests",
]
```