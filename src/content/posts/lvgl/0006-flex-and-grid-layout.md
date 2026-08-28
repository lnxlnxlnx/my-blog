---
title: Flex 与 Grid 布局
published: 2026-08-22
description: 第 6 课：告别手算坐标——一维 Flex 摆"行与列"、二维 Grid 搭"表格"，包含主轴/交叉轴、对齐、grow、间隙与轨道描述符，做出导航栏和数字键盘。
tags: [LVGL, 嵌入式, GUI, Flex, Grid, 布局]
category: LVGL
draft: false
prevTitle: 基础控件
prevSlug: "lvgl/0007-basic-widgets"
nextTitle: 定时器与动画
nextSlug: "lvgl/0005-timers-and-animations"
---

# Flex 与 Grid 布局

告别手算坐标：一维 Flex 摆"行与列"，二维 Grid 搭"表格"，产品界面的骨架。

**本课目标：**学完你能①给容器开启 Flex，熟练摆主轴/交叉轴、对齐、grow 和间隙；②用 Grid 描述符数组 + `lv_obj_set_grid_cell` 搭出整齐的网格；③一眼判断"这屏该用 Flex 还是 Grid"。课程最后做出"顶部导航栏 + 3×3 数字键盘"。

## 1. 为什么需要布局：手算坐标的痛

前几课我们建控件都用 `lv_obj_align` 一个个人工摆放。对象少还行，一旦上十个：改一个按钮的位置，下面的全要跟着挪；换个字体宽度变了，整行都歪。这就是"手算坐标"的痛。

LVGL 从 V8 开始引入 CSS 同款的 Flex 和 Grid 布局（PDF 48.1 (PDF p.497)）：你只管**告诉容器"怎么排"**，子对象自动各就各位，容器尺寸一变，全家跟着重新排。

- **Flex（一维）**：一次只处理一行或一列，擅长"导航栏、按钮组、列表行"
- **Grid（二维）**：同时处理行和列，擅长"键盘、仪表盘、宫格菜单"

好消息：你工程 `EXTERNAL/LVGL/lv_conf.h` 里 `LV_USE_FLEX` 和 `LV_USE_GRID` 都已是 1（608/611 行），直接能用，无需改配置。

> 💡 记忆锚点：**Flex = 一维排布（行或列），Grid = 二维表格**。CSS 上这两套规则的思路和 LVGL 完全同构，写过网页的人五分钟上手。

## 2. Flex 基础：主轴、交叉轴与 flow

Flex 的容器里有两根轴线（PDF 48.2.2 (PDF p.497)）：**主轴**是对象放置的方向，**交叉轴**垂直于主轴。启用 Flex 有两种等价写法（PDF 48.2.3 (PDF p.500)）：

```c
/* 方式一：lv_obj_set_flex_flow 一步到位（推荐，最常用） */
lv_obj_t * nav = lv_obj_create(lv_scr_act());
lv_obj_set_size(nav, 280, 40);
lv_obj_set_flex_flow(nav, LV_FLEX_FLOW_ROW);   /* 主轴=行，不换行 */

/* 方式二：显式开布局，flow 用样式设置 */
lv_obj_t * nav2 = lv_obj_create(lv_scr_act());
lv_obj_set_layout(nav2, LV_LAYOUT_FLEX);       /* 开启 Flex 布局 */
lv_obj_set_style_flex_flow(nav2, LV_FLEX_FLOW_ROW_WRAP, 0);
```

主轴方向由 `LV_FLEX_FLOW_*` 决定，共 8 种（PDF 48.2.2 (PDF p.497)）：

| 配置项 | 效果 |
|--------|------|
| `LV_FLEX_FLOW_ROW` | 排成一行，不换行（超宽会出现滚动条） |
| `LV_FLEX_FLOW_ROW_WRAP` | 排成一行，放不下自动换行 |
| `LV_FLEX_FLOW_ROW_REVERSE` | 一行，顺序反转（右往左） |
| `LV_FLEX_FLOW_ROW_WRAP_REVERSE` | 一行+换行+反转 |
| `LV_FLEX_FLOW_COLUMN` | 排成一列，不换列 |
| `LV_FLEX_FLOW_COLUMN_WRAP` | 排成一列，放不下自动换列 |
| `LV_FLEX_FLOW_COLUMN_REVERSE` | 一列，顺序反转 |
| `LV_FLEX_FLOW_COLUMN_WRAP_REVERSE` | 一列+换列+反转 |

