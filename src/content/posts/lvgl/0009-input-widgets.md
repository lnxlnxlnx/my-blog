---
title: 输入控件
published: 2026-08-25
description: 第 9 课：dropdown / roller / textarea / keyboard / spinbox——让用户把参数"告诉"设备，搭出参数配置表单与软键盘输入。
tags: [LVGL, 嵌入式, GUI, dropdown, roller, textarea, keyboard, spinbox]
category: LVGL
draft: false
prevTitle: 容器与导航
prevSlug: "lvgl/0010-containers-and-navigation"
nextTitle: 数据展示控件
nextSlug: "lvgl/0008-data-widgets"
---

# 输入控件

dropdown / roller / textarea / keyboard / spinbox —— 让用户把参数"告诉"设备。

**本课目标：**上一课是设备单向"展示"，本课反过来：让用户把参数输进去。下拉选参数、滚轮选档位、微调器细调、文本框 + 软键盘输入——一台设备"设置页"的半壁江山都在这里。学完你能独立搭出一个完整的参数配置表单，这也是第 12 课综合项目的核心素材。

## 1. dropdown：省空间的单选器

dropdown（下拉列表）平时只显示一行，点开才展开选项，在 320×240 的小屏上特别省地方（第 16 章 (PDF p.227)）。核心 API：

```c
lv_obj_t *dd = lv_dropdown_create(lv_scr_act());
/* 选项用换行符 \n 分隔，一次全给 */
lv_dropdown_set_options(dd, "波特率 9600\n波特率 19200\n波特率 115200");
lv_dropdown_set_selected(dd, 0);          /* 默认选中第 0 项 */

/* 也可以一条条加：lv_dropdown_add_option(dd, "新选项", 位置); */
```

选中后要拿到"用户到底选了啥"，在 `LV_EVENT_VALUE_CHANGED` 回调里读（第 16.2.2 节 (PDF p.229)）：

```c
static void dd_cb(lv_event_t *e)
{
    lv_obj_t *dd = lv_event_get_target(e);
    uint16_t idx = lv_dropdown_get_selected(dd);       /* 索引，从 0 开始 */
    char buf[32];
    lv_dropdown_get_selected_str(dd, buf, sizeof(buf)); /* 选项文本 */
    printf("选了第 %d 项：%s\n", (int)idx, buf);
}
```

三个常用修饰：`lv_dropdown_set_dir(dd, LV_DIR_UP)` 改展开方向（默认往下，屏幕底部时往上弹）；`lv_dropdown_set_symbol(dd, LV_SYMBOL_RIGHT)` 换箭头图标；`lv_dropdown_set_text(dd, "常显文本")` 固定头部文字，不再跟随选中项变化（第 16.2.3~16.2.5 节 (PDF p.229)）。

## 2. roller：一排滚过去的选项

roller（滚轮）比 dropdown 更"机械感"，像老式收音机的调频滚轮，一次能看到好几个选项（第 20 章 (PDF p.264)）：

```c
static const char *opts = "档位 1\n档位 2\n档位 3\n档位 4\n档位 5";

lv_obj_t *roller = lv_roller_create(lv_scr_act());
lv_roller_set_options(roller, opts, LV_ROLLER_MODE_NORMAL);  /* NORMAL 到头停住 */
lv_roller_set_visible_row_count(roller, 3);   /* 可见 3 行，上下各露出一半 */
lv_roller_set_selected(roller, 2, LV_ANIM_ON);

/* 读取：lv_roller_get_selected(roller) 拿索引 */
/* 循环滚动用 LV_ROLLER_MODE_INFINITE：滚过最后一个回到第一个 */
```

读选中的方式与 dropdown 一致：`lv_roller_get_selected` 拿索引、`lv_roller_get_selected_str` 拿文本，同样在 `LV_EVENT_VALUE_CHANGED` 里触发（第 20.2.2 节 (PDF p.265)）。

## 3. textarea：单行变多行，限制全靠两个函数

textarea 就是文本框，配上键盘就是"输入框"。创建后最常用的五个设置（第 24 章 (PDF p.295)）：

```c
lv_obj_t *ta = lv_textarea_create(lv_scr_act());
lv_textarea_set_placeholder_text(ta, "请输入设备名称");   /* 占位符，没内容时显示 */
lv_textarea_set_one_line(ta, true);                       /* 单行模式，超长横滚 */
lv_textarea_set_password_mode(ta, true);                  /* 密码模式：显示为 * */
lv_textarea_set_max_length(ta, 16);                       /* 限长：最多 16 字符 */
lv_textarea_set_accepted_chars(ta, "0123456789");         /* 限字符：只收数字 */
```

