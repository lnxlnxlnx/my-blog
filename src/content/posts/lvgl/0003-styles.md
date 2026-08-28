---
title: 样式系统
published: 2026-08-19
description: 第 3 课：让方块变好看——lv_style_t 普通样式与本地样式、部件组成（Part）、状态（State）、样式叠加优先级，做出"按下变色的按钮"和"圆角卡片"。
tags: [LVGL, 嵌入式, GUI, 样式, 状态, 部件]
category: LVGL
draft: false
prevTitle: 事件与交互
prevSlug: "lvgl/0004-events-and-interaction"
nextTitle: 对象系统与屏幕
nextSlug: "lvgl/0002-objects-and-screens"
---

# 样式系统

让方块变好看：lv_style_t、部件组成、状态、本地样式 vs 全局样式、样式叠加。

**本课目标：**上一课的界面还是灰扑扑的方块，这一课给它们"穿衣服"。学完你能用普通样式（共用）和本地样式（针对）两种方式美化对象，理解部件分"部分"、样式分"状态"，并做出"按下变色的按钮"和"圆角卡片"。

## 1. 样式是什么（6.4 总览）

样式（Style）就是对象的外观：背景、边框、阴影、文字颜色、圆角……LVGL 的样式系统深受 CSS 启发（PDF 6.4 节 (PDF p.89)），它有 7 个特点，记住这 4 条最常用的：

- 样式用 `lv_style_t` 变量保存，一个样式里可以打包多种属性（背景色、边框宽、阴影色……）
- 同一个样式可以被**任意多个对象共用**——这就是"普通样式"的威力
- 样式可以**级联**：一个对象可以叠加多个样式；多个样式都设置了同一属性时，**最后设置的生效**
- 没设置的属性可以从**父对象继承**（比如文本颜色）

另外两条先记住结论：样式可以指定"某个部分 + 某个状态"才生效（下面两节细讲）；本地样式的优先级比普通样式高。

## 2. 两种设置方法：普通样式与本地样式（6.4.1）

### 2.1 普通样式：一套"样式套装"到处用

适合界面里大量"长得一样"的控件。流程是：定义变量 → 初始化 → 设置属性 → 添加到对象（PDF 6.4.1 (PDF p.89)）：

```c
static lv_style_t style_btn;                                  /* 1. 定义样式变量（建议 static 或全局） */
lv_style_init(&style_btn);                                    /* 2. 初始化样式 */
lv_style_set_bg_color(&style_btn, lv_color_hex(0x115588));    /* 3. 设置背景色 */
lv_style_set_bg_opa(&style_btn, LV_OPA_50);                   /* 设置背景透明度 50% */
lv_style_set_border_width(&style_btn, 2);                     /* 设置边框宽度 */
lv_style_set_border_color(&style_btn, lv_color_black());      /* 设置边框颜色 */

/* 4. 添加到对象：两个按钮共用一套样式 */
lv_obj_t * obj1 = lv_obj_create(lv_scr_act());
lv_obj_add_style(obj1, &style_btn, LV_STATE_DEFAULT);

lv_obj_t * obj2 = lv_obj_create(lv_scr_act());
lv_obj_add_style(obj2, &style_btn, LV_STATE_DEFAULT);
```

### 2.2 本地样式：直接往对象身上贴

适合"这个控件长得特殊"的场景，设置简单、针对性强，函数格式是 `lv_obj_set_style_xxx`：

```c
lv_obj_t * obj = lv_obj_create(lv_scr_act());
/* 第三个参数是"状态及部分选择器"，这里指默认状态下生效 */
lv_obj_set_style_bg_color(obj, lv_color_red(), LV_STATE_DEFAULT);
```

> 💡 记忆口诀：**普通样式 lv_style_set_xxx 先定义后共享；本地样式 lv_obj_set_style_xxx 直接贴。**两者属性名几乎一一对应，记住关键词（bg_color、border_width、radius、shadow_width……）就能互相翻译。

## 3. 部件组成：一个控件拆成几块（6.4.2）

复杂部件可以拆成多个"部分（Part）"，每个部分单独设置样式（PDF 6.4.2 (PDF p.90)）。完整的部分枚举：

| 枚举 | 含义 | 典型部件 |
|------|------|----------|
| `LV_PART_MAIN` | 主体（背景矩形） | 所有部件 |
| `LV_PART_SCROLLBAR` | 滚动条 | 可滚动容器 |
| `LV_PART_INDICATOR` | 指示器（已填充部分） | 进度条、滑块 |
| `LV_PART_KNOB` | 旋钮 | 滑块 |
| `LV_PART_SELECTED` | 选中框 | 文本选择 |
| `LV_PART_ITEMS` | 相同成分（单元格） | 表格、矩阵 |
| `LV_PART_TICKS` | 刻度 | 仪表、标尺 |
| `LV_PART_CURSOR` | 光标 | 文本区域 |

