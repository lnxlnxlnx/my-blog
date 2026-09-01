# LR-0002 汇编课示例扩展 + 内联高亮工具化

用户反馈汇编课示例偏少、部分指令不熟。已（1）新建参考库 reference/instructions.html（8 组 ~50 条指令逐条示例，对齐指南第 7 章与 ARMv7-A）；(2) 扩写 A03（七组指令 + 条件后缀表 + 更重练习、quiz +1 题）；(3) 新增通用高亮工具 course/assets/tools/highlight_py.py。

高亮方案确定：仿 python_study/deeplearning 课程——**构建期预渲染**为 `<pre lang="X" class="highlight"><span style="color:#...">` 内联样式（VSCode Light+ 配色），不依赖运行时 JS；`highlight.min.js`/`highlight-vscode-light.css`/`highlight-init.js` 已从两门课页面中移除。调色板 KW=#00F、FUNC=#795E26、ID=#001080、TYPE=#267F99、STR=#A31515、NUM=#098658、COM=#008000。

Implications：以后新增/编辑代码块时，写 `<pre><code class="language-X">`（或 `<pre lang="X" class="highlight">` 原始文本）再跑 `python3 course/assets/tools/highlight_py.py <file>` 即可；idempotent（已有 span 的块跳过）。bash/makefile 只对注释/字符串/变量/数字/关键字上色（路径段保持黑色防噪），c/dts/armasm 保留标识符着色。

Evidence：28 个 HTML 结构校验全过、50+ 链接无死链；35+9 个代码块均已渲染为内联 span。