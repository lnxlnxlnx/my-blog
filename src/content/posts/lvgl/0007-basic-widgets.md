---
title: 基础控件
published: 2026-08-23
description: 第 7 课：label / btn / btnmatrix / checkbox / switch——搭界面的五块"砖"，配合 Flex 拼出设置页雏形与主题选择器。
tags: [LVGL, 嵌入式, GUI, label, btn, btnmatrix, checkbox, switch]
category: LVGL
draft: false
prevTitle: 数据展示控件
prevSlug: "lvgl/0008-data-widgets"
nextTitle: Flex 与 Grid 布局
nextSlug: "lvgl/0006-flex-and-grid-layout"
---

# 基础控件

label / btn / btnmatrix / checkbox / switch —— 搭界面的五块"砖"，拼出设置页雏形。

**本课目标：**学完你能熟练创建五个最常用控件：label 玩转长文本与着色，btn 有按下反馈，btnmatrix 一行代码生成一排按钮并识别"按了谁"，checkbox 和 switch 会读写状态、响应事件。最后用第 6 课的 Flex 把它们拼成一个"设置页雏形"。

## 1. label：文本三兄弟 + 长模式 + 着色

label 是纯文本控件，但"文本往哪存"有三种讲究（PDF 18.2.1 (PDF p.249)）：

| 函数 | 内存 | 适用 |
|------|------|------|
| `lv_label_set_text()` | 动态分配（每次会重新分配） | 最常用，随便改 |
| `lv_label_set_text_fmt()` | 动态分配 | 带格式化，秒表/数值显示的神 |
| `lv_label_set_text_static()` | 直接用你的缓冲区，不拷贝 | 省内存，但缓冲区不能是局部变量 |

文本里放 `\n` 就是换行。文本过长时，先固定标签宽高，再选长模式（PDF 18.2.3 (PDF p.250)）：

```c
lv_obj_set_width(label, 180);                        /* 先限定宽度 */
lv_label_set_long_mode(label, LV_LABEL_LONG_SCROLL_CIRCULAR); /* 循环滚动 */
lv_obj_set_style_anim_time(label, 2000, 0);          /* 滚动一轮 2 秒 */
```

- `LV_LABEL_LONG_WRAP`（默认）：自动换行，高度不限就撑高
- `LV_LABEL_LONG_DOT`：末尾 3 个字变省略号 "…"
- `LV_LABEL_LONG_SCROLL`：来回滚动（到底弹回）
- `LV_LABEL_LONG_SCROLL_CIRCULAR`：循环滚动（转圈圈）
- `LV_LABEL_LONG_CLIP`：硬裁剪，多出来的看不见

给文本上色用"重着色"（PDF 18.2.4 (PDF p.250)），格式是 `#RRGGBB 文本#`，注意必须先 `lv_label_set_recolor(label, true)` 打开开关：

```c
lv_label_set_text(label, "温度 #ff0000 过高# 请检查");
lv_label_set_recolor(label, true);
```

## 2. btn：按钮的三个默认脾气 + 状态样式

`lv_btn_create(parent)` 就能建按钮（PDF 12.2 (PDF p.186)），它有三个默认脾气：

- 默认**不可滚动**（滚动条白搭）
- 默认**已加入默认组**（键盘/编码器可以直接操作它）
- 默认宽高是 `LV_SIZE_CONTENT`（包住内容），要撑开需手动 `lv_obj_set_size`

按钮按下的反馈靠"状态样式"：LVGL 在你按下时自动给按钮加 `LV_STATE_PRESSED` 状态，所以只要给这个状态配样式即可（第 3 课讲过状态样式，这里是实战）：

```c
lv_obj_t * btn = lv_btn_create(parent);

/* 常态：蓝色圆角 */
lv_obj_set_style_bg_color(btn, lv_palette_main(LV_PALETTE_BLUE), LV_PART_MAIN);
lv_obj_set_style_radius(btn, 8, LV_PART_MAIN);

/* 按下时：深蓝色，视觉"陷下去" */
lv_obj_set_style_bg_color(btn, lv_palette_darken(LV_PALETTE_BLUE, 3), LV_STATE_PRESSED);

/* 禁用时：灰色 */
lv_obj_set_style_bg_color(btn, lv_palette_grey(), LV_STATE_DISABLED);

lv_obj_add_state(btn, LV_STATE_DISABLED);   /* 用 add_state/clear_state 切换状态 */
```

