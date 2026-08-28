---
title: 空闲任务与低功耗 Tickless
published: 2026-08-27
description: FreeRTOS 课程第 16 课：空闲任务的角色与钩子函数写法、通用低功耗模式与 Tickless 模式的原理、配置与实验验证。
tags: [FreeRTOS, 嵌入式, RTOS, 空闲任务, 低功耗, Tickless]
category: FreeRTOS
draft: false
prevTitle: 综合项目 — LVGL × FreeRTOS 产品多任务架构
prevSlug: "freertos/0017-final-project"
nextTitle: 内存管理
nextSlug: "freertos/0015-memory-management"
---

# 空闲任务与低功耗 Tickless

这是 FreeRTOS 系列课程笔记的第 16 课：谁在 CPU 闲时兜底？空闲钩子怎么写？Tickless 模式怎么让系统"睡个好觉"？**本课目标：**看清系统里那个"最闲的人"——空闲任务：它由谁创建、优先级多低、替我们干了什么。掌握空闲任务钩子函数的写法与红线（不能阻塞），再上台阶理解 FreeRTOS 低功耗 Tickless 模式的原理与配置。学完你能给工程加"省电模式"，并用电流档验证效果。

---

## 1. 空闲任务详解：系统的"兜底者"

你从来没有创建过它，但它永远存在。调度器启动函数 `vTaskStartScheduler()` 在正式跑任务前，会**自动创建一个空闲任务**，名字是 `configIDLE_TASK_NAME`（默认 "IDLE"），栈大小 `configMINIMAL_STACK_SIZE`，优先级 `portPRIVILEGE_BIT`——展开就是 **0，系统中最低的优先级**，而且这个优先级不允许用户修改（PDF 19.1.2 节 PDF p.403）。

为什么必须有它？因为 **系统要保证任何时刻都至少有一个任务可运行**。所有任务都阻塞/挂起时，CPU 就交给空闲任务，它主要干两件事（PDF 19.1.1 节 PDF p.403）：

- **回收被删除任务的内存**：如果一个任务调用 `vTaskDelete(NULL)` 删除**自己**，删除工作没法在自身栈上完成（栈都要还回去了），这项收尾就交给空闲任务在下个周期处理。所以——删自己之后，务必保证空闲任务能分到运行时间，否则内存永远收不回来。
- **进入低功耗**：既然没有正经事干，不如让 CPU 睡觉（见第 4 节 Tickless）。

---

## 2. 空闲任务钩子函数：给"闲时"挂个回调

FreeRTOS 提供多种钩子函数（hook），系统运行到特定位置会自动调用你写的钩子。空闲钩子的开关是 `configUSE_IDLE_HOOK`，置 1 后，空闲任务**每个运行周期**都会调用一次 `vApplicationIdleHook()`，由你实现（PDF 19.2 节 PDF p.405）。

钩子函数有三条铁律：

- **绝对不能阻塞**：不能调用 `vTaskDelay()`、不能在队列/信号量上等待。空闲任务一阻塞，系统就没有可运行任务了，调度器直接慌掉。教材原话：无论在什么时候，系统都应该保证有一个正在被执行的任务。
- **尽量短小**：它抢占的是"空闲时间"，干太久等于偷走别的任务的运行机会（虽然优先级最低，但会在调度点被打断）。
- 如果想在空闲优先级干更重的活，正路是**创建一个同为优先级 0 的任务**，而不是把钩子写胖（代价是多耗一份 RAM）。

```c
/* 空闲钩子骨架：只做极轻量的统计工作 */
volatile uint32_t idle_enter_count = 0;   /* 空闲进入次数（全局，供其他任务查看） */

void vApplicationIdleHook(void)
{
    idle_enter_count++;                   /* 每进一次空闲任务计数一次 */
    /* 注意：这里绝对不能调用 vTaskDelay() 等会阻塞的函数 */
}
```

---

## 3. 空闲钩子实验：通用低功耗模式

教材实验 19 展示了空闲钩子的经典用途——**通用低功耗模式**：只要进入空闲任务，就让 CPU 睡一觉（`__wfi()`），醒来继续。睡眠前后还可以用钩子关掉/打开外设时钟进一步省电（PDF 19.3 节 PDF p.407）：

