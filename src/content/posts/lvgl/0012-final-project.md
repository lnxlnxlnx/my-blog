---
title: 综合项目 — 打造你的"智能设备控制台"
published: 2026-08-28
description: 第 12 课：把 11 课的知识收进一个产品——项目蓝图、状态机组织、四步分步实现、内存与性能复盘、验收清单，完成从"会写控件"到"会做产品"的升级。
tags: [LVGL, 嵌入式, GUI, 综合项目, 状态机, 内存优化]
category: LVGL
draft: false
prevTitle: ""
prevSlug: ""
nextTitle: 图像与字体
nextSlug: "lvgl/0011-images-and-fonts"
---

# 综合项目 — 打造你的"智能设备控制台"

把 11 课的知识收进一个产品：项目蓝图 → 状态机组织 → 分步实现 → 内存复盘 → 验收清单

**本课目标：**本课不教新部件，而是做一次"毕业设计"——用前面所有课的知识，规划并实现一个 4 页面的产品级界面：**智能设备控制台**。学完你能独立规划多页面产品、按状态机组织工程、完成内存与性能验收。完成课后清单，你就正式从"会写控件"升级到"会做产品"。

## 1. 项目蓝图：先画清楚再动手

写代码前先回答四个问题（参考你工程里 gui_menu.c 的分层思路）：**哪些页面？怎么导航？数据从哪来？多久刷一次？**

| 页面 | 核心部件 | 数据来源 | 刷新方式 |
|------|----------|----------|----------|
| 主页（仪表状态） | meter + led + label（32/30/18 章） | 模拟值或 ADC 采样 | 100ms 定时器 |
| 数据波形 | chart 折线图（26 章） | 模拟波形 / ADC_Wave | 100ms 定时器 |
| 参数设置 | switch + slider + dropdown + spinbox（22/21/16/35 章） | 用户操作 | 事件回调 |
| 关于 | label + img（17/18 章） | 静态 | 无 |

导航规则：**主页是根**，各页提供"返回主页"入口（触摸按钮 + 保留按键路径）。数据流是一条直线：*数据源 → lv_timer 回调取数 → 更新控件*。页面只管"摆样子"，数据逻辑放模块里，互不纠缠。

> 💡 320×240 的屏幕一页放不下太多东西。每个页面只突出 1 个主角部件（仪表页的主角就是 meter），其余做配角。贪多 = 挤成乱码。

## 2. 工程组织：照 gui_menu.c 的样子来

你工程里 gui_menu.c 已经示范了最佳实践（去 BSP/LVGL_APP/gui_menu.c 对照）：一个全局状态 `g_app`（gui_menu.c:9）、`clean_screen()` 清屏（gui_menu.c:17）、每个 App 一个 `xxx_init()`、`GuiMenu_Switch()` 统一切换（gui_menu.c:128）。main.c 的接法也现成：初始化段 `lv_init → lv_port_disp_init → GuiMenu_Init`（main.c:157-159），主循环里按 `g_app` 分发按键、最后 `lv_timer_handler()`（main.c:252）。

综合项目照抄这个模式：每个页面一个 `.c/.h` 放 BSP/LVGL_APP/，提供 `xxx_create()`（建页面）+ `xxx_tick()`（刷数据）+ `xxx_key()`（按键），切换动作全部收敛到控制台模块：

```c
/* ========== app_console.h ========== */
typedef enum {
    PAGE_HOME = 0,      /* 主页：仪表 + 状态灯 + 数值 */
    PAGE_WAVE,          /* 数据波形 */
    PAGE_SETTING,       /* 参数设置 */
    PAGE_ABOUT,         /* 关于 */
} PageId;

void Console_Init(void);
void Console_GoPage(PageId id);    /* 清屏 + 重建 + 过渡动画 */

/* ========== app_console.c（参照 gui_menu.c 的 g_app 模式） ========== */
PageId g_page = PAGE_HOME;

static void clean_screen(void)
{
    lv_obj_clean(lv_scr_act());    /* 整屏对象清空，和 gui_menu.c 一样 */
}

void Console_GoPage(PageId id)
{
    g_page = id;
    clean_screen();
    switch (id) {
    case PAGE_HOME:    page_home_create();    break;
    case PAGE_WAVE:    page_wave_create();    break;
    case PAGE_SETTING: page_setting_create(); break;
    case PAGE_ABOUT:   page_about_create();   break;
    }
    lv_obj_fade_in(lv_scr_act(), 300, 0);     /* 页面切换过渡 */
}
```