禁用状态用 `lv_obj_add_state(btn, LV_STATE_DISABLED)` 加、`lv_obj_clear_state` 减——这是所有"可切换状态"控件的通用开关。

## 3. btnmatrix：一排按钮 + 一行配置

按钮矩阵（PDF 13.2 (PDF p.192)）用字符串数组"画"按钮：数组每个元素是一个按钮文本，`""` 结尾，`"\n"` 换行：

```c
static const char * map[] = { "1", "2", "3", "\n", "4", "5", "6", "" };

lv_obj_t * btnm = lv_btnmatrix_create(parent);
lv_btnmatrix_set_map(btnm, map);
lv_obj_set_size(btnm, 200, 120);
```

每个按钮有个索引（从 0 开始数），属性按索引设置（PDF 13.2.3~13.2.7 (PDF p.193)）：

- `lv_btnmatrix_set_btn_width(btnm, id, n)`：相对宽度，同行按份数分。比如一行 3 键宽度设 1、1、2，则各占 25%、25%、50%
- `lv_btnmatrix_set_btn_ctrl(btnm, id, CTRL)`：给某个键加属性——`LV_BTNMATRIX_CTRL_HIDDEN`（隐藏）、`LV_BTNMATRIX_CTRL_DISABLED`（禁用）、`LV_BTNMATRIX_CTRL_CHECKABLE`（可勾选）、`LV_BTNMATRIX_CTRL_RECOLOR`（允许着色）
- `lv_btnmatrix_set_one_checked(btnm, true)`：互斥——同一时刻只允许一个键处于选中，天然的单选组
- 重着色：map 里写 `"#FF0000 红键#"` 并给该键加 `RECOLOR` 属性

按了哪个键？事件是 `LV_EVENT_VALUE_CHANGED`，用 `lv_btnmatrix_get_selected_btn()` 拿索引（PDF 13.2.8 (PDF p.196)）。

## 4. checkbox：文本 + 状态 + 事件

复选框 = 小方框 + 文字（PDF 15.2 (PDF p.220)）。文本同样有动态/静态两版：`lv_checkbox_set_text()`（动态）和 `lv_checkbox_set_text_static()`（静态）。

状态就两种玩法，配合 `lv_obj_has_state` 读、`add/clear_state` 写：

```c
lv_obj_add_state(cb, LV_STATE_CHECKED);      /* 勾上 */
lv_obj_clear_state(cb, LV_STATE_CHECKED);    /* 取消 */
lv_obj_add_state(cb, LV_STATE_DISABLED);     /* 禁用（变灰不可点） */

/* 事件：被点击切换时触发，读当前状态 */
static void cb_event_cb(lv_event_t * e)
{
    lv_obj_t * cb = lv_event_get_target(e);
    if (lv_obj_has_state(cb, LV_STATE_CHECKED)) {
        LV_LOG_USER("已勾选");
    } else {
        LV_LOG_USER("已取消");
    }
}
```

## 5. switch：滑块开关，状态读写和 checkbox 一样

switch 就是手机上的滑块开关（PDF 22.2 (PDF p.281)），状态机制和 checkbox 完全同构——`LV_STATE_CHECKED` 表示"开"：

```c
lv_obj_t * sw = lv_switch_create(parent);

lv_obj_add_state(sw, LV_STATE_CHECKED);        /* 默认打开 */
bool on = lv_obj_has_state(sw, LV_STATE_CHECKED);  /* 读状态 */
/* 状态变化事件：LV_EVENT_VALUE_CHANGED */
```

部件结构上有 `LV_PART_INDICATOR`（开状态填充色）和 `LV_PART_KNOB`（滑块），想改颜色分别给这两个部件设样式就行。

> 💡 发现规律了吗？**checkbox 和 switch 的"状态 + 事件"玩法一模一样**（都是 CHECKED + VALUE_CHANGED），区别只在长相。记住一套，两个控件都会了。这也是 LVGL 控件族的通用模式。## 代码示例：设置页雏形（Flex + 全家桶）

