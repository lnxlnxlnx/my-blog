---
title: 数据展示控件
published: 2026-08-24
description: 第 8 课：bar / slider / arc / led / chart / meter——把裸数值变成进度条、旋钮弧、波形和速度表，让数据"看得见"。
tags: [LVGL, 嵌入式, GUI, bar, slider, arc, meter, chart, led]
category: LVGL
draft: false
prevTitle: 输入控件
prevSlug: "lvgl/0009-input-widgets"
nextTitle: 基础控件
nextSlug: "lvgl/0007-basic-widgets"
---

# 数据展示控件

bar / slider / arc / led / chart / meter —— 让数据"看得见"。

**本课目标：**上一课学的是按钮、标签这些"砖块"，本课全是"仪表盘家族"——把裸数值变成进度条、旋钮弧、波形和速度表。学完这套"数据 → 图形"的心法，传感器读数、ADC 采样、剩余电量都能直接画上屏幕，还自带动画和触摸。这是你产品界面里"数据页"的全部底子。

## 1. bar：把数值变成一段进度

bar（进度条）是数据展示的地基。创建之后两件事必做：**设范围、设值**。默认范围是 0~100，两个 API 记住就够用（PDF 第 11.2.2 节 (PDF p.178)）：

```c
lv_obj_t *bar = lv_bar_create(lv_scr_act());
lv_bar_set_range(bar, 0, 100);              /* 范围 */
lv_bar_set_value(bar, 80, LV_ANIM_ON);      /* 当前值，可带动画 */

/* 想让填充动起来，先设动画时间（必须在 set_value 之前！） */
lv_obj_set_style_anim_time(bar, 800, LV_STATE_DEFAULT);
```

- **方向**：bar 不设方向属性，方向由宽高决定——宽度大于高度是水平，反之是垂直（第 11.2.1 节 (PDF p.178)）
- **模式**：默认 `LV_BAR_MODE_NORMAL` 从左填起；`LV_BAR_MODE_SYMMETRICAL` 让范围支持负数，始终从 0 往两边画；`LV_BAR_MODE_RANGE` 允许设起始值（第 11.2.3 节 (PDF p.179)）

## 2. slider：能拖的 bar，人机交互的第一步

slider 就是加了"旋钮"的 bar，用户能直接拖。范围、值、动画的用法和 bar 几乎一样（第 21 章 (PDF p.274)）：

```c
lv_obj_t *slider = lv_slider_create(lv_scr_act());
lv_slider_set_range(slider, 0, 255);
lv_slider_set_value(slider, 128, LV_ANIM_OFF);
lv_obj_set_size(slider, 220, 20);
lv_obj_center(slider);

/* 拖动时读值：LV_EVENT_VALUE_CHANGED 回调里取 */
lv_obj_add_event_cb(slider, slider_cb, LV_EVENT_VALUE_CHANGED, NULL);
```

回调里用 `lv_slider_get_value(slider)` 拿当前值（第 21.3 节 (PDF p.276)）。两个常用技巧：

- 模式 `LV_SLIDER_MODE_SYMMETRICAL`：范围可负，指示器从 0 画到当前值；`LV_SLIDER_MODE_RANGE`：配合 `lv_bar_set_start_value` 设起始值（第 21.2.2 节 (PDF p.275)）
- 禁用"单击跳变"（点哪跳哪，容易误触）：`lv_obj_add_flag(slider, LV_OBJ_FLAG_ADV_HITTEST)`，之后只能拖动（第 21.2.3 节 (PDF p.276)）

## 3. arc：旋钮弧 + led：状态灯

arc（圆弧）像"环形进度条"，值、范围、动画思路同 bar。多出来的是**角度**——注意角度划分：0° 在 3 点钟方向，顺时针增大到 360°（第 10.2.2 节 (PDF p.167)）。常用 API：

```c
lv_obj_t *arc = lv_arc_create(lv_scr_act());
lv_arc_set_range(arc, 0, 100);
lv_arc_set_value(arc, 60);
lv_arc_set_bg_angles(arc, 135, 45);   /* 背景弧起止角（可画成"仪表"样） */
lv_arc_set_angles(arc, 135, 300);     /* 前景弧起止角 */
lv_arc_set_rotation(arc, 0);          /* 整体旋转 */
lv_arc_set_mode(arc, LV_ARC_MODE_NORMAL);  /* NORMAL/REVERSE/SYMMETRIC */
```

关键坑：前景弧角度范围**不能超出背景弧**，否则显示异常（第 10.2.2 节 (PDF p.168)）。当你要把 arc 当"只读进度环"时，旋钮必须拆掉（第 10.2.6 节 (PDF p.170)）：

