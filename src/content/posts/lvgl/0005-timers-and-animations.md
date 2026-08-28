---
title: 定时器与动画
published: 2026-08-21
description: 第 5 课：让界面"活起来"——动画七步流程、路径曲线、动画时间线、LVGL 软件定时器，并分清 lv_tick_inc 与 lv_timer 谁管时间、谁管调度。
tags: [LVGL, 嵌入式, GUI, 动画, 定时器, lv_timer]
category: LVGL
draft: false
prevTitle: Flex 与 Grid 布局
prevSlug: "lvgl/0006-flex-and-grid-layout"
nextTitle: 事件与交互
nextSlug: "lvgl/0004-events-and-interaction"
---

# 定时器与动画

让界面"活起来"：动画七步流程、路径曲线、动画时间线，以及 LVGL 软件定时器。

**本课目标：**学完你能独立写出"呼吸灯"和"秒表"两个效果，看懂 `lv_anim_t` 的每个配置项，知道定时器回调什么时候被调用、误差从哪来，并分清 `lv_tick_inc` 和 `lv_timer` 谁管时间、谁管调度。这是后续所有界面"手感"的根基。

## 1. 动画七步流程：从变量到发车

LVGL 的动画思路很朴素：你告诉它**"哪个对象、从什么值、到什么值、走多久"**，它在每一帧算出中间值，再通过回调函数把值应用到对象上（PDF 6.6.1 (PDF p.111)）。完整流程七步：

```c
/* ① 定义动画变量 */
lv_anim_t a;

/* ② 初始化 */
lv_anim_init(&a);

/* ③ 设置动画回调函数：每帧把当前值 v 应用到对象上 */
lv_anim_set_exec_cb(&a, (lv_anim_exec_xcb_t)lv_obj_set_x);

/* ④ 设置动画目标对象 */
lv_anim_set_var(&a, obj);

/* ⑤ 动画时长 [ms] */
lv_anim_set_time(&a, 500);

/* ⑥ 起始值和结束值 */
lv_anim_set_values(&a, 0, 150);

/* ⑦ 发车！ */
lv_anim_start(&a);
```

其中③④⑤⑥顺序无所谓，但**①和⑦缺一不可**——不 `lv_anim_start`，前面全白搭。回调函数是最关键的一环：它决定动画"动的是什么"。官方内置了大量现成回调可以直接用，比如 `lv_obj_set_x`、`lv_obj_set_width`、`lv_obj_set_style_opa`（这个需要包一层，见后面呼吸灯）。

除了七步，还有一堆可选配置（PDF 6.6.1 (PDF p.111)），记住这几个就够用：

| 配置 | 作用 |
|------|------|
| `lv_anim_set_delay()` | 启动前的等待时间（ms），可做"排队演出" |
| `lv_anim_set_path_cb()` | 设置路径曲线，默认线性 |
| `lv_anim_set_playback_time()` | 播完后倒放一段（ms），呼吸灯的灵魂 |
| `lv_anim_set_repeat_count()` | 重复次数，`LV_ANIM_REPEAT_INFINITE` 无限循环 |
| `lv_anim_set_ready_cb()` | 动画播完（空闲）时回调，适合"播完切页面" |
| `lv_anim_set_early_apply()` | 是否立即应用起始值（默认 true） |

> 💡 `lv_anim_t` 声明在栈上就行！`lv_anim_start` 会把动画数据复制到内部链表，函数返回后栈变量销毁也不影响动画继续跑。所以"临时拼一个动画"是常态写法。

## 2. 动画路径：给运动加"手感"

线性动画（匀速）是最无聊的。LVGL 内置 7 种路径（PDF 6.6.2 (PDF p.112)），通过 `lv_anim_set_path_cb(&a, lv_anim_path_xxx)` 传入：

| 路径 | 感觉 |
|------|------|
| `lv_anim_path_linear` | 匀速直线（默认） |
| `lv_anim_path_step` | 憋到最后一步直接跳变 |
| `lv_anim_path_ease_in` | 起步慢，越来越快 |
| `lv_anim_path_ease_out` | 冲得快，结尾刹住 |
| `lv_anim_path_ease_in_out` | 两头慢中间快，最"顺滑" |
| `lv_anim_path_overshoot` | 冲过头再弹回来 |
| `lv_anim_path_bounce` | 像球落地反弹 |

如果想按"速度"而非"时长"来定动画，用 `lv_anim_speed_to_time(speed, start, end)`（PDF 6.6.3 (PDF p.113)）：它按"每秒走多少单位"反算出时长，比如 `lv_anim_set_time(&a, lv_anim_speed_to_time(200, 0, 100))` 就是"每秒 200 像素，从 0 走到 100"。这样不同距离的动画节奏一致，界面更统一。