把第 6 课的 Flex 和第 5 课的知识全用上，搭一个设置页（320×240 屏）：

```c
/* 事件回调：开关变化时更新提示 */
static void switch_event_cb(lv_event_t * e)
{
    lv_obj_t * sw = lv_event_get_target(e);
    LV_LOG_USER("Wi-Fi %s", lv_obj_has_state(sw, LV_STATE_CHECKED) ?
                "开启" : "关闭");
}

/* 工厂函数：造一行"标题 + 右侧控件"的 Flex 行 */
static lv_obj_t * setting_row_create(lv_obj_t * parent, const char * title)
{
    lv_obj_t * row = lv_obj_create(parent);
    lv_obj_set_size(row, LV_PCT(100), 44);
    lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(row, LV_FLEX_ALIGN_SPACE_BETWEEN,
                               LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_left(row, 12, 0);
    lv_obj_set_style_pad_right(row, 12, 0);

    lv_obj_t * lb = lv_label_create(row);
    lv_label_set_text(lb, title);
    return row;
}

void settings_page_create(void)
{
    /* 页面容器：纵向 Flex 排三行 */
    lv_obj_t * page = lv_obj_create(lv_scr_act());
    lv_obj_set_size(page, LV_PCT(100), LV_PCT(100));
    lv_obj_set_flex_flow(page, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_row(page, 10, 0);

    /* 标题：着色示例 */
    lv_obj_t * title = lv_label_create(page);
    lv_label_set_text(title, "#1f4e8c 设置#");
    lv_label_set_recolor(title, true);

    /* 行 1：Wi-Fi 开关（默认开） */
    lv_obj_t * row1 = setting_row_create(page, "Wi-Fi");
    lv_obj_t * sw = lv_switch_create(row1);
    lv_obj_add_state(sw, LV_STATE_CHECKED);
    lv_obj_add_event_cb(sw, switch_event_cb, LV_EVENT_VALUE_CHANGED, NULL);

    /* 行 2：自动更新 勾选 */
    lv_obj_t * row2 = setting_row_create(page, "自动更新");
    lv_obj_t * cb = lv_checkbox_create(row2);
    lv_checkbox_set_text(cb, "开启");

    /* 行 3：保存按钮（拉满整行） */
    lv_obj_t * row3 = setting_row_create(page, "");
    lv_obj_t * btn = lv_btn_create(row3);
    lv_obj_set_size(btn, LV_PCT(100), 40);
    lv_obj_t * btn_lb = lv_label_create(btn);
    lv_label_set_text(btn_lb, "保存设置");
    lv_obj_center(btn_lb);
}
```

## 代码示例：btnmatrix 主题选择器

```c
static void theme_event_cb(lv_event_t * e)
{
    lv_obj_t * btnm = lv_event_get_target(e);
    uint16_t id = lv_btnmatrix_get_selected_btn(btnm);   /* 哪个键被选中 */
    LV_LOG_USER("主题 %u 被选中", id);
}

void theme_selector_create(lv_obj_t * parent)
{
    static const char * map[] = { "浅色", "深色", "自动", "\n", "跟随系统", "" };
    lv_obj_t * btnm = lv_btnmatrix_create(parent);
    lv_btnmatrix_set_map(btnm, map);
    lv_obj_set_size(btnm, 220, 110);

    /* 全部按钮可勾选 + 互斥 = 单选组 */
    lv_btnmatrix_set_btn_ctrl_all(btnm, LV_BTNMATRIX_CTRL_CHECKABLE);
    lv_btnmatrix_set_one_checked(btnm, true);

    /* 最后一行那个键做宽一点（相对宽度 2 份） */
    lv_btnmatrix_set_btn_width(btnm, 3, 2);

    lv_obj_add_event_cb(btnm, theme_event_cb, LV_EVENT_VALUE_CHANGED, NULL);
}
```

> ⚠️ 三个坑：① map 数组**必须以 `""` 结尾**，否则解析越界；② `\n` 是"换行分隔符"，它的前后元素分别属于上下两行，不要给 `\n` 本身设宽度/属性；③ checkbox/switch 用 `lv_checkbox_set_text` 动态文本频繁改文案会反复分配内存，固定文案优先 `_static` 版本。