```c
lv_obj_remove_style(arc, NULL, LV_PART_KNOB);    /* 移除旋钮 */
lv_obj_clear_flag(arc, LV_OBJ_FLAG_CLICKABLE);   /* 不许再拖 */
```

led 是最省心的"状态灯"：一个圆点，API 就五个（第 30 章 (PDF p.357)）。`lv_led_set_color` 改主体色（默认蓝）、`lv_led_set_brightness` 调亮度 0~255、`lv_led_on/off/toggle` 开关——开就是亮度拉到 255，关就是压到最低。

## 4. chart：实时波形，仪器仪表的灵魂

chart 做"示波器"是最经典场景。三步走（第 26.2.1 节 (PDF p.319)）：建图 → 加系列 → 喂数据。系列（series）就是一条线/一组柱，一个图可以多条：

```c
lv_obj_t *chart = lv_chart_create(lv_scr_act());
lv_chart_set_type(chart, LV_CHART_TYPE_LINE);          /* 折线 / BAR 柱状 */
lv_chart_set_point_count(chart, 40);                   /* 默认只有 10 个点 */

lv_chart_series_t *ser = lv_chart_add_series(chart,
                            lv_palette_main(LV_PALETTE_RED),
                            LV_CHART_AXIS_PRIMARY_Y);   /* 加到左轴 */

/* 实时喂数据：SHIFT 旧数据左移，新数据进右边；CIRCULAR 像心电图循环 */
lv_chart_set_update_mode(chart, LV_CHART_UPDATE_MODE_CIRCULAR);
lv_chart_set_next_value(chart, ser, 66);
lv_chart_refresh(chart);        /* 每次改完数据都要刷新 */
```

用 `lv_timer_create` 每 200ms 喂一次，波形就"活"了（第 26.2.1 节 (PDF p.321)）。垂直范围可用 `lv_chart_set_range(chart, LV_CHART_AXIS_PRIMARY_Y, 0, 100)` 限制（第 26.2.2 节 (PDF p.324)）。

## 5. meter：一块真正的仪表盘

meter 自带刻度、指针、弧线，是"速度表/温度表"的终极形态。组装顺序固定：先加刻度，再配指针，最后设角度范围（第 32.2.1 节 (PDF p.373)）：

```c
lv_obj_t *meter = lv_meter_create(lv_scr_act());
lv_obj_set_size(meter, 180, 180);
lv_obj_center(meter);

/* ① 加刻度，拿到刻度句柄 */
lv_meter_scale_t *scale = lv_meter_add_scale(meter);
lv_meter_set_scale_ticks(meter, scale, 41, 1, 4, lv_palette_main(LV_PALETTE_GREY));       /* 小刻度 */
lv_meter_set_scale_major_ticks(meter, scale, 8, 2, 8, lv_color_black(), 10);              /* 主刻度 */

/* ② 数值范围 + 角度范围 + 起始旋转（默认 270° 从 3 点钟起） */
lv_meter_set_scale_range(meter, scale, 0, 120, 270, 135);

/* ③ 加指针（线型），r_mod 控制指针比刻度短多少 */
lv_meter_indicator_t *needle = lv_meter_add_needle_line(meter, scale, 3,
                                    lv_palette_main(LV_PALETTE_RED), -10);
lv_meter_set_indicator_value(meter, needle, 60);    /* 指针指到 60 */
```

指针之外还有两种指示器：`lv_meter_add_arc` 加弧线（像表盘上的彩色区间），`lv_meter_add_scale_lines` 加刻度线高亮区——配合 `lv_meter_set_indicator_start_value / end_value` 用（第 32.3 节 (PDF p.386)）。

> 💡 记忆口诀：**bar 是"躺着的量"，slider 是"能拖的 bar"，arc 是"弯成圈的 bar"，led 是"一像素状态"，chart 是"多条量一起画"，meter 是"bar 全家桶"**。核心 API 全是 set_range + set_value，一通百通。## 代码示例 1：设备仪表盘（四件套合体）

把 meter 速度表 + bar 电量 + led 状态灯装进一个屏幕，用 lv_timer 模拟数据变化——这就是你练习 8.1 的骨架：

