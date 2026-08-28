---
title: 事件与交互
published: 2026-08-20
description: 第 4 课：让界面"会反应"——事件机制三要素、lv_obj_add_event_cb 回调、事件类型分类、事件字段获取，做出"点击计数"交互界面。
tags: [LVGL, 嵌入式, GUI, 事件, 回调, 交互]
category: LVGL
draft: false
prevTitle: 定时器与动画
prevSlug: "lvgl/0005-timers-and-animations"
nextTitle: 样式系统
nextSlug: "lvgl/0003-styles"
---

# 事件与交互

让界面活起来：事件机制、回调、事件类型、获取事件字段。

**本课目标：**前两课造好了"看得见的界面"，这一课让它"会反应"。学完你能用 lv_obj_add_event_cb 给任何控件挂回调，用 lv_event_get_code 区分按下/点击/滚动，并做出"点击计数"的交互界面——以及给你的 2048 游戏格子加上触摸响应。

## 1. 事件机制：三要素（6.8.1）

事件（Event）是连接 GUI 和业务逻辑的桥梁：短按、长按、按下并释放、聚焦……都是一类"动作"的集合（PDF 6.8.1 (PDF p.123)）。机制分三部分：

1. **事件源**——能产生事件的部件（LVGL 里每个部件都能触发事件）
2. **事件**——用户对部件的操作动作（短按、长按、滑动……）
3. **事件监听器**——接收、解释事件并执行你的代码（回调函数）

典型场景：按下按钮 → 触发 CLICKED 事件 → 回调函数里调用 LED 驱动 → 灯亮了。硬件驱动就这样被"事件"串进了 GUI。

结合上一课你会发现：**样式靠"状态"响应触摸，逻辑靠"事件"响应触摸**——一个管外观，一个管行为，这是 LVGL 交互的两条腿。

## 2. 添加与删除事件（6.8.2 / 6.8.3）

核心函数是 `lv_obj_add_event_cb`，四个参数：对象、回调、事件类型过滤器、用户数据（PDF 6.8.2 (PDF p.124)）：

```c
struct _lv_event_dsc_t * lv_obj_add_event_cb(lv_obj_t * obj,
                                             lv_event_cb_t event_cb,
                                             lv_event_code_t filter,
                                             void * user_data);
```

三步走：创建部件 → 挂回调 → 在回调里写逻辑：

```c
/* 第一步：创建按钮部件 */
lv_obj_t * btn = lv_btn_create(lv_scr_act());

/* 第二步：添加事件并指定回调（LV_EVENT_CLICKED = 点按完成时触发） */
lv_obj_add_event_cb(btn, my_event_cb, LV_EVENT_CLICKED, NULL);

/* 第三步：回调函数里处理用户逻辑 */
static void my_event_cb(lv_event_t * e)
{
    printf("Clicked\n");
}
```

删除事件用 `lv_obj_remove_event_cb(obj, event_cb)`，返回 true 表示确有事件被移除。

> 💡 `user_data` 是"免费携带的行李"：想给回调传参数，不用全局变量，直接把指针塞在这里，回调里用 `lv_event_get_user_data(e)` 取回来。多个按钮共用回调 + 各自带数据，是省代码利器。

## 3. 事件类型：动作的"分类标签"（6.8.4）

事件类型是"同类动作的集合"，分五类：输入设备事件、绘图事件、其他事件、特别事件、自定义事件（PDF 6.8.4 (PDF p.125)）。日常开发 90% 用的是输入设备事件 + 特别事件：

| 事件类型 | 触发时机 |
|----------|----------|
| `LV_EVENT_PRESSED` | 手指按下瞬间 |
| `LV_EVENT_PRESSING` | 按住期间持续触发 |
| `LV_EVENT_PRESS_LOST` | 按着但手指滑出了对象 |
| `LV_EVENT_SHORT_CLICKED` | 短按（滚动时不触发） |
| `LV_EVENT_LONG_PRESSED` | 长按（可设长按时间，滚动时不触发） |
| `LV_EVENT_CLICKED` | 释放时触发：没发生滚动就调（不论长短按）——"点一下" |
| `LV_EVENT_RELEASED` | 每次释放都触发 |
| `LV_EVENT_SCROLL_BEGIN / SCROLL / SCROLL_END` | 滚动开始 / 进行中 / 结束 |
| `LV_EVENT_GESTURE` | 检测到手势 |
| `LV_EVENT_KEY` | 按键发送到对象（键盘/编码器） |
| `LV_EVENT_FOCUSED / DEFOCUSED` | 获得/失去聚焦 |
| `LV_EVENT_VALUE_CHANGED` | 对象的值变了（滑块拖动、开关切换）——特别事件 |
| `LV_EVENT_DELETE` | 对象正在被删除——其他事件 |

区分三个"点按兄弟"：**PRESSED 按下瞬间、RELEASED 每次松开、CLICKED 点了一下**（松开且没滚动）。做"按钮动作"用 CLICKED 最稳。