## 动手练习（约 25 分钟）

### 练习 7.1：设置页雏形（真机）

- 1️⃣ 把"代码示例：设置页雏形"完整搬进工程编译烧录：标题着蓝色，三行设置项排列整齐。
- 2️⃣ 给 Wi-Fi 开关加一个"状态提示 label"（比如开关下方一行小字），在回调里用 `lv_obj_has_state` 更新成"已连接 / 未连接"。勾选框和保存按钮各接一个事件回调，分别打印日志。
- 3️⃣ 观察：把页面容器的高度改成 200（小于 240 屏高），设置页会怎样？Flex COLUMN 不换列时多余的子对象去哪了？（提示：滚动条）

### 练习 7.2：玩转 btnmatrix（真机）

- 1️⃣ 搭主题选择器（代码示例 2），点四个键确认：同一时刻只能选中一个（互斥），松开后状态保持。
- 2️⃣ 把 map 改成 `{"#ff0000 红#", "绿", "\n", "蓝", ""}`，给 0 号键加 `LV_BTNMATRIX_CTRL_RECOLOR`，看"红"变红；再给 3 号键加 `LV_BTNMATRIX_CTRL_DISABLED`，点它没反应且变灰。
- 3️⃣ 挑战：让主题选择器真正生效——在回调里根据 `get_selected_btn` 的返回值，把页面背景 `lv_obj_set_style_bg_color(lv_scr_act(), 颜色, 0)` 切换成浅色/深色。

## 自测（答完再点答案）

### 随堂小测 1

Q1. 想让过长的 label 文本"末尾变省略号"，设哪个长模式？
- A. LV_LABEL_LONG_DOT
- B. LV_LABEL_LONG_CLIP
- C. LV_LABEL_LONG_WRAP

<details>
<summary>查看答案</summary>

A。DOT 把末尾 3 个字换成省略号；CLIP 是硬裁剪，WRAP 是自动换行（PDF p.250）。
</details>

Q2. btnmatrix 的 map 数组最后一个元素必须是？
- A. "\n" 换行符
- B. "" 空字符串
- C. "0" 数字零

<details>
<summary>查看答案</summary>

B。数组以空字符串结尾作为结束标志（PDF p.192）。
</details>

Q3. 读取 switch 当前是开还是关，用什么函数？
- A. lv_switch_get_value(sw)
- B. lv_obj_has_state(sw, LV_STATE_CHECKED)
- C. lv_switch_is_on(sw)

<details>
<summary>查看答案</summary>

B。switch 没有专属 get 函数，统一用 lv_obj_has_state 查 CHECKED 状态（PDF p.281）。
</details>

Q4. 想让 btnmatrix 成为"单选组"，需要哪两个配置？
- A. 全部 CHECKABLE 且 set_one_checked(true)
- B. 全部 DISABLED 且 set_btn_width(2)
- C. 全部 HIDDEN 且 set_one_checked(false)

<details>
<summary>查看答案</summary>

A。按钮可勾选 + 互斥开启，同一时刻只选中一个（PDF p.195）。
</details>

## 推荐阅读

- 📖 正点原子《LVGL 开发指南 V1.5》第十二章（btn，PDF p.186）、第十三章（btnmatrix，PDF p.192）、第十五章（checkbox，PDF p.220）、第十八章（label，PDF p.249）、第二十二章（switch，PDF p.281）——本课全部依据
- 🌐 [LVGL 官方文档 Label（v8.3）](https://docs.lvgl.io/8.3/widgets/label.html)——Long modes 一节有滚动/裁剪演示
- 🌐 [LVGL 官方文档 Button matrix（v8.3）](https://docs.lvgl.io/8.3/widgets/btnmatrix.html)——Buttons control 一节讲全 8 种 CTRL

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 8 课：数据展示控件——bar、slider、arc、meter、chart、led，开始做仪表盘和波形。

| [← 上一课](/my-blog/posts/lvgl/0006-flex-and-grid-layout/) | [课程目录](/my-blog/posts/lvgl/00-总览/) | [下一课 →](/my-blog/posts/lvgl/0008-data-widgets/) |