拿滑块举例：它拆成主体背景（MAIN）、指示器（INDICATOR）、旋钮（KNOB）三块。想单独给指示器上色：

```c
lv_obj_t * slider = lv_slider_create(lv_scr_act());
/* 注意第三个参数换成了 LV_PART_INDICATOR —— 只改指示器，其余部分不动 */
lv_obj_set_style_bg_color(slider, lv_color_hex(0xff0000), LV_PART_INDICATOR);
```

## 4. 状态：样式什么时候生效（6.4.3）

状态（State）描述对象的"处境"：按着、选中、聚焦、禁用……（PDF 6.4.3 (PDF p.91)）。完整的状态表：

| 状态 | 含义 |
|------|------|
| `LV_STATE_DEFAULT` | 正常状态（兜底，几乎必设） |
| `LV_STATE_CHECKED` | 切换/选中（开关、勾选框） |
| `LV_STATE_FOCUSED` | 被触摸/键盘聚焦 |
| `LV_STATE_FOCUS_KEY` | 被键盘/编码器聚焦 |
| `LV_STATE_EDITED` | 被编码器编辑中 |
| `LV_STATE_PRESSED` | 正在被按下 |
| `LV_STATE_SCROLLED` | 正在滚动 |
| `LV_STATE_DISABLED` | 禁用（不响应交互） |

状态有两大用途：一是**指定样式在哪个状态下生效**（"按下变红"就是给 PRESSED 状态单独设颜色）：

```c
lv_obj_t * btn = lv_btn_create(lv_scr_act());
lv_obj_set_style_bg_color(btn, lv_color_hex(0x2196F3), LV_STATE_DEFAULT);  /* 平时蓝色 */
lv_obj_set_style_bg_color(btn, lv_color_hex(0xff0000), LV_STATE_PRESSED);  /* 按下变红 */
```

二是手动添加/清除状态（配合选中、禁用逻辑）：`lv_obj_add_state(obj, LV_STATE_CHECKED)` / `lv_obj_clear_state(obj, LV_STATE_CHECKED)`。

> ⚠️ **样式"不生效"的头号原因**：selector（第三个参数）写错。忘了写 `LV_STATE_DEFAULT` 兜底、或者只给 PRESSED 设了色而 DEFAULT 没设，都会看到"样式没反应"。排查时先问：这个样式挂在哪个部分、哪个状态下？

## 5. 常用样式属性速览（6.4.4）

完整属性有几十个（PDF 6.4.4 (PDF p.92~108)），日常开发高频的是这几组，函数名 = `lv_obj_set_style_` 或 `lv_style_set_` + 属性名：

| 分组 | 常用属性 | 说明 |
|------|----------|------|
| 背景 | `bg_color` `bg_opa` `bg_grad_color` `bg_grad_dir` | 背景色、透明度；渐变（方向 LV_GRAD_DIR_HOR/VER） |
| 边框 | `border_width` `border_color` `border_opa` `border_side` | 边框在主体之外；可只画一侧 |
| 阴影 | `shadow_width` `shadow_color` `shadow_ofs_x` `shadow_ofs_y` `shadow_opa` | 阴影在轮廓之外，像"悬浮"效果 |
| 填充 | `pad_top/bottom/left/right` | 父对象内侧留白，把子对象往里推 |
| 圆角 | `radius` | 0 直角，数值越大越圆；超大值=胶囊 |
| 文本 | `text_color` `text_font` `text_opa` | 文字颜色、字体、透明度 |
| 变换 | `translate_x` `translate_y` `transform_width` `transform_zoom` `transform_angle` | 按下时位移/变宽/缩放/旋转的"动效"，常用于 PRESSED 状态 |

颜色用 `lv_color_hex(0xRRGGBB)` 或调色板 `lv_palette_main(LV_PALETTE_BLUE)`；透明度用 `LV_OPA_10`~`LV_OPA_100` 或 0~255 整数。## 代码示例 1：按钮按下变色（完整版）

把本课知识串成一个完整按钮：默认蓝色、按下变红、附带按压缩放动效。注意 PRESSED 状态还有 `translate_y`——按下时按钮"陷下去"2 像素，手感立刻高级：