- 密码模式的"*"只是显示层，`lv_textarea_get_text` 拿到的仍是原文；原始文本会先闪一下再隐藏，时长由 `LV_TEXTAREA_DEF_PWD_SHOW_TIME` 控制（第 24.2.5 节 (PDF p.297)）
- 光标：`lv_textarea_set_cursor_pos(ta, pos)` 直接定位（0 是开头，`LV_TA_CURSOR_LAST` 是末尾），方向键式微调用 `lv_textarea_cursor_left/right`（第 24.2.4 节 (PDF p.297)）

## 4. keyboard：屏幕上的软键盘

keyboard 本质是特殊的按钮矩阵。创建后**必须做一件事**：用 `lv_keyboard_set_textarea` 把键盘和某个 textarea 绑起来，否则按了白按（第 29.2.2 节 (PDF p.349)）：

```c
lv_obj_t *kb = lv_keyboard_create(lv_scr_act());
lv_obj_t *ta = lv_textarea_create(lv_scr_act());
lv_obj_set_width(ta, 300);
lv_obj_align(ta, LV_ALIGN_TOP_MID, 0, 10);
lv_textarea_set_placeholder_text(ta, "点击下方键盘输入...");

/* 绑定：键盘输入直接写进 textarea */
lv_keyboard_set_textarea(kb, ta);
lv_keyboard_set_mode(kb, LV_KEYBOARD_MODE_TEXT_LOWER); /* 默认就是小写 */

/* 想要输入数字时切数字键盘 */
lv_keyboard_set_mode(kb, LV_KEYBOARD_MODE_NUMBER);
```

四种内置模式：`LV_KEYBOARD_MODE_TEXT_LOWER`（小写）、`TEXT_UPPER`（大写）、`TEXT_SPECIAL`（特殊字符）、`NUMBER`（数字盘），键盘自己带切换键（第 29.2.1 节 (PDF p.349)）。常用事件：

- `LV_EVENT_VALUE_CHANGED`——每按一个键都触发，可配合 `lv_btnmatrix_get_selected_btn / lv_btnmatrix_get_btn_text` 判断按了哪个键（第 29.4.2.2 节 (PDF p.354)）
- `LV_EVENT_READY`——按了 Enter/OK 键，适合做"输入完成"的收尾动作
- `lv_keyboard_set_popovers(kb, true)`——按键时放大显示字符，指头粗也能看清（第 29.2.3 节 (PDF p.350)）

## 5. spinbox：带步进的数字微调器

spinbox 专门调数字，左右两侧有 +/- 键（第 35 章 (PDF p.412)）。三个要点：

```c
lv_obj_t *sp = lv_spinbox_create(lv_scr_act());
lv_spinbox_set_digit_format(sp, 5, 2);   /* 总位数 5，小数点前 2 位：显示 00.000 */
lv_spinbox_set_range(sp, 0, 999);        /* 数值范围 */
lv_spinbox_set_step(sp, 10);             /* 步进：按一次 +/- 跳 10 */

lv_spinbox_set_value(sp, 55);            /* 设当前值（小数点被忽略，5 位显示 00.055） */
lv_spinbox_increment(sp);                /* 手动 + 一步 */
lv_spinbox_decrement(sp);                /* 手动 - 一步 */

/* 翻转模式：到上限继续 + 会翻回下限，防止死锁在边界 */
lv_spinbox_set_rollover(sp, true);
```

- 注意：**小数点只是"装饰"**，显示 55.211 时 `lv_spinbox_get_value` 拿到的整数是 55211——做真小数要么自己换算，要么把范围放大 1000 倍（第 35.2.1 节 (PDF p.413)）
- `lv_spinbox_set_pos(sp, pos)` 决定当前光标控制哪一位数（个位还是十位），配合 `lv_spinbox_step_next / step_prev` 可以做出"逐位调整"的精度模式（第 35.3 节 (PDF p.413)）

> 💡 选型口诀：**省空间选 dropdown，要手感选 roller，调数字选 spinbox，自由输入选 textarea + keyboard**。设置页的"参数类型"决定控件选择——枚举用下拉，档位用滚轮，数值用微调器，文本用键盘。## 代码示例 1：参数配置表单（四件套联动）