注意：子对象超出容器范围时，系统会自动启用滚动条（PDF 48.2.2 (PDF p.498)）——这反而是个便利，不用手动配滚动。

## 3. Flex 对齐、grow 与间隙

对齐是 Flex 的精华，一个函数管三处（PDF 48.2.4 (PDF p.502)）：

```c
lv_obj_set_flex_align(cont, main_place, cross_place, track_cross_place);
```

| 形参 | 含义 | 可用配置 |
|------|------|----------|
| `main_place` | 主轴上的对齐/空间分配 | START / END / CENTER / SPACE_EVENLY / SPACE_AROUND / SPACE_BETWEEN |
| `cross_place` | 交叉轴对齐（子对象高低不一时最有用） | START / END / CENTER / 以及上面三种 SPACE |
| `track_cross_place` | 多条轨道（换行后）整体在交叉轴的位置 | 只能 START / END / CENTER |

`SPACE_BETWEEN` 是"两端顶满、中间均分"，做"标题左 + 按钮右"的导航行神器；`SPACE_EVENLY` 是"所有空隙相等"。还有个增长利器 `lv_obj_set_flex_grow(obj, n)`（PDF 48.2.5 (PDF p.503)）：给子对象一个正整数，它会把主轴剩余空间按比例吃掉——比如 400px 剩余空间分给三个对象，grow 设为 1、1、2，则宽 100、100、200。grow 为 0 表示不参与分配。

子对象之间要留缝，用间隙（PDF 48.2.7 (PDF p.504)）：

```c
/* 行间距 10px，列间距 6px（在容器上设置） */
lv_obj_set_style_pad_row(cont, 10, 0);
lv_obj_set_style_pad_column(cont, 6, 0);
```

## 4. Grid：轨道与描述符数组

Grid 是二维的：先在容器上声明"行轨道、列轨道"，再把子对象放进指定单元格（PDF 49.1 (PDF p.505)）。轨道用描述符数组描述，最后一个元素必须是 `LV_GRID_TEMPLATE_LAST`：

```c
/* 列：3 列，每列 1 份剩余空间（等分） */
static lv_coord_t col_dsc[] = { LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1),
                                LV_GRID_TEMPLATE_LAST };
/* 行：3 行，每行 60px */
static lv_coord_t row_dsc[] = { 60, 60, 60, LV_GRID_TEMPLATE_LAST };

lv_obj_t * cont = lv_obj_create(lv_scr_act());
lv_obj_set_size(cont, 280, 220);
lv_obj_center(cont);

/* 把轨道描述符挂到容器样式上 */
lv_obj_set_style_grid_column_dsc_array(cont, col_dsc, 0);
lv_obj_set_style_grid_row_dsc_array(cont, row_dsc, 0);

/* 开启 Grid 布局（Flex/Grid 二选一，不能同时） */
lv_obj_set_layout(cont, LV_LAYOUT_GRID);
```

轨道大小除了写死像素，还有两个特殊值（PDF 49.2.3 (PDF p.505)）：

- `LV_GRID_CONTENT`：轨道宽度 = 该列/行上最宽/最高的子对象
- `LV_GRID_FR(x)`：按份数瓜分剩余空间，数字越大占得越多

## 5. Grid：把对象放进单元格

Grid 不像 Flex 那样自动流动——**子对象不会自动进网格**，必须显式告诉它"你在哪一格"（PDF 49.2.4 (PDF p.506)）：

```c
lv_obj_set_grid_cell(child,
                     LV_GRID_ALIGN_STRETCH,  /* 列内对齐 */
                     col_pos,                 /* 列索引（从 0 开始） */
                     col_span,                /* 跨几列 */
                     LV_GRID_ALIGN_STRETCH,   /* 行内对齐 */
                     row_pos,                 /* 行索引 */
                     row_span);               /* 跨几行 */
```

列/行索引都从 0 开始：`col_pos=0, row_pos=0` 是第一格，`col_pos=2, row_pos=1` 是第二行最右。对齐配置有 `LV_GRID_ALIGN_START`（左上默认）、`LV_GRID_ALIGN_CENTER`（居中）、`LV_GRID_ALIGN_END`（右下）和 `LV_GRID_ALIGN_STRETCH`（拉满整格，最常用）。容器整体对齐用 `lv_obj_set_grid_align(cont, column_align, row_align)`，间隙同样用 `pad_row` / `pad_column`（PDF 49.2.5~49.2.7 (PDF p.507)）。