动画不要了？`lv_anim_del(var, exec_cb)`（PDF 6.6.4 (PDF p.113)）可以精准删除：两个参数都可以传 `NULL` 表示"不限定"——比如 `lv_anim_del(obj, NULL)` 删除 obj 上的所有动画。

## 3. 动画时间线：把多段动画编成一场戏

一个动画只能动一个属性。想让"先增宽、再增高"这种非线性编排，就用动画时间线（PDF 6.6.6 (PDF p.114)）——把多个动画按时间点挂到一条线上，统一播放/暂停/倒放：

```c
static lv_anim_timeline_t * tl = NULL;

void card_anim_create(lv_obj_t * card)
{
    /* 动画 1：300ms 增宽 */
    lv_anim_t a1;
    lv_anim_init(&a1);
    lv_anim_set_var(&a1, card);
    lv_anim_set_values(&a1, 90, 100);
    lv_anim_set_exec_cb(&a1, (lv_anim_exec_xcb_t)lv_obj_set_width);
    lv_anim_set_time(&a1, 300);
    lv_anim_set_path_cb(&a1, lv_anim_path_overshoot);

    /* 动画 2：300ms 增高 */
    lv_anim_t a2;
    lv_anim_init(&a2);
    lv_anim_set_var(&a2, card);
    lv_anim_set_values(&a2, 70, 90);
    lv_anim_set_exec_cb(&a2, (lv_anim_exec_xcb_t)lv_obj_set_height);
    lv_anim_set_time(&a2, 300);

    /* 建时间线：动画1在 0ms 开始，动画2在 300ms 接上 */
    tl = lv_anim_timeline_create();
    lv_anim_timeline_add(tl, 0, &a1);
    lv_anim_timeline_add(tl, 300, &a2);
    lv_anim_timeline_start(tl);
}
```

配套 API：`lv_anim_timeline_set_reverse(tl, true)` 整条倒放、`lv_anim_timeline_stop(tl)` 停止、`lv_anim_timeline_set_progress(tl, p)` 直接跳到某个进度、`lv_anim_timeline_del(tl)` 删除（PDF 6.6.6.1 (PDF p.117)）。做"点击卡片弹大、再点收回"这类效果，时间线是首选。## 4. LVGL 定时器：你的软件"闹钟"

LVGL 自带软件定时器（PDF 6.7 (PDF p.120)），建在硬件时基之上，不受硬件定时器数量限制。创建时指定回调函数和周期：

```c
static lv_obj_t * cd_label;   /* 倒计时显示 */
static uint8_t countdown = 3; /* 从 3 开始 */

static void countdown_cb(lv_timer_t * timer)
{
    lv_label_set_text_fmt(cd_label, "%u", countdown);
    countdown--;

    if (countdown == 0) {
        lv_timer_del(timer);   /* 播完删掉自己，只响三次 */
    }
}

void countdown_create(lv_obj_t * parent)
{
    cd_label = lv_label_create(parent);
    lv_obj_set_style_text_font(cd_label, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_center(cd_label);

    /* 每 1000ms 调一次回调 */
    lv_timer_create(countdown_cb, 1000, NULL);
}
```

常用配置函数（PDF 6.7.1~6.7.3 (PDF p.120)）：

| 函数 | 作用 |
|------|------|
| `lv_timer_create(cb, period, user_data)` | 创建定时器，返回指针 |
| `lv_timer_create_basic()` | 建一个默认周期的定时器，之后必须 `lv_timer_set_cb()` 补回调 |
| `lv_timer_set_period(t, ms)` | 改周期 |
| `lv_timer_set_repeat_count(t, n)` | n 次后自动删除；`-1` 无限次；`0` 停止 |
| `lv_timer_ready(t)` / `lv_timer_reset(t)` | 让定时器下一次 handler 就跑 / 重新计时 |
| `lv_timer_pause(t)` / `lv_timer_resume(t)` | 暂停 / 恢复 |
| `lv_timer_del(t)` | 删除（回调里删自己也是允许的，如上例） |
| `lv_timer_get_idle()` | 返回 `lv_timer_handler` 的空闲百分比，估 CPU 余量 |

> ⚠️ **定时器回调不是实时中断**：它是在 `lv_timer_handler()` 轮询时检查"到没到期"再执行。回调里千万别做长耗时操作（比如 `HAL_Delay(500)`、大段计算），否则整个 UI 会卡住。软件定时器的误差也正是源于 `lv_timer_handler` 不是准时调用（PDF 6.7 (PDF p.120)）。

## 5. lv_tick 与 lv_timer：谁管时间，谁管调度

这是最容易混的一对概念，一句话分清：

- **`lv_tick_inc(1)`（SysTick 中断，每 1ms）是"钟"**——只负责让 LVGL 知道现在几点，它把毫秒数累进内部计数器（第 1 课讲过，stm32f4xx_it.c:198）。
- **`lv_timer_create()` 是"闹钟"**——告诉 LVGL"过多久叫我一次"，到期与否在 `lv_timer_handler()`（主循环 main.c:252）里用"钟"的时间来判定。

