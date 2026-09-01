// highlight-init.js — 供 qt-learning 各课 HTML 复用。
// 只高亮显式声明了 language-* 的 pre>code 块（普通文本块保持原样）。
// 配合 assets/highlight-vscode-light.css（VSCode Light+ 白色主题）与 highlight.min.js 使用。
document.addEventListener("DOMContentLoaded", function () {
  document
    .querySelectorAll("pre > code[class*='language-']")
    .forEach(function (el) {
      el.classList.remove("hljs");
      hljs.highlightElement(el);
      var pre = el.parentNode;
      pre.classList.add("hljs-wrap");
    });
});