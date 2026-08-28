---
title: 容器与导航
published: 2026-08-26
description: 第 10 课：list / tabview / tileview / win / menu / msgbox / span——把单页控件组织成"多页面产品"，部件篇收官课。
tags: [LVGL, 嵌入式, GUI, list, tabview, tileview, win, menu, msgbox, span]
category: LVGL
draft: false
prevTitle: 图片与字库 — 让界面"有图有字"
prevSlug: "lvgl/0011-images-and-fonts"
nextTitle: 输入控件
nextSlug: "lvgl/0009-input-widgets"
---

# 容器与导航

list / tabview / tileview / win / menu / msgbox / span —— 多页面产品界面的骨架。

**本课目标：**前两课学会了"单页里摆控件"，本课把它们组织成"多页面产品"：tab 切页、侧滑屏、窗口、菜单、确认弹窗、富文本。学完你能把界面分成清晰的功能区，用户怎么进、怎么退都由你说了算。这是部件篇的收官课，也是第 12 课综合项目的脚手架。

## 1. list：一列可点的菜单

list 是"竖排按钮 + 图标 + 分组标题"，产品界面的菜单栏标配（第 31 章 (PDF p.365)）：

```c
lv_obj_t * list = lv_list_create(lv_scr_act());
lv_obj_set_size(list, 240, 200);
lv_obj_center(list);

lv_list_add_text(list, "系统设置");                 /* 分组标题 */
lv_obj_t *btn1 = lv_list_add_btn(list, LV_SYMBOL_WIFI, "网络配置");
lv_obj_t *btn2 = lv_list_add_btn(list, LV_SYMBOL_BELL, "通知设置");
lv_obj_t *btn3 = lv_list_add_btn(list, LV_SYMBOL_TRASH, "恢复出厂");
```

图标传 `LV_SYMBOL_*` 内置符号，不想要图标/文本就传 NULL（第 31.2.1 节 (PDF p.365)）。每个按钮都是独立对象，事件挂在按钮上（第 31.4.2.2 节 (PDF p.369)）：

```c
static void list_btn_cb(lv_event_t *e)
{
    lv_obj_t *btn = lv_event_get_target(e);          /* 被点的按钮 */
    lv_obj_t * list = lv_event_get_user_data(e);      /* 通过 user_data 带出 list */
    printf("点了：%s\n", lv_list_get_btn_text(list, btn));
}
/* 挂载：lv_obj_add_event_cb(btn1, list_btn_cb, LV_EVENT_CLICKED, list); */
```

## 2. msgbox：确认弹窗

msgbox 是模态对话框，"删除前确认"这种场景全靠它（第 33 章 (PDF p.395)）。创建时五个参数一次给齐：

```c
static const char *btns[] = { "取消", "确定", "" };   /* 末尾空串必须有 */

lv_obj_t *mbox = lv_msgbox_create(NULL, "删除确认",
                  "确定要恢复出厂设置吗？此操作不可撤销。", btns, false);
lv_obj_center(mbox);
```

- `parent` 传 `NULL` 就是模态：弹窗盖住整个屏幕，不点按钮点哪都白点（第 33.2.1 节 (PDF p.395)）
- 按钮事件在 `LV_EVENT_VALUE_CHANGED` 里收，用 `lv_msgbox_get_active_btn` 看按了第几个；按 0 号是"取消"，1 号是"确定"（第 33.4.2.2 节 (PDF p.401)）
- 程序关闭：`lv_msgbox_close(mbox)`；想改样式就先取部件：`lv_msgbox_get_title / get_text / get_btns / get_close_btn`（第 33.2.2 节 (PDF p.396)）

> 💡 模态弹窗的正确用法：弹窗只负责"确认"，**动作在回调里做**。确定就执行、取消就什么都不做，别在弹窗里叠弹窗——小屏上那是灾难。

## 3. tabview：三秒搭出多页面

tabview（选项卡）是"多页面应用"最省事的方案：顶部一排 tab 按钮，内容区左右滑动切页（第 37 章 (PDF p.425)）：

```c
lv_obj_t *tv = lv_tabview_create(lv_scr_act(), LV_DIR_TOP, 40);
/* LV_DIR_TOP 按钮在顶，40 是 tab 条高度；也可 BOTTOM/LEFT/RIGHT */

lv_obj_t *tab_home = lv_tabview_add_tab(tv, "主页");
lv_obj_t *tab_data = lv_tabview_add_tab(tv, "数据");
lv_obj_t *tab_set  = lv_tabview_add_tab(tv, "设置");

/* 返回的是"内容容器"，往里塞控件就完事了 */
lv_obj_t *label = lv_label_create(tab_home);
lv_label_set_text(label, "欢迎回来");
```