所以：没有 `lv_tick_inc`，动画和定时器全都"不走"（时间永远停在 0）；没有 `lv_timer_handler`，定时器回调永远不执行。两个一起，才构成 LVGL 的时间世界。动画本质上也是靠内部定时器驱动的（`lv_anim.c` 里就有一个全局动画定时器），理解了这层关系，你就明白为什么第 1 课说"引擎不转，界面不动"。

## 动手练习（约 20 分钟）

### 练习 5.1：呼吸灯

- 1️⃣ 新建一个圆形对象当"灯泡"（`lv_obj_set_style_radius` 设 `LV_RADIUS_CIRCLE`），给它一个亮色背景。
- 2️⃣ 写一个透明度回调：`lv_obj_set_style_opa((lv_obj_t*)var, v, LV_PART_MAIN)`，注意 `lv_obj_set_style_opa` 有三个参数，不能直接当 `exec_cb` 用，必须包一层。
- 3️⃣ 动画配置：值 0→255，时长 800ms，路径 `lv_anim_path_ease_in_out`，`playback_time` 800ms，`repeat_count` 用 `LV_ANIM_REPEAT_INFINITE`，`lv_anim_start`。
- 4️⃣ 观察：把路径换成 `lv_anim_path_linear` 和 `lv_anim_path_step` 各看一遍，感受差别；想想为什么 `ease_in_out` 最像"呼吸"。

### 练习 5.2：秒表 + 3 秒倒计时

- 1️⃣ 建一个标签显示 `00:00.0`，用 `lv_timer_create(cb, 100, NULL)` 每 100ms 更新一次，格式参考本课示例（用 `lv_label_set_text_fmt`）。
- 2️⃣ 再加一个"3、2、1 开始"倒计时标签：定时器周期 1000ms，`countdown` 减到 0 时 `lv_timer_del(timer)` 自删，并把秒表标签改成"GO!"。
- 3️⃣ 观察：把秒表周期改成 50ms，数字跳动会不会更"跟手"？误差来自哪里？（提示：handler 的轮询周期）

## 自测（答完再点答案）

### 随堂小测 1

Q1. 动画流程中，哪一步是不可省略的？
- A. lv_anim_set_path_cb 设置路径曲线
- B. lv_anim_set_playback_time 设置倒放
- C. lv_anim_start 启动动画

<details>
<summary>查看答案</summary>

C。不 start 动画永不执行；路径和倒放都是可选项（PDF p.111）。
</details>

Q2. 想要"冲过头再弹回来"的弹跳手感，选哪个路径？
- A. lv_anim_path_overshoot
- B. lv_anim_path_ease_in_out
- C. lv_anim_path_step

<details>
<summary>查看答案</summary>

A。overshoot 超出最终值后回弹；ease_in_out 是顺滑过渡，step 是最后跳变（PDF p.112）。
</details>

Q3. lv_timer_create 的回调函数在什么时刻被执行？
- A. 硬件中断到达时立即执行
- B. 主循环调用 lv_timer_handler 时检查到期
- C. lv_tick_inc 被调用时同步执行

<details>
<summary>查看答案</summary>

B。软件定时器在 lv_timer_handler 轮询中判定到期（PDF p.120），这也是误差的来源。
</details>

Q4. 想让定时器"只响 5 次然后自动删除"，该怎么做？
- A. lv_timer_set_repeat_count(t, 5)
- B. lv_timer_set_period(t, 5)
- C. lv_timer_set_repeat_count(t, -1)

<details>
<summary>查看答案</summary>

A。repeat_count 为正数时响够次数自动删除；-1 是无限次（PDF p.121）。
</details>

## 推荐阅读

- 📖 正点原子《LVGL 开发指南 V1.5》第 6.6 节（动画，PDF p.111~119）和第 6.7 节（定时器，PDF p.120~122）——本课全部依据
- 🌐 [LVGL 官方文档 Animations（v8.3）](https://docs.lvgl.io/8.3/overview/animation.html)——看 "Create an animation" 和 "Timeline" 两节
- 🌐 [LVGL 官方文档 Timers（v8.3）](https://docs.lvgl.io/8.3/overview/timer.html)——Ready and Reset / Repeat count 有更细的解释

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：[第 6 课：Flex 与 Grid 布局](/my-blog/posts/lvgl/0006-flex-and-grid-layout/)——让对象自动排排坐，从此告别手算坐标。

| [← 上一课](/my-blog/posts/lvgl/0004-events-and-interaction/) | [课程目录](/my-blog/posts/lvgl/00-总览/) | [下一课 →](/my-blog/posts/lvgl/0006-flex-and-grid-layout/) |