```c
/* 普通样式：按钮套装 */
static lv_style_t style_btn_def;
static lv_style_t style_btn_pressed;

void lvgl_demo_btn_style(void)
{
    /* 默认状态样式：蓝色圆角按钮 */
    lv_style_init(&style_btn_def);
    lv_style_set_bg_color(&style_btn_def, lv_color_hex(0x2196F3));
    lv_style_set_bg_opa(&style_btn_def, LV_OPA_100);
    lv_style_set_radius(&style_btn_def, 8);              /* 圆角 8px */
    lv_style_set_border_width(&style_btn_def, 2);
    lv_style_set_border_color(&style_btn_def, lv_color_hex(0x0D47A1));
    lv_style_set_shadow_width(&style_btn_def, 6);        /* 阴影 */
    lv_style_set_shadow_color(&style_btn_def, lv_color_hex(0x0D47A1));
    lv_style_set_shadow_ofs_y(&style_btn_def, 3);

    /* 按下状态样式：变红 + 往下沉 2px（只覆盖需要的属性） */
    lv_style_init(&style_btn_pressed);
    lv_style_set_bg_color(&style_btn_pressed, lv_color_hex(0xF44336));
    lv_style_set_translate_y(&style_btn_pressed, 2);

    /* 创建按钮并挂样式 */
    lv_obj_t * btn = lv_btn_create(lv_scr_act());
    lv_obj_add_style(btn, &style_btn_def, LV_STATE_DEFAULT);
    lv_obj_add_style(btn, &style_btn_pressed, LV_STATE_PRESSED);

    lv_obj_align(btn, LV_ALIGN_CENTER, 0, 0);
    lv_obj_set_size(btn, 160, 60);

    /* 按钮上放个文字标签（第 5 课会细讲 label） */
    lv_obj_t * label = lv_label_create(btn);
    lv_label_set_text(label, "点我");
    lv_obj_center(label);
}

/* 观察：按住不放变红并下沉，松开恢复蓝色 —— 这就是"状态驱动样式" */
```

## 代码示例 2：圆角卡片（普通样式 + 本地样式混合）

卡片是仪表盘/列表页的常客：白底、圆角、细边框、柔和阴影。这里演示"普通样式管公共部分，本地样式管个性部分"：

```c
/* 卡片通用样式：所有卡片共用 */
static lv_style_t style_card;

void lvgl_demo_card(void)
{
    lv_style_init(&style_card);
    lv_style_set_bg_color(&style_card, lv_color_hex(0xFFFFFF));
    lv_style_set_radius(&style_card, 12);                     /* 大圆角 */
    lv_style_set_border_width(&style_card, 1);
    lv_style_set_border_color(&style_card, lv_color_hex(0xE0E0E0));
    lv_style_set_shadow_width(&style_card, 10);               /* 柔和阴影 */
    lv_style_set_shadow_ofs_x(&style_card, 2);
    lv_style_set_shadow_ofs_y(&style_card, 4);
    lv_style_set_shadow_opa(&style_card, LV_OPA_30);
    lv_style_set_pad_all(&style_card, 12);                    /* 内边距，子对象被往里推 */

    /* 卡片 1：普通卡片，纯公共样式 */
    lv_obj_t * card1 = lv_obj_create(lv_scr_act());
    lv_obj_add_style(card1, &style_card, LV_STATE_DEFAULT);
    lv_obj_set_size(card1, 200, 80);
    lv_obj_align(card1, LV_ALIGN_TOP_MID, 0, 20);

    /* 卡片 2：普通样式打底 + 本地样式个性化（换个背景色和圆角） */
    lv_obj_t * card2 = lv_obj_create(lv_scr_act());
    lv_obj_add_style(card2, &style_card, LV_STATE_DEFAULT);
    lv_obj_set_style_bg_color(card2, lv_color_hex(0xE3F2FD), LV_STATE_DEFAULT); /* 本地样式覆盖 */
    lv_obj_set_style_radius(card2, 6, LV_STATE_DEFAULT);
    lv_obj_set_size(card2, 200, 80);
    lv_obj_align(card2, LV_ALIGN_BOTTOM_MID, 0, -20);

    /* 卡片 2 里放一个子对象：验证 pad_all 把子对象推进去 12px */
    lv_obj_t * child = lv_obj_create(card2);
    lv_obj_set_size(child, 60, 30);
    lv_obj_set_pos(child, 0, 0);   /* 坐标 (0,0)，但因为 pad，实际显示在 (12,12) */
}

/* 观察：card2 的背景色和圆角被本地样式"覆盖"，但边框、阴影仍来自公共样式 */
```