> ⚠️ **别在 PRESSED 里做"点击后该做的事"**：用户按住滑走、或者只是误触，PRESSED 照样触发。类似"确认动作"（开关灯、提交、翻页）请挂在 CLICKED 上，等释放确认了再执行。

## 4. 获取事件字段：一个回调吃遍所有事件（6.8.5）

LVGL 允许多个事件**共用同一个回调**，回调里用字段函数区分"是谁、是什么、带什么"（PDF 6.8.5 (PDF p.127)）：

| 函数 | 返回 |
|------|------|
| `lv_event_get_code(e)` | 事件类型（PRESSED / CLICKED / SCROLL_END……） |
| `lv_event_get_target(e)` | 最初触发事件的对象 |
| `lv_event_get_current_target(e)` | 当前正在处理事件的对象（事件冒泡时是祖先） |
| `lv_event_get_user_data(e)` | 注册时塞进去的用户数据 |
| `lv_event_get_param(e)` | lv_event_send 传入的参数 |

一个经典套路：一个回调 + `get_code` 分流 + `get_user_data` 区分对象，管住一排按钮：

```c
/* 一行代码给三个按钮挂同一个回调 */
lv_obj_add_event_cb(btn1, row_cb, LV_EVENT_ALL, (void *)1);  /* user_data = 1 */
lv_obj_add_event_cb(btn2, row_cb, LV_EVENT_ALL, (void *)2);  /* user_data = 2 */
lv_obj_add_event_cb(btn3, row_cb, LV_EVENT_ALL, (void *)3);  /* user_data = 3 */

static void row_cb(lv_event_t * e)
{
    lv_event_code_t code = lv_event_get_code(e);   /* 是什么事件 */
    uint32_t id = (uint32_t)lv_event_get_user_data(e); /* 是哪个按钮 */

    if (code == LV_EVENT_CLICKED) {
        printf("btn %d clicked\n", (int)id);
    } else if (code == LV_EVENT_PRESSED) {
        printf("btn %d pressed\n", (int)id);
    }
}
```

> 💡 target 与 current_target 的区别：事件会"冒泡"——子对象触发的事件，会依次传给父对象、祖父对象。get_target 是"源头"，current_target 是"当前正处理它的那个对象"。父容器用 LV_EVENT_ALL 监听，就能统一捕获所有子对象的动作。## 代码示例 1：点击计数按钮

第一个"活的"界面：一个按钮一个标签，点一下数字 +1。这正是本课练习 4.1 的骨架：

```c
static lv_obj_t * count_label;
static uint32_t count = 0;

static void count_cb(lv_event_t * e)
{
    lv_event_code_t code = lv_event_get_code(e);
    if (code == LV_EVENT_CLICKED) {
        count++;
        lv_label_set_text_fmt(count_label, "点击了 %d 次", (int)count);
    }
}

void lvgl_demo_counter(void)
{
    /* 按钮 */
    lv_obj_t * btn = lv_btn_create(lv_scr_act());
    lv_obj_set_size(btn, 160, 60);
    lv_obj_align(btn, LV_ALIGN_CENTER, 0, -40);
    lv_obj_add_event_cb(btn, count_cb, LV_EVENT_CLICKED, NULL);

    lv_obj_t * btn_label = lv_label_create(btn);
    lv_label_set_text(btn_label, "点我");
    lv_obj_center(btn_label);

    /* 计数标签：显示在按钮下方 */
    count_label = lv_label_create(lv_scr_act());
    lv_label_set_text(count_label, "点击了 0 次");
    lv_obj_align(count_label, LV_ALIGN_CENTER, 0, 30);
}
```

顺手加个"按住加速"彩蛋——把回调里 CLICKED 之外再挂一个 `LV_EVENT_PRESSING` 分支，按住期间 count 每帧 +1，观察和 CLICKED 的区别。

## 代码示例 2：2048 格子触摸响应（可选挑战）

给 BSP/lvgl_2048.c 的格子加上触摸反馈的骨架思路——不用改游戏逻辑，先让"点到的格子"能回应：

```c
/* 思路：给每个格子对象挂同一个回调，user_data 里带行列号 */
static void cell_cb(lv_event_t * e)
{
    lv_event_code_t code = lv_event_get_code(e);
    if (code != LV_EVENT_CLICKED) return;

    /* 从 user_data 取出行列（用指针包一层，因为 (void*) 直接存整数也可行） */
    uint32_t idx = (uint32_t)lv_event_get_user_data(e);
    uint32_t row = idx / 4;
    uint32_t col = idx % 4;
    printf("cell[%d][%d] clicked\n", (int)row, (int)col);

    /* 视觉反馈：临时把背景调亮，500ms 后恢复（用定时器，第 6 课讲） */
    lv_obj_t * cell = lv_event_get_target(e);
    lv_obj_set_style_bg_color(cell, lv_color_hex(0x4C4C4C), LV_STATE_PRESSED);
}

/* 挂载：在创建 16 个格子的循环里加一行 */
/* for (i = 0; i < 16; i++)
 *     lv_obj_add_event_cb(cell[i], cell_cb, LV_EVENT_ALL, (void *)(uintptr_t)i);
 */

/* 观察：点击任意格子，串口打印行列号 —— 触摸层已经和游戏层打通了 */
```