下拉选参数类型 + 滚轮选档位 + spinbox 微调 + 一个"汇总"标签实时拼出当前配置——这就是练习 9.1 的骨架：

```c
static lv_obj_t *summary_label, *spinbox, *roller, *dropdown;

static void param_changed_cb(lv_event_t *e)
{
    LV_UNUSED(e);
    char opt_buf[24], gear_buf[16];
    lv_dropdown_get_selected_str(dropdown, opt_buf, sizeof(opt_buf));
    lv_roller_get_selected_str(roller, gear_buf, sizeof(gear_buf));
    lv_label_set_text_fmt(summary_label, "%s | %s | 数值 %d",
                          opt_buf, gear_buf, (int)lv_spinbox_get_value(spinbox));
}

void lvgl_demo_form(void)
{
    /* 下拉：参数类型 */
    dropdown = lv_dropdown_create(lv_scr_act());
    lv_dropdown_set_options(dropdown, "温度\n湿度\n压力\n风速");
    lv_obj_set_width(dropdown, 150);
    lv_obj_align(dropdown, LV_ALIGN_TOP_LEFT, 20, 30);
    lv_obj_add_event_cb(dropdown, param_changed_cb, LV_EVENT_VALUE_CHANGED, NULL);

    /* 滚轮：档位 */
    roller = lv_roller_create(lv_scr_act());
    lv_roller_set_options(roller, "档位 1\n档位 2\n档位 3\n档位 4", LV_ROLLER_MODE_NORMAL);
    lv_roller_set_visible_row_count(roller, 3);
    lv_obj_align(roller, LV_ALIGN_TOP_RIGHT, -30, 30);
    lv_obj_add_event_cb(roller, param_changed_cb, LV_EVENT_VALUE_CHANGED, NULL);

    /* 微调器：数值 */
    spinbox = lv_spinbox_create(lv_scr_act());
    lv_spinbox_set_digit_format(spinbox, 3, 0);
    lv_spinbox_set_range(spinbox, 0, 999);
    lv_spinbox_set_step(spinbox, 1);
    lv_spinbox_set_rollover(spinbox, true);
    lv_obj_align(spinbox, LV_ALIGN_TOP_MID, 0, 150);
    lv_obj_add_event_cb(spinbox, param_changed_cb, LV_EVENT_VALUE_CHANGED, NULL);

    /* 汇总标签 */
    summary_label = lv_label_create(lv_scr_act());
    lv_label_set_text(summary_label, "请选择参数");
    lv_obj_align(summary_label, LV_ALIGN_BOTTOM_MID, 0, -20);
}
```

## 代码示例 2：textarea + keyboard 弹键盘输入

输入设备名，按 Enter 收尾打印——设置页"命名"场景的标准套路：

```c
static void kb_ready_cb(lv_event_t *e)
{
    lv_obj_t *kb = lv_event_get_target(e);
    lv_obj_t *ta = lv_keyboard_get_textarea(kb);
    printf("输入完成：%s\n", lv_textarea_get_text(ta));
}

void lvgl_demo_name_input(void)
{
    /* 文本框 */
    lv_obj_t *ta = lv_textarea_create(lv_scr_act());
    lv_obj_set_width(ta, 300);
    lv_obj_align(ta, LV_ALIGN_TOP_MID, 0, 20);
    lv_textarea_set_placeholder_text(ta, "请输入设备名称");
    lv_textarea_set_one_line(ta, true);
    lv_textarea_set_max_length(ta, 16);

    /* 键盘：绑定文本框，屏幕底部自动排布 */
    lv_obj_t *kb = lv_keyboard_create(lv_scr_act());
    lv_keyboard_set_textarea(kb, ta);
    lv_keyboard_set_popovers(kb, true);
    lv_obj_add_event_cb(kb, kb_ready_cb, LV_EVENT_READY, NULL);
}
```

> ⚠️ **踩坑预警**：① keyboard 不 `lv_keyboard_set_textarea`，按任何键都没反应——这是 90% 新手的第一坑；② textarea 默认是多行自动换行，做"一行输入"务必 `lv_textarea_set_one_line(ta, true)`，否则键盘 Enter 会插换行而不是触发 READY；③ spinbox 的 `lv_spinbox_set_value` 受位数格式影响，先 set_digit_format 再 set_value，顺序反了显示会错位。