main.c 里按键分发照抄 gui_menu 的 `switch (g_app)` 写法，把分支换成 `g_page` 和 `Console_GoPage()` 即可；`lv_timer_handler()` 保持每轮调用，一条主线到底。

> 💡 触摸屏是主角，但**保留按键路径**（你板子上的 KEY 键）非常值：调试时不用总摸屏幕，演示时也稳。gui_menu.c 的 Navigate/Enter/Back 就是现成范本。

## 3. 分步实现清单：四步走

别想着一次写完。每一步都编译烧录验证，再走下一步。

### Step ① 主框架 + 主页仪表（最优先）

先搭导航骨架：用 tabview（`LV_USE_TABVIEW` 已使能，37 章 (PDF p.425)）或仿 gui_menu 的自绘菜单。然后做主页：`meter` 仪表（32 章 (PDF p.373)）+ `led` 状态灯（30 章 (PDF p.357)）+ 数值标签，用 `lv_timer_create` 挂一个 100ms 数据定时器：

```c
/* ========== page_home.c：主页仪表 ========== */
static lv_obj_t *s_meter;
static lv_meter_indicator_t *s_needle;
static lv_obj_t *s_led;
static void data_timer_cb(lv_timer_t *timer);   /* 前置声明 */

static void page_home_create(void)
{
    lv_obj_t *scr = lv_scr_act();
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x1E293B), 0);  /* 深色底 */

    lv_obj_t *title = lv_label_create(scr);
    lv_label_set_text(title, LV_SYMBOL_HOME " Device Console");
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 8);

    s_meter = lv_meter_create(scr);
    lv_obj_set_size(s_meter, 200, 200);
    lv_obj_center(s_meter);

    lv_meter_scale_t *scale = lv_meter_add_scale(s_meter);
    lv_meter_set_scale_ticks(s_meter, scale, 11, 2, 10,
                             lv_palette_main(LV_PALETTE_GREY));
    lv_meter_set_scale_major_ticks(s_meter, scale, 5, 4, 18,
                                   lv_color_hex(0xE8E8E8), 15);
    lv_meter_set_scale_range(s_meter, scale, 0, 100, 270, 135); /* 0~100，270° */
    s_needle = lv_meter_add_needle_line(s_meter, scale, 4,
                                        lv_palette_main(LV_PALETTE_RED), -10);

    s_led = lv_led_create(scr);
    lv_led_set_color(s_led, lv_palette_main(LV_PALETTE_RED));
    lv_obj_align(s_led, LV_ALIGN_BOTTOM_LEFT, 20, -20);

    lv_timer_create(data_timer_cb, 100, NULL);   /* 每 100ms 刷一次 */
}

static void data_timer_cb(lv_timer_t *timer)
{
    static int32_t val = 0;
    val += 5;                                    /* 模拟数据：换成 ADC 采样 */
    if (val > 100) val = 0;
    lv_meter_set_indicator_start_value(s_meter, s_needle, val);
    if (val > 80) lv_led_on(s_led);              /* 越限告警灯 */
    else           lv_led_off(s_led);
}
```

### Step ② 波形页

`lv_chart_create` 建折线图（26 章 (PDF p.319)）：`lv_chart_set_type(chart, LV_CHART_TYPE_LINE)`、`lv_chart_set_point_count(chart, 80)`、`lv_chart_set_range(chart, LV_CHART_AXIS_PRIMARY_Y, 0, 100)`、`lv_chart_add_series` 加数据线，定时器里 `lv_chart_set_next_value` 喂新点——一条"实时滚动"的示波器曲线就出来了。

### Step ③ 设置页

四个控件各来一个：`lv_switch_create`（开关，选中加 `LV_STATE_CHECKED`）、`lv_slider_create` + `lv_slider_set_range`（滑块）、`lv_dropdown_create` + `lv_dropdown_set_options`（下拉，选项用 \n 分隔）、`lv_spinbox_create` + `lv_spinbox_set_value`（微调器）。各自挂 `LV_EVENT_VALUE_CHANGED` 回调，把新值写回你的数据模块（如 ADC_Wave_*）。

### Step ④ 动画过渡与主题配色