```c
/* 教材实验 19：在空闲钩子里进睡眠（通用低功耗，所有 RTOS 通用） */
void BeforeEnterSleep(void)
{
    /* 关闭部分外设时钟，仅作演示，按你的工程实际裁剪 */
    __HAL_RCC_GPIOA_CLK_DISABLE();
    __HAL_RCC_GPIOB_CLK_DISABLE();
    __HAL_RCC_GPIOC_CLK_DISABLE();
    __HAL_RCC_GPIOD_CLK_DISABLE();
    __HAL_RCC_GPIOE_CLK_DISABLE();
    __HAL_RCC_GPIOF_CLK_DISABLE();
    __HAL_RCC_GPIOG_CLK_DISABLE();
}

void AfterExitSleep(void)
{
    /* 退出睡眠后恢复外设时钟 */
    __HAL_RCC_GPIOA_CLK_ENABLE();
    __HAL_RCC_GPIOB_CLK_ENABLE();
    __HAL_RCC_GPIOC_CLK_ENABLE();
    __HAL_RCC_GPIOD_CLK_ENABLE();
    __HAL_RCC_GPIOE_CLK_ENABLE();
    __HAL_RCC_GPIOF_CLK_ENABLE();
    __HAL_RCC_GPIOG_CLK_ENABLE();
}

void vApplicationIdleHook(void)
{
    __disable_irq();                      /* 进睡眠前关中断 */
    __dsb(portSY_FULL_READ_WRITE);
    __isb(portSY_FULL_READ_WRITE);

    BeforeEnterSleep();
    __wfi();                              /* 睡到下一个中断（如 SysTick） */
    AfterExitSleep();

    __dsb(portSY_FULL_READ_WRITE);
    __isb(portSY_FULL_READ_WRITE);
    __enable_irq();                       /* 醒来开中断 */
}
```

> ⚠️ 通用低功耗模式有一个硬伤：**每次 SysTick 中断都会把 CPU 叫醒**，哪怕接下来根本没事做。睡得浅、醒得勤，省电效果有限。这正是 FreeRTOS 推出 Tickless 模式的原因——下面就来对比。

---

## 4. Tickless 低功耗模式：原理

Tickless 的思路是：既然马上没有任务要跑，那**连 tick 都别跳了**——停掉 SysTick，让 CPU 一次睡到"下一个任务该醒的时刻"，醒了再补偿丢失的 tick（PDF 18.1 节 PDF p.394）。整个流程在空闲任务内部完成：

1. 空闲任务先调用 `prvGetExpectedIdleTime()` 估算能睡多久（取"最近一个阻塞任务苏醒时刻 − 当前时刻"）；
2. 只有估算时长 ≥ `configEXPECTED_IDLE_TIME_BEFORE_SLEEP`（默认 2，**不能小于 2**）才值得睡；
3. 挂起调度器后再算一次（这次准），调 `configPRE_SLEEP_PROCESSING()` 做睡前收尾；
4. 调用 `portSUPPRESS_TICKS_AND_SLEEP(xExpectedIdleTime)`——这个宏在 Cortex-M 上展开为 `vPortSuppressTicksAndSleep()`：关 SysTick、`__wfi()` 入睡、唤醒后**用硬件定时器补偿漏掉的 tick**（ARM_CM4F 移植层默认用 SysTick 自身的计数器或者低功耗定时器，教材源码里 `ulTimerCountsForOneTick` 等变量就是为此准备的）；
5. 醒来后 `configPOST_SLEEP_PROCESSING()` 恢复现场，调度器恢复。

关键在于"**补偿 tick**"：睡觉期间 SysTick 停了，但 `xTickCount` 不能停，否则所有延时都错乱。所以唤醒时必须把"睡掉的时间"换算成 tick 数一次性补上——这就是为什么 Tickless 需要硬件定时器配合。

---

## 5. Tickless 配置与实验

FreeRTOSConfig.h 里开 3 个东西就齐活（教材实验 18 PDF p.398）：

```c
/* ===== FreeRTOSConfig.h 中开启 Tickless ===== */
/* 1: 使能 tickless 低功耗模式, 默认: 0 */
#define configUSE_TICKLESS_IDLE 1

#if (configUSE_TICKLESS_IDLE != 0)
#include "freertos_demo.h"
/* 进入低功耗模式前执行的函数（关外设时钟等） */
extern void PRE_SLEEP_PROCESSING(void);
#define configPRE_SLEEP_PROCESSING(x)  PRE_SLEEP_PROCESSING()
/* 退出低功耗模式后执行的函数（恢复外设时钟等） */
extern void POST_SLEEP_PROCESSING(void);
#define configPOST_SLEEP_PROCESSING(x) POST_SLEEP_PROCESSING()
#endif

/* configEXPECTED_IDLE_TIME_BEFORE_SLEEP 不定义就用默认值 2
 * （FreeRTOS.h 里默认定义，且强制 >= 2） */
```

配套实验任务用 LED 指示状态（教材实验 18 的 task1）：`delay_ms(3000)` 忙等期间 CPU 满负荷跑（LED 灭），`vTaskDelay(3000)` 阻塞期间空闲任务接管（LED 亮），此时系统进入睡眠——用功率计/电流档量两个阶段的板卡电流，差值就是省下的电。教材实测：开启 Tickless 后系统整体功耗明显下降（具体数值因测量环境而异，PDF p.401）。

```c
/* 教材实验 18 的 task1：忙等 vs 阻塞，交替出现，便于对比功耗 */
void task1(void *pvParameters)
{
    while (1)
    {
        LED0(1);            /* LED 灭：CPU 忙延时，不会进入低功耗 */
        delay_ms(3000);     /* 忙等 3 秒（裸机延时，不触发切换） */
        LED0(0);            /* LED 亮：进入阻塞，空闲任务接管 → 睡觉 */
        vTaskDelay(3000);   /* 阻塞延时 3 秒（期间进入 Tickless 睡眠） */
    }
}
```

