# JavaScript Glossary

本词汇表是 Firefly 博客课程（learn-js）使用的规范术语，所有课程材料遵守这里的定义。

## 语法

**const**:
值在声明后不可重新赋值的变量。是 JS 里的默认首选。
_Avoid_: final 变量、不可变变量

**let**:
声明"后面会被重新赋值"的变量。只在值会变时用。
_Avoid_: 可变变量

**var**:
旧式声明，有作用域陷阱，本课程禁用。

**箭头函数 (arrow function)**:
`(参数) => 表达式或语句块` 定义函数；是"值"，可存进变量、当作参数传递。
_Avoid_: lambda（虽然本质一样，但本课程统一叫箭头函数）

**模板字符串 (template literal)**:
用反引号 `` ` `` 包裹、可用 `${变量}` 插入值的字符串。
_Avoid_: 模板字符串（指 Python 的 f-string 之类）

**对象 (object)**:
`{ 键: 值 }` 的映射表；值可以是任何类型，包括函数（此时叫方法）。
_Avoid_: 字典、哈希表（虽然结构类似，但 JS 术语是对象）

**三目运算符**:
`条件 ? A : B`，等价于 `if (条件) A; else B`。

**可选链 `?.`**:
`a?.b` 在 a 为 null/undefined 时返回 undefined 而不报错。

**非空断言 `!`**:
`a!` 向 TS 编译器声明"a 一定不为空"，仅存在于 TypeScript。

## 类型

**类型标注 (type annotation)**:
TS 里用冒号给变量/参数/返回值标类型，如 `x: string`。编译时被擦除。

**Record<Key, Value>**:
TS 内置类型，表示"键是 Key 类型、值是 Value 类型的映射对象"。

**type / interface**:
TS 里给对象形状起名字的方式，如 `type Tag = { name: string }`。

## 数组与数据

**map**:
`arr.map(fn)` 把每个元素映射成新值，返回等长新数组。

**filter**:
`arr.filter(fn)` 留下回调返回 true 的元素，返回变短的新数组。

**find**:
`arr.find(fn)` 返回第一个满足条件的元素，否则 undefined。

**sort**:
`arr.sort(fn)` 原地排序，回调返回负数/正数/0 决定顺序。数字排序必须传 `(a,b)=>a-b`。

**forEach**:
`arr.forEach(fn)` 逐元素执行副作用，不返回新数组。

## 模块

**export**:
文件向外暴露变量/函数/类型的关键字。具名导出（`export const x`）与默认导出（`export default`）。

**import**:
引入其他文件导出的内容。`import { a } from "..."` 具名、`import a from "..."` 默认、`import type` 只导类型。

**路径别名**:
如 `@/` → `src/`，tsconfig/astro.config 里配置的目录快捷方式。

## 异步

**异步 (async)**:
不阻塞等待慢操作（网络、定时、读文件），完成后继续执行的编程方式。

**async 函数**:
`async function` 或 `async () =>`，总是返回 Promise。

**await**:
在 async 函数里暂停，直到 Promise 完成并取出结果。
_Avoid_: 阻塞等待（await 不阻塞整个线程）

**Promise**:
代表"未来某个时刻的结果"的对象。三种状态：pending / fulfilled / rejected。

**Promise.all**:
接收 Promise 数组，并行等待全部完成，结果按序放回数组。

**fetch**:
浏览器/Node 发起网络请求的标准 API，返回 Promise。

## 浏览器环境

**DOM (Document Object Model)**:
浏览器把 HTML 解析成的对象树；JS 通过 `document` 访问它。

**document**:
代表整个网页文档的全局对象，提供查找元素、操作元素的方法。

**window**:
代表浏览器窗口的全局对象；`localStorage`、`matchMedia`、事件都挂在它上面。

**localStorage**:
浏览器提供的键值仓库，刷新后数据仍在。

**事件 (event)**:
浏览器中发生的事（点击、按键、滚动、窗口变化）；用 `addEventListener("事件名", 回调)` 监听。

**回调 (callback)**:
被当作参数传给另一个函数、等待特定时机才被调用的函数。
_Avoid_: 勾子、监听器函数（在本课程中统一叫回调）

**addEventListener**:
给元素/对象注册事件监听的方法；事件发生时浏览器调用你传的回调。

**classList**:
元素上的 CSS 类名列表，`.add()` / `.remove()` / `.contains()` 操作类。

## 框架

**frontmatter**:
.astro 文件最顶部 `---` 包裹的脚本区，在构建时运行，取数据、算逻辑。

**静态站点生成 (SSG)**:
构建时用数据生成纯 HTML 文件，部署后无需服务器渲染。Astro 的核心。

**响应式 (reactive)**:
变量变化自动更新 UI 的机制；Svelte 用 `$state()` 声明响应式状态。

**组件 (component)**:
可复用的 UI 单元；本博客用 .svelte 组件实现交互 UI。

**$state**:
Svelte 5 声明响应式状态的语法，`let x = $state(初始值)`。

**onMount**:
Svelte 生命周期函数，组件挂载进页面后执行一次回调；可返回清理函数。