```c
static lv_obj_t *meter, *needle, *batt_bar, *status_led;
static int16_t speed_val;

static void dash_timer_cb(lv_timer_t *t)
{
    LV_UNUSED(t);
    /* 模拟传感器读数：速度 0~120，电量 0~100 */
    speed_val = lv_rand(20, 120);
    lv_meter_set_indicator_value(meter, needle, speed_val);
    lv_bar_set_value(batt_bar, lv_rand(30, 100), LV_ANIM_ON);

    /* 速度超过 100 亮红灯，否则绿灯 */
    if (speed_val > 100) {
        lv_led_set_color(status_led, lv_palette_main(LV_PALETTE_RED));
        lv_led_on(status_led);
    } else {
        lv_led_set_color(status_led, lv_palette_main(LV_PALETTE_GREEN));
        lv_led_on(status_led);
    }
}

void lvgl_demo_dashboard(void)
{
    /* 左侧：速度表 */
    meter = lv_meter_create(lv_scr_act());
    lv_obj_set_size(meter, 170, 170);
    lv_obj_align(meter, LV_ALIGN_TOP_LEFT, 10, 10);
    lv_meter_scale_t *scale = lv_meter_add_scale(meter);
    lv_meter_set_scale_ticks(meter, scale, 41, 1, 4, lv_palette_main(LV_PALETTE_GREY));
    lv_meter_set_scale_major_ticks(meter, scale, 8, 2, 8, lv_color_black(), 10);
    lv_meter_set_scale_range(meter, scale, 0, 120, 270, 135);
    needle = lv_meter_add_needle_line(meter, scale, 3,
                                      lv_palette_main(LV_PALETTE_RED), -10);

    /* 右侧：电量 bar + 状态灯 */
    batt_bar = lv_bar_create(lv_scr_act());
    lv_obj_set_size(batt_bar, 110, 18);
    lv_obj_align(batt_bar, LV_ALIGN_TOP_RIGHT, -10, 30);
    lv_bar_set_range(batt_bar, 0, 100);
    lv_bar_set_value(batt_bar, 80, LV_ANIM_OFF);

    status_led = lv_led_create(lv_scr_act());
    lv_obj_align(status_led, LV_ALIGN_TOP_RIGHT, -30, 80);
    lv_led_set_color(status_led, lv_palette_main(LV_PALETTE_GREEN));

    /* 每 200ms 模拟一次读数 */
    lv_timer_create(dash_timer_cb, 200, NULL);
}
```

## 代码示例 2：chart 实时波形 + slider 调速

波形 + 一个能拖的 slider——slider 的值决定波形"频率"（喂数据的时间间隔），这是数据页最常见的联动模式：

```c
static lv_obj_t *wave_chart;
static lv_chart_series_t *ser;
static lv_timer_t *wave_timer;

static void wave_feed_cb(lv_timer_t *t)
{
    LV_UNUSED(t);
    lv_chart_set_next_value(wave_chart, ser, lv_rand(30, 90));
    lv_chart_refresh(wave_chart);
}

static void speed_cb(lv_event_t *e)
{
    lv_obj_t *slider = lv_event_get_target(e);
    /* 值越大，喂数越快：把定时器周期改成 300 - 值 */
    lv_timer_set_period(wave_timer, 300 - lv_slider_get_value(slider));
}

void lvgl_demo_wave(void)
{
    /* 波形图 */
    wave_chart = lv_chart_create(lv_scr_act());
    lv_obj_set_size(wave_chart, 300, 130);
    lv_obj_align(wave_chart, LV_ALIGN_TOP_MID, 0, 10);
    lv_chart_set_type(wave_chart, LV_CHART_TYPE_LINE);
    lv_chart_set_point_count(wave_chart, 50);
    lv_chart_set_update_mode(wave_chart, LV_CHART_UPDATE_MODE_CIRCULAR);
    ser = lv_chart_add_series(wave_chart, lv_palette_main(LV_PALETTE_BLUE),
                              LV_CHART_AXIS_PRIMARY_Y);
    wave_timer = lv_timer_create(wave_feed_cb, 200, NULL);

    /* 调速滑块 */
    lv_obj_t *slider = lv_slider_create(lv_scr_act());
    lv_obj_set_size(slider, 280, 18);
    lv_obj_align(slider, LV_ALIGN_BOTTOM_MID, 0, -30);
    lv_slider_set_range(slider, 0, 200);
    lv_slider_set_value(slider, 100, LV_ANIM_OFF);
    lv_obj_add_event_cb(slider, speed_cb, LV_EVENT_VALUE_CHANGED, NULL);
}
```

> ⚠️ **两个真机常踩的坑**：① `lv_chart_set_next_value` 后忘了 `lv_chart_refresh`，波形"半天不动"；② 320×240 屏上别一次堆太多仪表——每个 meter/chart 都是带缓冲的控件，堆多了 `LV_MEM_SIZE` 池子会告急（串口报 out of memory），一次画面放 1~2 个仪表 + 1 个波形正合适。