切换三种方式：点 tab 按钮、内容区左右滑动、程序里 `lv_tabview_set_act(tv, 1, LV_ANIM_ON)`（id 从 0 数）。想改 tab 条样式，用 `lv_tabview_get_tab_btns(tv)` 和 `lv_tabview_get_content(tv)` 拿部件（第 37.2.3~37.2.4 节 (PDF p.427)）。

## 4. tileview：整屏翻页的"平铺视图"

tileview 和 tabview 的区别：tabview 是"一屏装多个页"，tileview 是**一屏一页、滑动整屏切换**，像手机的桌面（第 38 章 (PDF p.433)）。页面按"行列坐标"排布：

```c
lv_obj_t *tv = lv_tileview_create(lv_scr_act());

/* (0,0) 页：想往右滑到下一页，就给它 LV_DIR_RIGHT */
lv_obj_t *page0 = lv_tileview_add_tile(tv, 0, 0, LV_DIR_RIGHT);
lv_label_set_text(lv_label_create(page0), "第 0 页：主页");

/* (1,0) 页：从右边滑回来用 LV_DIR_LEFT */
lv_obj_t *page1 = lv_tileview_add_tile(tv, 1, 0, LV_DIR_LEFT);
lv_label_set_text(lv_label_create(page1), "第 1 页：数据");

/* 程序切页：按容器切 lv_obj_set_tile(tv, page1, LV_ANIM_ON) */
/* 按坐标切 lv_obj_set_tile_id(tv, 1, 0, LV_ANIM_ON) */
```

方向是"入口"不是"出口"：页面 1 在页面 2 左侧，就给页面 1 配 `LV_DIR_RIGHT`、页面 2 配 `LV_DIR_LEFT`，方向配错会滑不动（第 38.2.1 节 (PDF p.434)）。

## 5. win 与 menu：带"壳"的页面

**win（窗口）**自带标题栏和内容区，适合"二级页面"（第 39 章 (PDF p.440)）：

```c
lv_obj_t *win = lv_win_create(lv_scr_act(), 36);   /* 36 是标题栏高度 */
lv_win_add_title(win, "网络配置");
lv_win_add_btn(win, LV_SYMBOL_CLOSE, 40);          /* 图标按钮，宽 40 */
/* 标题和按钮按调用顺序从左往右排；内容区 lv_win_get_content(win) 往里塞控件 */
```

**menu（菜单）**更"结构感"：页面 + 页面用 `lv_menu_set_load_page_event` 串成树，点条目自动打开子页、自动生成返回键，多级设置页的终极形态（第 41 章 (PDF p.451)）：

```c
lv_obj_t *menu = lv_menu_create(lv_scr_act());
lv_menu_set_mode_root_back_btn(menu, LV_MENU_ROOT_BACK_BTN_ENABLED);

/* 建页面：一个"主页" + 一个"网络设置"子页 */
lv_obj_t *main_page = lv_menu_page_create(menu, "设置");
lv_obj_t *net_page  = lv_menu_page_create(menu, "网络设置");

/* 主页里放一个可点的条目容器，点击后自动跳到 net_page */
lv_obj_t *net_item = lv_menu_cont_create(main_page);
lv_label_set_text(lv_label_create(net_item), "网络设置");
lv_menu_set_load_page_event(menu, net_item, net_page);

/* 把主页设为主容器页，系统自动分"侧边栏 + 主容器" */
lv_menu_set_page(menu, main_page);
```

辅助三件套：`lv_menu_cont_create`（条目容器）、`lv_menu_section_create`（空区域分组）、`lv_menu_separator_create`（分隔线）（第 41.2.8 节 (PDF p.455)）。

## 6. span：一段文字，多种样式

span（跨度）是"富文本片段"：一个 span 组里塞多个 span，每个 span 有自己的文本、颜色、字体——标题混排、单位上色全靠它（第 34 章 (PDF p.404)）：