页面切换用 `lv_obj_fade_in`（上面状态机代码里已带）；配色统一走 `lv_palette_main()`，主色 + 辅色 + 深色背景（0x1E293B 这类），全工程一个色板，别五颜六色。

> ⚠️ **先跑通骨架再填肉**：Step ① 没通过前，不要动 Step ②③。每加一页就编译烧录一次，把"哪里炸了"控制到最小范围——这是嵌入式开发最省时间的节奏。

## 4. 内存与性能复盘

界面做完，回到 lv_conf.h 做一次"体检 + 裁剪"（PDF 5.2 节 (PDF p.64)）。你的工程现状对照：

| 配置项 | 本工程现状 | 综合项目建议 |
|--------|-----------|-------------|
| `LV_USE_PNG/GIF/SJPG/BMP` | 全 0 | 保持 0，产品用不到大图解码，省 Flash |
| `LV_USE_ANIMIMG` | 0 | 不用帧动画就保持 0 |
| 内置字库 | 仅 MONTSERRAT_14 | 保持，一个字号走天下最省 |
| `LV_MEM_SIZE` | 48 KB（lv_conf.h:60） | 够用；页面多了看左下角内存监控再调 |
| 刷新周期 | `LV_DISP_DEF_REFR_PERIOD` 30ms ≈ 33FPS | 保持；卡顿再降到 20ms 并检查重绘面积 |
| 显示缓冲 | 单缓冲 10 行（320×10×2 ≈ 6.4 KB） | 保持；渲染吃紧时改双缓冲（lv_port_disp.c 有注释掉的现成配置） |

你的工程已经把 `LV_USE_PERF_MONITOR` 和 `LV_USE_MEM_MONITOR` 打开了（lv_conf.h:290/297）：屏幕**右下角实时 FPS、左下角内存占用**，验收时直接肉眼读数。想要更细的内存报告，用 `lv_mem_monitor`：

```c
/* 内存体检：把监控结果打到界面标签上（或串口） */
static lv_obj_t *s_mem_label;

static void mem_timer_cb(lv_timer_t *timer)
{
    lv_mem_monitor_t mon;
    lv_mem_monitor(&mon);                        /* 读取 LVGL 内存池状态 */
    char buf[48];
    snprintf(buf, sizeof(buf), "used %u / free %u",
             (unsigned)(mon.total_size - mon.free_size),
             (unsigned)mon.free_size);
    lv_label_set_text(s_mem_label, buf);
}
```

> 💡 内存三问自查：**新建页面涨多少？离开页面还了吗？反复切换持平吗？**——前两问查泄漏，第三问查缓存。全部通过，内存这关就过了。

## 5. 验收标准清单：逐项勾选

做完逐项打勾，全绿才算毕业：

- ☐ **页面数量**：至少 3 个页面（主页/波形/设置/关于），且能来回切换（触摸 + 按键均可）
- ☐ **动态数据**：主页表针与数值每 100ms 更新一次，肉眼可见平滑转动
- ☐ **波形滚动**：图表页曲线实时右移，无跳变无闪烁
- ☐ **设置生效**：switch/slider/dropdown/spinbox 四个控件齐全，调完的值能被数据模块读回
- ☐ **过渡动画**：页面切换有淡入等过渡效果，不干切
- ☐ **无内存泄漏**：连续切换页面 20 次，lv_mem_monitor 的 free 值基本不变
- ☐ **性能达标**：静止时 FPS ≥ 25，动态数据时不低于 20
- ☐ **持久化接口预留**：设置项有"保存/恢复"的接口雏形（提示：BSP/24CXX 有 EEPROM 驱动可写参数，本课只要求留接口、不要求真存）

## 动手练习（约 50 分钟）

### 练习 12.1：实现项目第一步——主框架 + 首页仪表

- 1️⃣ 在 BSP/LVGL_APP/ 新建 app_console.c/.h 和 page_home.c/.h，照第 2 节状态机模板搭骨架，页面用 tabview 或仿 gui_menu 菜单。
- 2️⃣ 照第 3 节 Step ① 代码实现主页：meter 仪表 + led 告警灯 + 标题，100ms 定时器驱动。
- 3️⃣ main.c 初始化段把 `GuiMenu_Init()` 换成 `Console_Init()`（先只留这一页，其余三个页面留空函数占位），编译烧录。
- **观察什么：** 表针每 100ms 跳 5 格、循环一圈；数值过 80 时 LED 变亮（越限告警）。如果表针不动，检查定时器有没有创建、`lv_timer_handler` 有没有每轮被调用。