## 动手练习（约 40 分钟）

### 练习 8.1：搭一个"设备仪表盘"

- **怎么做：**新建 `BSP/lvgl_dash.c`，照代码示例 1 搭 meter 速度表 + bar 电量 + led 状态灯，用 lv_timer 每 200ms 模拟一组读数（lv_rand 生成），加一个 label 实时显示当前速度数字。
- **观察什么：**① 指针和电量条的动画是否顺滑；② 速度超阈值时 led 变色是否灵敏；③ 把 lv_timer 周期改成 50ms，画面会不会卡——对比"喂数频率"和"LVGL 刷新周期"的关系。

### 练习 8.2：给仪表盘加交互

- **怎么做：**在示例 2 基础上加一个 arc（0~100，环形进度）：slider 拖动时，arc 的值跟着变（`lv_arc_set_value`），并去掉 arc 的旋钮让它看起来像"进度环"。
- **观察什么：**① 把 chart 的更新模式在 SHIFT 和 CIRCULAR 之间切换，波形滚动方式有何不同（SHIFT 旧数据整体左移，CIRCULAR 循环覆盖）；② 试试把 arc 前景角度设得比背景弧大，会发生什么——这正是第 10.2.2 节警告的"显示异常"。

## 自测（答完再点答案）

### 随堂小测 1

Q1. bar 的水平 / 垂直方向由什么决定？
- A. lv_bar_set_range 的最小值和最大值
- B. 部件本身的宽高比例（宽大水平，高大垂直）
- C. LV_BAR_MODE_NORMAL 等模式参数

<details>
<summary>查看答案</summary>

B。方向由宽高比决定，bar 没有专门的方向 API（PDF p.178）。
</details>

Q2. 想禁止 slider"单击跳变"（只能拖动调值），用哪个？
- A. lv_slider_set_mode(slider, LV_SLIDER_MODE_RANGE)
- B. lv_slider_set_value(slider, 0, LV_ANIM_OFF)
- C. lv_obj_add_flag(slider, LV_OBJ_FLAG_ADV_HITTEST)

<details>
<summary>查看答案</summary>

C。ADV_HITTEST 让单击失效，只响应拖动（PDF p.276）。
</details>

Q3. 把 arc 当"只读进度环"（不能拖、无旋钮），要做什么？
- A. 移除 LV_PART_KNOB 样式并清除可点击标志
- B. lv_arc_set_mode(arc, LV_ARC_MODE_SYMMETRIC)
- C. lv_arc_set_change_rate 把变化率设为 0

<details>
<summary>查看答案</summary>

A。lv_obj_remove_style(arc, NULL, LV_PART_KNOB) + lv_obj_clear_flag(arc, LV_OBJ_FLAG_CLICKABLE)（PDF p.170）。
</details>

Q4. 要做"心电图"式循环滚动的实时波形，选哪套组合？
- A. LV_CHART_UPDATE_MODE_CIRCULAR + lv_chart_set_next_value
- B. LV_CHART_TYPE_SCATTER + lv_chart_set_ext_y_array
- C. LV_CHART_UPDATE_MODE_SHIFT + lv_chart_set_all_value

<details>
<summary>查看答案</summary>

A。CIRCULAR 循环覆盖数据点，像心电图；SHIFT 是旧数据整体左移（PDF p.321）。
</details>

## 推荐阅读

- 📖 正点原子《LVGL 开发指南 V1.5》第 10 章 arc（PDF p.166）、第 11 章 bar（PDF p.178）、第 21 章 slider（PDF p.274）、第 26 章 chart（PDF p.319）、第 30 章 led（PDF p.357）、第 32 章 meter（PDF p.373）——本课全部依据
- 🌐 [LVGL 官方文档 meter（v8.3）](https://docs.lvgl.io/8.3/widgets/meter.html)——看官方示例，ArcIndicator 和 ScaleLines 两种指示器的完整用法
- 🌐 [LVGL 官方文档 chart（v8.3）](https://docs.lvgl.io/8.3/widgets/chart.html)——五种加数据方式的原文对照

## 下一步

有卡住的地方随时问我（Agent 就是你的老师）。下一课预告：[第 9 课：输入控件](/my-blog/posts/lvgl/0009-input-widgets/)——这课是"设备展示数据"，下节课反过来，让用户把参数输进设备：下拉、滚轮、软键盘全上阵。

| [← 上一课](/my-blog/posts/lvgl/0007-basic-widgets/) | [课程目录](/my-blog/posts/lvgl/00-总览/) | [下一课 →](/my-blog/posts/lvgl/0009-input-widgets/) |