## 动手练习（约 40 分钟）

### 练习 9.1：搭一个"参数配置表单"

- **怎么做：**新建 `BSP/lvgl_form.c`，照示例 1 搭 dropdown（参数类型）+ roller（档位）+ spinbox（数值），再加 textarea + keyboard（备注输入，绑定后弹键盘）。四个控件的值变化都刷新同一个"汇总"label。
- **观察什么：**① 滚轮滚到底再滚会发生什么（NORMAL 模式到头停住）；② 把 roller 换成 INFINITE 模式对比手感；③ 键盘按 Enter 后串口是否打印出 textarea 原文；④ 密码模式开着输一段，看 `lv_textarea_get_text` 拿到的还是不是原文。

### 练习 9.2：输入限制与模式切换

- **怎么做：**在示例 2 上改造：① textarea 加 `lv_textarea_set_accepted_chars(ta, "0123456789ABCDEF")`，试试输入 G 和 g 会发生什么；② 监听键盘的 `LV_EVENT_VALUE_CHANGED`，用 `lv_btnmatrix_get_btn_text` 判断按的是不是 `LV_SYMBOL_KEYBOARD`，是则切换 `LV_KEYBOARD_MODE_NUMBER` / `LV_KEYBOARD_MODE_TEXT_LOWER`。
- **观察什么：**① 被拒的字符是完全不显示，还是先显示再消失（对照 `LV_TEXTAREA_DEF_PWD_SHOW_TIME` 的行为）；② 模式切换后键盘布局是否立即变化；③ spinbox 把 rollover 开/关各试一次，到边界时 +/- 的行为差异。

## 自测（答完再点答案）

### 随堂小测 1

Q1. dropdown 的多个选项之间用什么分隔？
- A. 用逗号分隔，如"a, b, c"
- B. 用换行符分隔，如"a\nb\nc"
- C. 用分号分隔，如"a; b; c"

<details>
<summary>查看答案</summary>

B。lv_dropdown_set_options 的选项字符串用 \n 分隔（PDF p.227）。
</details>

Q2. 文本框只允许输入数字，用哪个函数？
- A. lv_textarea_set_accepted_chars(ta, "0123456789")
- B. lv_textarea_set_max_length(ta, 10)
- C. lv_textarea_set_one_line(ta, true)

<details>
<summary>查看答案</summary>

A。accepted_chars 限制字符类型，max_length 只限长度（PDF p.297）。
</details>

Q3. 键盘按下按键却输入不进文本框，最可能原因？
- A. 键盘模式设成了 NUMBER 数字键盘
- B. 没调用 lv_keyboard_set_textarea 绑定文本框
- C. 文本框设置了最大长度且已写满

<details>
<summary>查看答案</summary>

B。不绑定 textarea，键盘就是"哑的"（PDF p.349）。
</details>

Q4. spinbox 显示"55.211"时，get_value 返回多少？
- A. 55.211（浮点数，含小数点）
- B. 55211（整数，小数点被忽略）
- C. 55（只取小数点前的部分）

<details>
<summary>查看答案</summary>

B。小数点是"装饰"，真实数值是整数 55211（PDF p.413）。
</details>

## 推荐阅读

- 📖 正点原子《LVGL 开发指南 V1.5》第 16 章 dropdown（PDF p.227）、第 20 章 roller（PDF p.264）、第 24 章 textarea（PDF p.295）、第 29 章 keyboard（PDF p.349）、第 35 章 spinbox（PDF p.412）——本课全部依据
- 🌐 [LVGL 官方文档 textarea（v8.3）](https://docs.lvgl.io/8.3/widgets/textarea.html)——光标控制与事件的完整细节
- 🌐 [LVGL 官方文档 keyboard（v8.3）](https://docs.lvgl.io/8.3/widgets/keyboard.html)——内置按键映射与 READY/CANCEL 事件说明

## 下一步

有卡住的地方随时问我（Agent 就是你的老师）。下一课预告：[第 10 课：容器与导航](/my-blog/posts/lvgl/0010-containers-and-navigation/)——单页控件学完了，下一课把它们组织成"多页面产品"：tab 页、菜单、弹窗、窗口全上场。

| [← 上一课](/my-blog/posts/lvgl/0008-data-widgets/) | [课程目录](/my-blog/posts/lvgl/00-总览/) | [下一课 →](/my-blog/posts/lvgl/0010-containers-and-navigation/) |