### 练习 12.2：用 lv_mem_monitor 观察内存

- 1️⃣ 照第 4 节代码写 `mem_timer_cb`，在"关于"页放一个标签显示 used/free，500ms 刷新一次。
- 2️⃣ 开机进主页，记下 free 值（基线）；然后连续进入/退出设置页 10 次，回主页再看 free。
- **观察什么：** 两次数字基本持平 = 无泄漏，恭喜。如果每次少几 KB，说明有对象只创建没删除——重点检查页面里 `lv_timer_create` 的定时器：页面销毁时定时器会跟着对象走吗？不会，`lv_timer` 不属于任何对象，页面切换必须自己 `lv_timer_del`，这是最常见的泄漏源。

## 自测（答完再点答案）

### 随堂小测

Q1. 页面切换后内存持续下降，返回主页也不回升，最可能的原因？
- A. 旧页面对象没释放干净，存在内存泄漏
- B. LVGL 自动缓存旧页面，属于正常现象
- C. 定时器回调里创建了太多局部变量

<details>
<summary>查看答案</summary>

A。切换后 free 不回升 = 对象或定时器没释放（页面自建的 lv_timer 要自己 lv_timer_del）。B 是误解，C 的局部变量在栈上，与 LVGL 内存池无关。
</details>

Q2. 主页仪表数据动态更新的推荐做法是什么？
- A. 在按键扫描中断里直接修改表针数值
- B. 创建周期 lv_timer，回调里更新表针和标签
- C. 主循环里用 while 死等数据变化再刷新

<details>
<summary>查看答案</summary>

B。数据流"数据源 → 定时器回调 → 控件"，与 LVGL 引擎同频。A 违反中断红线，C 会卡死引擎。
</details>

Q3. "设置页调的值，重启后能保留"属于哪一类需求？
- A. 持久化需求，需借助外部存储配合（如 BSP/24CXX 的 EEPROM）
- B. LVGL 内置功能，配置一下宏就能自动保存
- C. 页面动画需求，和存储没有任何关系

<details>
<summary>查看答案</summary>

A。LVGL 只管界面不管存数，掉电保存要靠外部存储。本课验收标准只要求预留接口，不要求实现。
</details>

Q4. 验收发现帧率低于 25 FPS、界面卡顿，优先排查哪一项？
- A. 解码库大图、定时器过密、整屏频繁重绘等渲染开销
- B. 屏幕分辨率是否配置错误
- C. 触摸屏是否需要重新校准

<details>
<summary>查看答案</summary>

A。FPS 低是渲染开销问题：关掉大图解码、把定时器从 10ms 放宽到 100ms、避免整屏脏区。B/C 与帧率无关。
</details>

## 推荐阅读

- 📖 正点原子《LVGL 开发指南 V1.5》部件篇按需回查：仪表（32 章 p.373）、图表（26 章 p.319）、LED（30 章 p.357）、开关（22 章 p.281）、滑块（21 章 p.274）、下拉列表（16 章 p.227）、微调器（35 章 p.412）、选项卡视图（37 章 p.425）、菜单（41 章 p.451）
- 🌐 [LVGL 官方文档 Timers（v8.3）](https://docs.lvgl.io/8.3/overview/timer.html)——本课数据刷新机制的依据
- 🌐 [LVGL 官方文档 Memory（v8.3）](https://docs.lvgl.io/8.3/porting/memory.html)——内存池配置与监控
- 🔧 你工程里的 `BSP/LVGL_APP/gui_menu.c` + `Core/Src/main.c`——本课工程组织的活教材

## 下一步

🎓 12 课到此收官。恭喜你走完从"跑通 LVGL"到"做出产品界面"的全过程。以后做任何界面，都记得这条主线：**先蓝图、再骨架、小步验证、内存复盘、逐项验收**。有任何不清楚的地方，随时回来问我（Agent 就是你的老师）——课程会继续更新，下一站等你来定。

| [← 上一课](/my-blog/posts/lvgl/0011-images-and-fonts/) | [课程目录](/my-blog/posts/lvgl/00-总览/) | — |