```c
lv_obj_t *spans = lv_spangroup_create(lv_scr_act());
lv_obj_set_size(spans, 280, 60);
lv_obj_center(spans);
lv_spangroup_set_mode(spans, LV_SPAN_MODE_BREAK);   /* 超宽自动换行 */
lv_spangroup_set_align(spans, LV_TEXT_ALIGN_LEFT);  /* 左对齐 */

/* 第一段：白色正文 */
lv_span_t *s1 = lv_spangroup_new_span(spans);
lv_span_set_text(s1, "当前温度 ");
lv_style_set_text_color(&s1->style, lv_color_white());

/* 第二段：红色大字，醒目 */
lv_span_t *s2 = lv_spangroup_new_span(spans);
lv_span_set_text(s2, "28.5");
lv_style_set_text_color(&s2->style, lv_palette_main(LV_PALETTE_RED));
lv_style_set_text_font(&s2->style, &lv_font_montserrat_24);

/* 第三段：灰色单位 */
lv_span_t *s3 = lv_spangroup_new_span(spans);
lv_span_set_text(s3, " ℃");
lv_style_set_text_color(&s3->style, lv_color_grey());
```

> ⚠️ **别混淆的三兄弟**：tabview 是"一屏内多个 tab 页"，tileview 是"整屏滑动的页面"，win 是"带标题栏的独立窗口"——选错了结构后面改起来很痛。另外 span 组的父对象必须是 `lv_spangroup_create` 创建的组，直接 `lv_obj_create` 当父对象是画不出文本的。## 代码示例 1：产品主框架（tabview 三页 + list 菜单）

这就是练习 10.1 的骨架：一个 tabview 分"主页 / 数据 / 设置"三页，设置页里放 list 菜单：

```c
static void settings_btn_cb(lv_event_t *e)
{
    lv_obj_t *btn = lv_event_get_target(e);
    lv_obj_t * list = lv_event_get_user_data(e);
    /* 这里只是打印，练习里换成"弹 msgbox 确认" */
    printf("菜单项：%s\n", lv_list_get_btn_text(list, btn));
}

void lvgl_demo_main_frame(void)
{
    /* 顶部三 tab */
    lv_obj_t *tv = lv_tabview_create(lv_scr_act(), LV_DIR_TOP, 36);

    /* 主页：一句欢迎词 + 一个状态灯 */
    lv_obj_t *tab_home = lv_tabview_add_tab(tv, "主页");
    lv_obj_t *welcome = lv_label_create(tab_home);
    lv_label_set_text(welcome, "欢迎回来，设备运行正常");
    lv_obj_align(welcome, LV_ALIGN_TOP_MID, 0, 20);
    lv_obj_t *led = lv_led_create(tab_home);
    lv_led_set_color(led, lv_palette_main(LV_PALETTE_GREEN));
    lv_led_on(led);
    lv_obj_align(led, LV_ALIGN_TOP_MID, 0, 60);

    /* 数据页：留给第 8 课的仪表盘 */
    lv_obj_t *tab_data = lv_tabview_add_tab(tv, "数据");

    /* 设置页：list 菜单 */
    lv_obj_t *tab_set = lv_tabview_add_tab(tv, "设置");
    lv_obj_t * list = lv_list_create(tab_set);
    lv_obj_set_size(list, lv_pct(100), lv_pct(100));
    lv_list_add_text(list, "系统");
    lv_obj_t *b1 = lv_list_add_btn(list, LV_SYMBOL_WIFI, "网络配置");
    lv_obj_t *b2 = lv_list_add_btn(list, LV_SYMBOL_TRASH, "恢复出厂");
    /* 两个按钮共用回调，user_data 带出 list 用于取按钮文本 */
    lv_obj_add_event_cb(b1, settings_btn_cb, LV_EVENT_CLICKED, list);
    lv_obj_add_event_cb(b2, settings_btn_cb, LV_EVENT_CLICKED, list);
}
```

## 代码示例 2：msgbox 删除确认 + span 状态栏

"恢复出厂"这种危险操作必须二次确认。示例 1 里点它，弹一个模态 msgbox：

```c
static void delete_confirm_cb(lv_event_t *e)
{
    lv_obj_t *mbox = lv_event_get_current_target(e);
    /* 按钮数组顺序：{ "取消", "确定", "" }，按 1 号才是确定 */
    if (lv_msgbox_get_active_btn(mbox) == 1) {
        printf("已恢复出厂设置\n");
        /* 这里写真正的恢复逻辑 */
    }
    lv_msgbox_close(mbox);          /* 无论哪个按钮，先关弹窗 */
}

static void factory_reset_cb(lv_event_t *e)
{
    LV_UNUSED(e);
    static const char *btns[] = { "取消", "确定", "" };
    lv_obj_t *mbox = lv_msgbox_create(NULL, "恢复出厂",
                      "将清除全部配置，确定继续？", btns, false);
    lv_obj_center(mbox);
    lv_obj_add_event_cb(mbox, delete_confirm_cb, LV_EVENT_VALUE_CHANGED, NULL);
}
```