> ⚠️ 两个高频翻车点：① **忘了 `lv_obj_set_grid_cell`**——没指定单元格的子对象默认全挤在 (0,0) 那一格，叠成一坨；② **同一个容器上既设 Flex 又设 Grid**——布局是二选一，后设置的覆盖先设置的，界面会"突然变样"。## 代码示例 1：Flex 顶部导航栏

```c
void nav_bar_create(lv_obj_t * parent)
{
    /* 导航容器：占满屏宽，高 44 */
    lv_obj_t * nav = lv_obj_create(parent);
    lv_obj_set_size(nav, LV_PCT(100), 44);
    lv_obj_set_flex_flow(nav, LV_FLEX_FLOW_ROW);   /* 一行排开 */
    lv_obj_set_flex_align(nav, LV_FLEX_ALIGN_CENTER,
                               LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(nav, 8, 0);        /* 按钮之间留 8px */

    /* 左侧"返回"按钮：占剩余空间 1 份 */
    lv_obj_t * back = lv_btn_create(nav);
    lv_obj_set_flex_grow(back, 1);
    lv_obj_t * back_lb = lv_label_create(back);
    lv_label_set_text(back_lb, "<");
    lv_obj_center(back_lb);

    /* 中间标题：占 2 份，比按钮更宽 */
    lv_obj_t * title = lv_btn_create(nav);
    lv_obj_set_flex_grow(title, 2);
    lv_obj_set_style_bg_color(title, lv_color_hex(0x1f4e8c), LV_PART_MAIN);
    lv_obj_t * title_lb = lv_label_create(title);
    lv_label_set_text(title_lb, "主页");
    lv_obj_center(title_lb);

    /* 右侧"设置"按钮：占 1 份 */
    lv_obj_t * set = lv_btn_create(nav);
    lv_obj_set_flex_grow(set, 1);
    lv_obj_t * set_lb = lv_label_create(set);
    lv_label_set_text(set_lb, "设置");
    lv_obj_center(set_lb);
}
```

## 代码示例 2：Grid 3×3 数字键盘

```c
static lv_obj_t * display_label;

static void key_event_cb(lv_event_t * e)
{
    lv_obj_t * btn = lv_event_get_target(e);
    const char * txt = lv_label_get_text(lv_obj_get_child(btn, 0));
    /* 把按下的数字追加显示 */
    lv_label_set_text_fmt(display_label, "%s%s",
                          lv_label_get_text(display_label), txt);
}

void keypad_create(lv_obj_t * parent)
{
    /* 顶部显示区 */
    display_label = lv_label_create(parent);
    lv_obj_set_width(display_label, 200);
    lv_obj_set_style_text_font(display_label, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_label_set_text(display_label, "");
    lv_obj_align(display_label, LV_ALIGN_TOP_MID, 0, 10);

    /* 键盘容器：3 列等分，4 行固定高 */
    static lv_coord_t col_dsc[] = { LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1),
                                    LV_GRID_TEMPLATE_LAST };
    static lv_coord_t row_dsc[] = { 50, 50, 50, 50, LV_GRID_TEMPLATE_LAST };

    lv_obj_t * kb = lv_obj_create(parent);
    lv_obj_set_size(kb, 200, 220);
    lv_obj_align(kb, LV_ALIGN_BOTTOM_MID, 0, -10);
    lv_obj_set_style_grid_column_dsc_array(kb, col_dsc, 0);
    lv_obj_set_style_grid_row_dsc_array(kb, row_dsc, 0);
    lv_obj_set_style_pad_row(kb, 6, 0);        /* 行间隙 */
    lv_obj_set_style_pad_column(kb, 6, 0);     /* 列间隙 */
    lv_obj_set_layout(kb, LV_LAYOUT_GRID);

    /* 0~9 + 清除，共 11 个键，最后一格留给"删除" */
    const char * keys[] = { "1", "2", "3",
                            "4", "5", "6",
                            "7", "8", "9",
                            "0", "<", "C" };

    uint32_t i;
    for (i = 0; i < 12; i++) {
        lv_obj_t * btn = lv_btn_create(kb);
        /* 放进 (i % 3, i / 3) 单元格，STRETCH 拉满 */
        lv_obj_set_grid_cell(btn, LV_GRID_ALIGN_STRETCH, i % 3, 1,
                                  LV_GRID_ALIGN_STRETCH, i / 3, 1);
        lv_obj_t * lb = lv_label_create(btn);
        lv_label_set_text(lb, keys[i]);
        lv_obj_center(lb);
        lv_obj_add_event_cb(btn, key_event_cb, LV_EVENT_CLICKED, NULL);
    }
}
```

