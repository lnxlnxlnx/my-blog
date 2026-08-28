---
title: LVGL 是怎么转起来的
published: 2026-08-17
description: 第 1 课：认识 LVGL 的运行模型——初始化、驱动注册、时基、任务引擎四个环节，以及 lv_conf.h 的配置与裁剪。这是后续所有课程的基石。
tags: [LVGL, 嵌入式, GUI, 运行模型, lv_conf]
category: LVGL
draft: false
prevTitle: 对象系统与屏幕
prevSlug: "lvgl/0002-objects-and-screens"
nextTitle: ""
nextSlug: ""
---

# LVGL 是怎么转起来的

认识 LVGL 的运行模型：初始化 → 驱动注册 → 时基 → 任务循环。

**本课目标：**你已经在工程里跑过 LVGL（2048、贪吃蛇都是它画的），但"能跑"和"懂它怎么转"是两回事。学完本课，你能闭着眼说出 LVGL 在 MCU 上的四个运行环节，并知道工程里每一环对应哪行代码。这是后续所有课程的基石。

## 1. LVGL 是个什么东西

LVGL（Light and Versatile Graphics Library）是一个纯 C 编写的开源图形库。它的定位是：**让任何 MCU + 任何屏幕的组合，都能拥有媲美手机的 GUI**。它跟你直接操作 LCD 写像素的区别，就像 Windows 和裸跑汇编一样——你只负责"摆控件、写逻辑"，画像素、刷新、事件分发这些脏活它全包了。

硬件要求非常低（正点原子《LVGL 开发指南 V1.5》第 1.2 节 (PDF p.26)）：

| 资源 | 最低要求 | 你的 F407 |
|------|----------|-----------|
| MCU | 16/32/64 位，主频 > 16 MHz | Cortex-M4 @ 168 MHz ✅ |
| Flash | > 64 kB（部件多推荐 > 180 kB） | 1 MB ✅ |
| RAM | 8 kB（建议 24 kB） | 192 kB ✅ |
| 显示屏 | 8/16/24/32 位色深等，满足其一即可 | 320×240 RGB565（16 位）✅ |

你不需要知道 LVGL 内部怎么画圆弧、怎么裁剪区域——那是库的事。你需要知道的是**它和你之间那个"循环"长什么样**，这就是本课的主角。

## 2. 运行模型：四个环节，缺一不可

LVGL 在裸机上的运行模型极其简单，官方文档把它拆成 4 步（PDF 第 5.1 节 (PDF p.64)）：

1. **初始化库**：`lv_init()` — 内存池、定时器、样式系统等全部就位
2. **注册驱动**：`lv_port_disp_init()` / `lv_port_indev_init()` — 告诉 LVGL"屏幕多大、怎么刷，触摸怎么读"
3. **喂时基**：周期调用 `lv_tick_inc(ms)` — LVGL 靠它知道"现在几点了"，动画、超时都靠它
4. **转任务**：不断调用 `lv_timer_handler()` — 一切的"引擎"，事件处理、动画推进、屏幕重绘都发生在这里

> 💡 用一句话记：**初始化一次，然后"时基在中断里滴答，引擎在主循环里转"**。LVGL 不是中断驱动的，它是轮询式的——你不调 `lv_timer_handler`，屏幕就永远不动。

你工程里对应的代码（打开看看，逐行对照）：

```c
// Core/Src/main.c
lv_init();              // ① 初始化库
lv_port_disp_init();    // ② 注册显示驱动（触摸注册在 lv_port_indev_init，你工程里由 GuiMenu_Init 一带而过）

// 主循环 while(1) 里：
lv_timer_handler();     // ④ 任务引擎（main.c:252）
HAL_Delay(5);           // 轮询周期 ~5ms，正好在官方建议的 5ms 内

// Core/Src/stm32f4xx_it.c — SysTick 中断
lv_tick_inc(1);         // ③ 时基：每 1ms 喂一次（stm32f4xx_it.c:198）
```

### 为什么 LVGL 要"自己的时基"？

LVGL 的动画、滚动回弹、长按判定都需要时间概念。它不用你的 `HAL_GetTick()`，而是自己维护一个计数器（`lv_tick_get()` 可读，`lv_tick_elaps(prev)` 算差值，PDF 第 5.5 节 (PDF p.78)）。这样它就完全独立于任何 RTOS 或 HAL，想移植到哪都行。

## 3. 任务引擎里到底发生了什么

`lv_timer_handler()` 每次调用会做三件事（PDF 第 5.6 节 (PDF p.78)）：

1. 读一次输入设备（你的触摸屏）
2. 跑一遍所有到期的 LVGL 定时器/动画（推进一帧）
3. 如果屏幕脏了，重绘需要刷新的区域并交给 `flush_cb` 推到 LCD

关键特性：**非抢占、轮询式**。它不像 RTOS 任务会"掐点"执行，而是你 5ms 内叫它一次它就动一下。所以：

- 主循环里千万别放 `HAL_Delay(100)` 之类的长阻塞，否则界面会"卡死"——不是死机，是引擎没转
- 你的游戏逻辑（贪吃蛇的 `lvgl_snake_step()`）在按键时才动，但画面一直在被引擎重绘——这就是为什么感觉"实时"

