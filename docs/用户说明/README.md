# 用户说明

本目录是本博客（Firefly 主题，基于 Astro 5 + Tailwind CSS）的使用与修改说明，内容针对你部署在 **GitHub Pages**（`https://lnxlnxlnx.github.io/my-blog/`）的实例编写。

## 📖 文档结构

| 文件 | 说明 |
| --- | --- |
| [快速开始](./快速开始.md) | 环境准备、本地开发、构建预览、部署上线（GitHub Pages） |
| [发布文章](./发布文章.md) | 如何写文章：Frontmatter、Markdown 扩展语法、配图、草稿 |
| [配置指南](./配置指南.md) | `src/config/` 全部配置文件的逐项说明 |
| [常见问题](./常见问题.md) | 开发与部署中常见问题的排查方法 |

## 🚀 一分钟速览

```bash
# 1. 安装依赖（Windows 下使用 PowerShell 即可）
pnpm install

# 2. 本地预览
pnpm dev          # 打开 http://localhost:4321

# 3. 写文章（自动生成 Frontmatter 模板）
pnpm new-post 我的新文章

# 4. 检查并构建
pnpm check
pnpm build

# 5. 发布：push 到 main 分支，GitHub Actions 会自动部署
git add .
git commit -m "新增文章"
git push
```

## 📁 项目结构速查

```
Firefly/
├── src/
│   ├── content/
│   │   ├── posts/          # 📝 所有文章（Markdown），在此写文章
│   │   └── spec/           # about / friends / guestbook 页面内容
│   ├── config/             # ⚙️ 全部站点配置（改这里定制博客）
│   ├── pages/              # 页面路由（about/sponsor/bangumi/archive 等）
│   ├── components/         # 组件
│   ├── layouts/            # 布局
│   ├── i18n/               # 多语言翻译
│   └── styles/             # 样式
├── public/assets/          # 静态资源（头像、壁纸、二维码等）
├── astro.config.mjs        # Astro 配置（site、base、插件）
└── .github/workflows/      # GitHub Actions 部署流程
```

> [!TIP]
> **平时只需要碰两个地方：** 写文章在 `src/content/posts/`，改配置在 `src/config/`。其余都是主题内部代码。