> ⚠️ **回调里的禁区**：回调运行在 lv_timer_handler 的轮询里，别在里面 HAL_Delay 长阻塞（界面会卡）；也别在回调里直接 `lv_obj_del` 正在触发事件的对象（会野指针），要用 `lv_obj_del_async` 推迟到下一轮再删（PDF 6.2.4 (PDF p.84)）。

## 动手练习（约 40 分钟）

### 练习 4.1：点击计数按钮

- 1️⃣ 按代码示例 1 实现点击计数，烧录验证：每点一次按钮，下方数字 +1。
- 2️⃣ 把回调里的 filter 从 `LV_EVENT_CLICKED` 换成 `LV_EVENT_ALL`，在回调里用 `lv_event_get_code` 分流：PRESSED 时把按钮文字改成"按住了"，RELEASED 时改回"点我"。
- 3️⃣ 在回调里打印每次事件的 code，串口观察：快速点一下，依次收到哪些事件？（提示：PRESSED → RELEASED → CLICKED）
- 4️⃣ 挑战：给按钮加 `LV_EVENT_LONG_PRESSED`，长按 1 秒清空计数（清零）。注意长按的默认判定时间是 400ms，搜索 `lv_conf.h` 里的 `LV_INDEV_DEF_LONG_PRESS_TIME` 改成长按 1 秒，感受"配置宏"的威力。

### 练习 4.2：2048 格子触摸响应（可选挑战）

- 1️⃣ 打开 `BSP/lvgl_2048.c`，找到创建格子的循环，给每个格子挂 `cell_cb` 回调（filter 用 LV_EVENT_ALL，user_data 带格子下标）。
- 2️⃣ 烧录后点击任意格子，串口观察行列号是否正确打印；配合 `LV_STATE_PRESSED` 样式，让格子按下时变色。
- 3️⃣ 进阶：把"点击格子"接到你的 2048 逻辑上——比如点击时调用滑动方向判断，或做一个"选中高亮"的交互（提示：用 lv_obj_add_state / lv_obj_clear_state 维护选中态）。
- 4️⃣ 思考：如果回调里用 `lv_event_get_current_target` 而不是 get_target，打印出来的对象有什么不同？试着在格子上方叠一个透明的父容器，把回调挂到容器上验证"事件冒泡"。

## 自测（答完再点答案）

### 随堂小测 1

Q1. "点一下按钮开灯"这个动作，应该监听哪个事件？
- A. LV_EVENT_PRESSED
- B. LV_EVENT_RELEASED
- C. LV_EVENT_CLICKED

<details>
<summary>查看答案</summary>

C。CLICKED 在释放且未滚动时触发，代表一次完整的"点击"；PRESSED 按下就触发，误触也会命中。
</details>

Q2. 滑块拖动后想读取新值，应该监听？
- A. LV_EVENT_VALUE_CHANGED
- B. LV_EVENT_SCROLL_BEGIN
- C. LV_EVENT_PRESS_LOST

<details>
<summary>查看答案</summary>

A。VALUE_CHANGED 在对象值变化时触发（滑块移动、开关切换），是"读新值"的标准入口。
</details>

Q3. 回调函数里怎么知道事件类型？
- A. lv_event_get_code(e)
- B. lv_event_get_target(e)
- C. lv_event_get_param(e)

<details>
<summary>查看答案</summary>

A。get_code 返回事件类型，配合 get_target/get_user_data 就能区分"是什么、谁触发的、带的什么数据"（PDF p.127）。
</details>

Q4. 在事件回调里想删除"自己"这个对象，安全做法是？
- A. lv_obj_del(obj)
- B. lv_obj_del_async(obj)
- C. lv_obj_clean(obj)

<details>
<summary>查看答案</summary>

B。del_async 推迟到下次 lv_timer_handler 再删，避免删掉正在处理事件的对象造成野指针（PDF p.84）。
</details>

## 推荐阅读

- 📖 正点原子《LVGL 开发指南 V1.5》第 6.8 节（事件，(PDF p.123~127)）——事件机制图、添加/删除事件、全部事件类型表、事件字段函数
- 🌐 [LVGL 官方文档：Events（v8.3）](https://docs.lvgl.io/8.3/overview/event.html)——事件类型全表、事件冒泡与 LV_EVENT_ALL 的用法
- 🌐 [LVGL 官方文档：Input devices（v8.3）](https://docs.lvgl.io/8.3/overview/indev.html)——触摸、按键、编码器三种输入设备的事件差异

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：[第 5 课：定时器与动画](/my-blog/posts/lvgl/0005-timers-and-animations/)——让界面"活"起来：呼吸灯、弹跳、数字滚动。

| [← 上一课](/my-blog/posts/lvgl/0003-styles/) | [课程目录](/my-blog/posts/lvgl/00-总览/) | [下一课 →](/my-blog/posts/lvgl/0005-timers-and-animations/) |