> 💡 弹窗按钮数组的坑：`btns[]` 必须以空串 `""` 结尾，否则按最后一个按钮可能越界。这是 msgbox 最容易翻车的地方，忘一次记十年。

## 动手练习（约 45 分钟）

### 练习 10.1：搭"产品主框架"

- **怎么做：**新建 `BSP/lvgl_app_frame.c`，照示例 1 搭 tabview 三页（主页 / 数据 / 设置）：主页放欢迎语 + led；数据页把第 8 课的仪表盘移植进来；设置页放 list 菜单（网络配置、恢复出厂两个条目）。
- **观察什么：**① 点 tab 按钮和左右滑动都能切页吗；② 数据页的仪表盘在 tab 内布局是否挤，要不要缩小尺寸；③ 用 `lv_tabview_set_act(tv, 0, LV_ANIM_ON)` 从串口/按键触发切页回主页。

### 练习 10.2：危险操作二次确认

- **怎么做：**把示例 2 接进框架：点 list 的"恢复出厂"→ 弹模态 msgbox → 点"确定"串口打印恢复日志。再加一道：msgbox 弹出期间，试着点屏幕其他位置，观察模态是否阻止了点击穿透。
- **观察什么：**① 点"取消"和点"确定"分别走了哪个分支；② 把 `lv_msgbox_create` 的 parent 从 NULL 改成 `lv_scr_act()`，模态行为有何变化；③ 挑战：把设置页的 list 换成 `lv_menu` 重做一版，体会 menu 自动返回键的手感。

## 自测（答完再点答案）

### 随堂小测 1

Q1. 让 msgbox 变成"模态"（点外部不消失）的条件？
- A. 创建时 parent 参数传 NULL
- B. 按钮数组必须以空串结尾
- C. add_close_btn 参数必须传 false

<details>
<summary>查看答案</summary>

A。parent 为 NULL 即模态（PDF p.395）。B 是数组格式要求，C 只控制有没有关闭按钮。
</details>

Q2. 想在程序里把 tabview 切到第 3 个 tab，用哪个？
- A. lv_tabview_add_tab(tv, "新页")
- B. lv_tabview_set_act(tv, 2, LV_ANIM_ON)
- C. lv_tabview_get_tab_btns(tv)

<details>
<summary>查看答案</summary>

B。set_act 的 id 从 0 开始，第 3 个 tab 是 2（PDF p.427）。
</details>

Q3. menu 里"点条目自动打开子页"用什么函数？
- A. lv_menu_set_page(menu, page)
- B. lv_menu_set_sidebar_page(menu, page)
- C. lv_menu_set_load_page_event(menu, item, page)

<details>
<summary>查看答案</summary>

C。load_page_event 把"可点对象"和"目标页面"连起来（PDF p.455）。
</details>

Q4. span 组与 label 的核心区别是什么？
- A. span 组一段文字内可混排多种颜色和字体
- B. span 组能显示图片和动画
- C. span 组支持点击跳转链接

<details>
<summary>查看答案</summary>

A。span 是富文本片段，每个 span 独立样式（PDF p.404）；B、C 都不是 span 的能力。
</details>

## 推荐阅读

- 📖 正点原子《LVGL 开发指南 V1.5》第 31 章 list（PDF p.365）、第 33 章 msgbox（PDF p.395）、第 34 章 span（PDF p.404）、第 37 章 tabview（PDF p.425）、第 38 章 tileview（PDF p.433）、第 39 章 win（PDF p.440）、第 41 章 menu（PDF p.451）——本课全部依据
- 🌐 [LVGL 官方文档 tabview（v8.3）](https://docs.lvgl.io/8.3/widgets/tabview.html)——tab 位置四种方向与滚动的完整说明
- 🌐 [LVGL 官方文档 menu（v8.3）](https://docs.lvgl.io/8.3/widgets/menu.html)——官方示例里"多级菜单 + 自动返回"的完整代码

## 下一步

有卡住的地方随时问我（Agent 就是你的老师）。下一课预告：[第 11 课：图片与字库](/my-blog/posts/lvgl/0011-images-and-fonts/)——控件篇到此收官，接下来给界面换上"真皮"：图片、图标、自定义字库，让产品告别裸控件。

| [← 上一课](/my-blog/posts/lvgl/0009-input-widgets/) | [课程目录](/my-blog/posts/lvgl/00-总览/) | [下一课 →](/my-blog/posts/lvgl/0011-images-and-fonts/) |