/**
 * 静态预渲染代码高亮脚本 v2 —— 内联样式模式
 * 把 lessons/*.html 里的 <pre><code class="language-c"> 代码块用 highlight.js
 * token 化后，转成 VSCode Light+ 配色的「行内 style」span：
 *   <pre class="highlight" style="background:#fff;..."><span style="color:#00F">if</span>...
 * 完全不依赖 CSS 文件，任何环境（浏览器/Obsidian 预览/打印/无样式环境）都显示一致。
 * 用法：node prehighlight.js
 */
const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'vendor', 'highlight.min.js'), 'utf8'));

const LESSONS_DIR = path.join(__dirname, '..', 'lessons');

/* hljs class -> VSCode Light+ 色板（与参考 html 一致） */
const PALETTE = {
  keyword:   { color: '#0000FF' },                 // if/for/return/void...
  built_in:  { color: '#795E26' },                 // printf 等内置函数
  type:      { color: '#267F99' },                 // lv_obj_t/int/typedef
  'class':   { color: '#267F99' },                 // 类名
  title:     { color: '#795E26' },                 // 函数名
  function_: { color: '#795E26' },                 // hljs 11 函数名
  params:    { color: '#001080' },                 // 函数参数
  variable:  { color: '#001080' },                 // 变量/属性
  string:    { color: '#A31515' },                 // 字符串
  regexp:    { color: '#A31515' },
  link:      { color: '#A31515', underline: true },
  number:    { color: '#098658' },                 // 数字
  literal:   { color: '#098658' },                 // 字面量 true/false/NULL
  comment:   { color: '#008000' },                 // 注释
  quote:     { color: '#008000' },
  doctag:    { color: '#008000' },                 // @param 等
  meta:      { color: '#267F99' },                 // #include/#define
  attr:      { color: '#001080' },
  attribute: { color: '#001080' },
  symbol:    { color: '#267F99' },
  section:   { color: '#795E26' },
  addition:  { color: '#098658' },
  deletion:  { color: '#A31515' },
  emphasis:  { italic: true },
  strong:    { weight: true },
};

function unescapeHtml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripSpans(s) {
  return s.replace(/<span[^>]*>|<\/span>/g, '');
}

/* hljs 输出（带 class 的 span）-> 内联 style span */
function inlineStyle(html) {
  return html.replace(/<span class="([^"]+)">/g, (m, cls) => {
    const classes = cls.split(/\s+/);
    for (const c of classes) {
      const key = c.replace(/^hljs-/, '');
      const rule = PALETTE[key];
      if (!rule) continue;
      let style = rule.color ? `color:${rule.color}` : '';
      if (rule.weight) style += (style ? ';' : '') + 'font-weight:700';
      if (rule.italic) style += (style ? ';' : '') + 'font-style:italic';
      if (rule.underline) style += (style ? ';' : '') + 'text-decoration:underline';
      return `<span style="${style}">`;
    }
    return '<span>';
  });
}

const PRE_OPEN = '<pre class="highlight" lang="c" style="background:#fff;border:1px solid #d4d4d4;border-radius:8px;padding:16px 18px;overflow-x:auto;line-height:1.55;font-size:0.88em;font-family:\'SF Mono\',\'JetBrains Mono\',\'Cascadia Code\',Consolas,monospace">';

const codeBlockRe = /<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/g;

function processLesson(file) {
  let html = fs.readFileSync(file, 'utf8');
  let count = 0;
  html = html.replace(codeBlockRe, (whole, lang, inner) => {
    const text = unescapeHtml(stripSpans(inner));
    const hl = hljs.highlight(text, { language: lang });
    count++;
    return PRE_OPEN + inlineStyle(hl.value) + '</pre>';
  });
  if (count === 0) {
    console.log(`  [skip] ${path.basename(file)} (no code blocks)`);
    return;
  }
  fs.writeFileSync(file, html, 'utf8');
  console.log(`  [done] ${path.basename(file)} (${count} blocks)`);
}

const files = fs.readdirSync(LESSONS_DIR).filter(f => f.endsWith('.html')).sort();
console.log(`Processing ${files.length} lessons...`);
files.forEach(f => processLesson(path.join(LESSONS_DIR, f)));
console.log('All done.');