> ⚠️ **中断红线**：除了 `lv_tick_inc` 和 `lv_disp_flush_ready`，不要在中断里调用任何 LVGL 函数（PDF 第 5.7 节 (PDF p.80)）。引擎轮询到一半被打断，对象树可能处于不一致状态，轻则花屏，重则硬错。

## 4. 认识 lv_conf.h：你的"配置与剪刀"

`lv_conf.h`（工程在 `EXTERNAL/LVGL/lv_conf.h`）是用户级文件，不属于内核。它有两大功能（PDF 第 5.2 节 (PDF p.64)）：

- **配置**：颜色深度、内存池大小、刷新周期
- **裁剪**：关掉不用的部件/功能，省 Flash 和 RAM

全文件 10 个板块，最常用的三个：

| 板块 | 关键宏 | 含义 |
|------|--------|------|
| 颜色设置 | `LV_COLOR_DEPTH 16` | RGB565，跟你的屏幕匹配；改错会花屏 |
| 内存设置 | `LV_MEM_SIZE` | LVGL 内置内存池大小。对象、样式、动画全从这里分配 |
| HAL 设置 | `LV_DISP_DEF_REFR_PERIOD` `LV_INDEV_DEF_READ_PERIOD` | 刷新周期（默认 30ms ≈ 33fps）、输入读取周期（默认 30ms） |

> 💡 内存是嵌入式 GUI 的命门。LVGL 给每个对象、样式、动画分配内存都从 `LV_MEM_SIZE` 这块池子里出，池子耗尽就会在串口打印 `lv_mem_alloc: out of memory`。先记住这个症状，后面课会教你"治"它。

## 动手练习（约 20 分钟）

### 练习 1.1：在工程里指认四个环节

- 1️⃣ 打开 `Core/Src/main.c`，找到 `lv_init()`、`lv_port_disp_init()`、`lv_timer_handler()` 三处调用，确认它们在初始化段和主循环里的位置。
- 2️⃣ 打开 `Core/Src/stm32f4xx_it.c`，找到 `lv_tick_inc(1)`，确认它在 SysTick 中断里。
- 3️⃣ 把 `lv_timer_handler()` 那行注释掉，烧录，观察现象；再恢复。用一句话回答：发生了什么？为什么？

### 练习 1.2：体验 lv_conf.h 的"剪刀"

- 1️⃣ 打开 `EXTERNAL/LVGL/lv_conf.h`，找到 `LV_LOG_LEVEL`（特征设置板块），改成 `LV_LOG_LEVEL_NONE`，编译烧录，对比串口输出。
- 2️⃣ 找 `LV_USE_LABEL` 之类的部件使能宏，临时把 `LV_USE_CHART` 置 0，编译一次，看 Flash 占用下降多少（Build 输出里看）。记得改回来。
- 3️⃣ 思考题：为什么部件使能宏能省 Flash？它省的是什么？（提示：链接器只链接被调用的函数）

## 自测（答完再点答案）

### 随堂小测 1

Q1. LVGL 在裸机上的驱动方式是？
- A. 纯中断驱动，事件一到就打断主程序
- B. 轮询驱动，靠周期调用 lv_timer_handler() 推进
- C. 前后台混合，一半中断一半轮询

<details>
<summary>查看答案</summary>

B。非抢占、轮询式（PDF p.78），5ms 内调用一次保持响应。
</details>

Q2. lv_tick_inc(1) 的正确放置位置是？
- A. 主循环 while(1) 里每轮调用
- B. 任意中断里，频率随意
- C. 固定频率的中断里（如 SysTick），每毫秒一次

<details>
<summary>查看答案</summary>

C。时基必须准确、固定频率（你工程里是 SysTick 1ms 一次）。主循环调用会造成时间跳跃，动画会忽快忽慢。
</details>

Q3. 下面哪个函数可以安全地在中断里调用？
- A. lv_obj_create()
- B. lv_tick_inc()
- C. lv_timer_handler()

<details>
<summary>查看答案</summary>

B。中断红线：只有 lv_tick_inc 和 lv_disp_flush_ready 例外（PDF p.80）。
</details>

Q4. 界面"卡死"（画面不动、按键无响应），最可能的原因是？
- A. LVGL 内存池耗尽，自动停止工作
- B. 主循环里出现长阻塞，lv_timer_handler() 没被及时调用
- C. 屏幕背光烧了

<details>
<summary>查看答案</summary>

B。引擎没转，界面自然不动。内存耗尽的表现是串口报 out of memory，界面照常转。
</details>

## 推荐阅读

- 📖 正点原子《LVGL 开发指南 V1.5》第 1 章（初识 LVGL，PDF p.25）和第 5 章（移植相关知识，PDF p.64）——本课全部依据
- 🌐 [LVGL 官方文档 Quick Overview（v8.3）](https://docs.lvgl.io/8.3/get-started/quick-overview.html)——英文原文，看"Hello world"那节加深印象

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：[第 2 课：对象系统](/my-blog/posts/lvgl/0002-objects-and-screens/)——屏幕上的万物都是"对象"，学完你就懂 lv_obj 的来龙去脉。

| — | [课程目录](/my-blog/posts/lvgl/00-总览/) | [下一课 →](/my-blog/posts/lvgl/0002-objects-and-screens/) |