> 💡 样式叠加的真相：多个样式 + 本地样式叠在同一对象上时，**本地样式优先级最高，其次是后添加的样式**。card2 就是"公共样式打底 + 本地样式微调"，这是真实项目最常用的组合拳。

## 动手练习（约 30 分钟）

### 练习 3.1：按钮按下变色（完整版）

- 1️⃣ 按代码示例 1 写出完整的按钮样式函数，烧录观察：默认蓝色、按下红色、松开复原。
- 2️⃣ 把按下的样式改成"红色 + transform_width 变大 10px"，观察按下时按钮"涨大"的效果；再试试 `transform_zoom`（注意 256 表示不缩放）。
- 3️⃣ 给按钮加第三个状态：`LV_STATE_CHECKED` 设成绿色。用 `lv_obj_add_state(btn, LV_STATE_CHECKED)` 手动加上这个状态，观察颜色变化——状态是"可以叠加"的。
- 4️⃣ 思考：为什么 checked 的绿色能盖住默认的蓝色？它俩同时存在时哪个优先级高？（提示：状态有先后顺序，PRESSED > CHECKED > DEFAULT）

### 练习 3.2：圆角卡片

- 1️⃣ 按代码示例 2 搭两张卡片，验证"公共样式 + 本地样式覆盖"。
- 2️⃣ 把 `style_card` 的 `radius` 从 12 改成 40 再烧录，观察卡片变"胶囊"；给卡片 1 也加 `lv_obj_set_style_radius(card1, 0, ...)` 看本地样式怎么覆盖公共样式。
- 3️⃣ 给卡片加渐变背景：`bg_grad_color` + `bg_grad_dir`（LV_GRAD_DIR_HOR/VER），再试 `bg_grad_stop` 改变渐变起点，观察渐变形状变化。
- 4️⃣ 挑战：用 `lv_style_set_border_side(&style_card, LV_BORDER_SIDE_BOTTOM)` 只画底边框，配合阴影做一个"底部高亮条"风格的卡片。

## 自测（答完再点答案）

### 随堂小测 1

Q1. 两个按钮要共用同一套样式，正确做法是？
- A. 两个按钮各写一份本地样式
- B. 定义一个 lv_style_t，lv_obj_add_style 都挂它
- C. 把样式宏定义在头文件里

<details>
<summary>查看答案</summary>

B。普通样式（lv_style_t）天生就是"共享套装"，一份样式挂任意多个对象（PDF p.89）。
</details>

Q2. 滑块只想把"已填充部分"变红，selector 参数该写？
- A. LV_STATE_PRESSED
- B. LV_PART_MAIN
- C. LV_PART_INDICATOR

<details>
<summary>查看答案</summary>

C。LV_PART_INDICATOR 是滑块的指示器部分；LV_PART_MAIN 是整体背景。
</details>

Q3. "按下变红"效果应该怎么写？
- A. 背景色设到 LV_STATE_DEFAULT 状态
- B. 背景色设到 LV_STATE_PRESSED 状态
- C. 背景色设到 LV_PART_SCROLLBAR 部分

<details>
<summary>查看答案</summary>

B。PRESSED 状态只在按下时激活，松开自动恢复默认样式（PDF p.91）。
</details>

Q4. 一个对象同时挂了两个样式，都设置了 bg_color，最终显示？
- A. 先添加的那个样式生效
- B. 后添加的那个样式生效
- C. 两种颜色混合显示

<details>
<summary>查看答案</summary>

B。样式可以级联，同一属性由最后设置的生效（PDF p.89）；本地样式又优先于普通样式。
</details>

## 推荐阅读

- 📖 正点原子《LVGL 开发指南 V1.5》第 6.4 节（样式属性，(PDF p.89~108)）——样式设置方法、组成部分、状态、全部样式属性的图例
- 🌐 [LVGL 官方文档：Style（v8.3）](https://docs.lvgl.io/8.3/overview/style.html)——样式的 CSS 类比与完整属性清单
- 🌐 [LVGL 官方文档：Style properties（v8.3）](https://docs.lvgl.io/8.3/overview/style-props.html)——每个属性的单位、默认值、适用部分，写样式时的速查表

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：[第 4 课：事件与交互](/my-blog/posts/lvgl/0004-events-and-interaction/)——让界面"活"起来：点按钮有反应，按滑块有变化。

| [← 上一课](/my-blog/posts/lvgl/0002-objects-and-screens/) | [课程目录](/my-blog/posts/lvgl/00-总览/) | [下一课 →](/my-blog/posts/lvgl/0004-events-and-interaction/) |