> 💡 谁的功劳最大？**别只看 Tickless 配置**。省电的三个层次：任务尽量多阻塞（少忙等）→ 睡眠时关外设时钟（PRE/POST_SLEEP_PROCESSING）→ CPU 进深睡眠模式（改 PWR 寄存器或调用 HAL 的 SLEEP/STOP 模式）。Tickless 只解决"tick 补偿"，真正的大头常常在你关了多少外设。

---

## 动手练习

### 练习 16.1：空闲钩子计数实验——"数"出 CPU 的闲忙

- 1️⃣ 在你的 FreeRTOS 分支工程里把 `configUSE_IDLE_HOOK` 置 1，实现第 2 节的 `vApplicationIdleHook()`，给全局计数变量 `idle_enter_count` 自增。
- 2️⃣ 开一个 100ms 周期的任务，每次打印 `idle_enter_count` 的增量，以及用 `uxTaskGetSystemState` 或运行时间统计观察各任务占用率（教材 11.3 节的思路）。
- 3️⃣ 先让其他任务都 `vTaskDelay` 阻塞，记录每秒空闲计数；再改成一个任务忙等（不延时），看计数怎么变。**观察什么：**空闲计数 = CPU 空闲程度的"心电图"——任务越闲，计数涨得越快。

### 练习 16.2：开启 Tickless，用电流档验证功耗变化

- 1️⃣ 按第 5 节配置把 `configUSE_TICKLESS_IDLE` 置 1，实现 PRE/POST_SLEEP_PROCESSING（先只关几个 GPIO 时钟即可，别把系统用到的外设关了）。
- 2️⃣ 复刻教材 task1 的"忙等 3 秒 ↔ 阻塞 3 秒"交替节奏，LED 指示状态。
- 3️⃣ 万用表电流档（或功率计）串进供电回路：**观察什么：**分别记录 LED 灭（忙等）与 LED 亮（Tickless 睡眠）两阶段的电流；再对比第 3 节通用低功耗钩子方案的数据，验证"Tickless 比通用低功耗更省"（教材 p.401 的对比结论）。
- 4️⃣ 进阶（可选）：把 `configPRE_SLEEP_PROCESSING` 里关更多外设时钟（USART、SPI 等），看电流还能降多少——注意别把睡眠后要用的外设关了。

---

## 自测

### 随堂小测 1

空闲任务是由谁创建的？

- A. 用户在 main 里手动创建
- B. vTaskStartScheduler() 自动创建
- C. 第一个任务创建时顺带创建

<details>
<summary>查看答案</summary>

B。调度器启动函数 vTaskStartScheduler() 在运行前自动创建空闲任务（PDF p.403）。
</details>

### 随堂小测 2

空闲任务的优先级是？

- A. 与用户任务相同，可自行修改
- B. 最高优先级，保证系统不卡
- C. 0，最低优先级，且不可修改

<details>
<summary>查看答案</summary>

C。空闲任务优先级为 portPRIVILEGE_BIT 即 0，最低且用户不能改（PDF p.404）。
</details>

### 随堂小测 3

空闲任务钩子函数里绝对不能做的事是？

- A. 读取全局变量计数
- B. 调用 vTaskDelay() 阻塞自己
- C. 翻转一个 LED

<details>
<summary>查看答案</summary>

B。钩子里不能调用会阻塞/挂起空闲任务的函数，否则系统将没有可运行任务（PDF p.405）。
</details>

### 随堂小测 4

configEXPECTED_IDLE_TIME_BEFORE_SLEEP 允许的最小值是？

- A. 0，可以无限小
- B. 1，一个 tick 也值得睡
- C. 2，定义小于 2 会编译报错

<details>
<summary>查看答案</summary>

C。FreeRTOS.h 里默认定义为 2，且强制 #error 拦截小于 2 的配置（PDF p.398）。
</details>

---

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 18 章 Tickless（PDF p.394~402）+ 第 19 章空闲任务（PDF p.403~410）——本课全部依据
- 🌐 [FreeRTOS 官方文档：Low Power Support](https://www.freertos.org/low-power-tickless-rtos.html)——Tickless 模式原理与移植要点
- 🌐 [Mastering the FreeRTOS Real Time Kernel](https://www.freertos.org/Documentation/RTOS_book.html)——官方书 Chapter 7 Low Power Support，讲 Tickless 的补偿机制最清楚

---

## 下一步

下一课预告：第 17 课——综合项目（收官课）。把 LVGL 第 12 课的"智能设备控制台"搬上 FreeRTOS：GUI 任务化、采集任务、队列通信、验收清单一次配齐。有任何不清楚的地方，直接问我（Agent 就是你的老师）。

| [← 上一课](/my-blog/posts/freertos/0015-memory-management/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0017-final-project/) |
| --- | --- | --- |