小提示：`lv_label_get_text` 取子标签文本、`lv_obj_get_child(btn, 0)` 拿按钮里的第一个子对象——这是"从事件里拿按钮文字"的惯用套路。

## 动手练习（约 25 分钟）

### 练习 6.1：Flex 顶部导航栏（真机）

- 1️⃣ 照代码示例 1 建一个导航栏：返回按钮（grow=1）+ 标题（grow=2）+ 设置按钮（grow=1），烧录看效果。
- 2️⃣ 把 `lv_obj_set_flex_align` 的 main_place 依次换成 `SPACE_BETWEEN`、`SPACE_EVENLY`、`END`，逐个烧录观察：grow 和 SPACE 系列谁优先？为什么？（提示：grow 会把剩余空间吃光，SPACE 就没有可分的空间了）
- 3️⃣ 思考题：把容器宽度从 `LV_PCT(100)` 改成固定 200px，标题按钮会发生什么？试试再验证。

### 练习 6.2：Grid 数字键盘（真机）

- 1️⃣ 照代码示例 2 搭键盘，确认 12 个键各自落在正确的格子里（"C" 应该在右下角）。
- 2️⃣ 改动三处看效果：a) 把列描述符改成 `{LV_GRID_FR(1), LV_GRID_FR(2), LV_GRID_FR(1), LAST}`——中间列变宽，键盘变成"大额头"；b) 把某一格的 align 从 STRETCH 改成 CENTER，看按钮变成"小方块居中"；c) 把 `pad_column` 调成 20，观察键之间缝隙变大。
- 3️⃣ 给 "C" 键加逻辑：按下时清空显示（提示：在回调里判断文本是不是 "C"）。

## 自测（答完再点答案）

### 随堂小测 1

Q1. Flex 和 Grid 的本质区别是？
- A. Flex 快，Grid 慢，性能差异大
- B. Flex 是一维排布，Grid 是二维表格
- C. Flex 只能横排，Grid 只能竖排

<details>
<summary>查看答案</summary>

B。Flex 一次只处理一个维度（行或列），Grid 同时处理行列（PDF p.497）。
</details>

Q2. 想让 Flex 子对象按 1:2:1 瓜分剩余宽度，用哪个函数？
- A. lv_obj_set_flex_align 三个对象各传不同值
- B. lv_obj_set_flex_grow 分别传 1、2、1
- C. lv_obj_set_style_pad_column 传不同值

<details>
<summary>查看答案</summary>

B。grow 按比例分配剩余空间（PDF p.503）；pad 只调间隙。
</details>

Q3. Grid 里忘了调用 lv_obj_set_grid_cell 的子对象会怎样？
- A. 自动按顺序流入下一个空单元格
- B. 被布局忽略，留在屏幕左上角
- C. 全部叠在 (0,0) 第一个单元格里

<details>
<summary>查看答案</summary>

C。Grid 不自动放子对象，默认位置都是 (0,0)，会叠成一坨（PDF p.506）。
</details>

Q4. 描述符数组 {100, LV_GRID_FR(1), LV_GRID_TEMPLATE_LAST} 表示什么？
- A. 两列：第一列 100px，第二列占满剩余
- B. 一列：宽 100px 并自动缩放适配
- C. 两列：各占 50px 和 100px

<details>
<summary>查看答案</summary>

A。三个元素（含 LAST 结束符）即两列轨道，FR(1) 吃剩余空间（PDF p.505）。
</details>

## 推荐阅读

- 📖 正点原子《LVGL 开发指南 V1.5》第四十八章（Flex，PDF p.497~504）和第四十九章（Grid，PDF p.505~508）——本课全部依据
- 🌐 [LVGL 官方文档 Flex（v8.3）](https://docs.lvgl.io/8.3/layouts/flex.html)——Flex flow / Flex align / Flex grow 三节，附交互示例
- 🌐 [LVGL 官方文档 Grid（v8.3）](https://docs.lvgl.io/8.3/layouts/grid.html)——Grid descriptors / Grid items 两节，讲清 FR 与 span

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：[第 7 课：基础控件](/my-blog/posts/lvgl/0007-basic-widgets/)——label、btn、btnmatrix、checkbox、switch 五块"砖"，搭一个设置页雏形。

| [← 上一课](/my-blog/posts/lvgl/0005-timers-and-animations/) | [课程目录](/my-blog/posts/lvgl/00-总览/) | [下一课 →](/my-blog/posts/lvgl/0007-basic-widgets/) |