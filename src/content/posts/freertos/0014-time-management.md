---
title: 时间管理
published: 2026-08-25
description: FreeRTOS 课程第 14 课：系统时钟节拍从哪来、vTaskDelay 相对延时与 vTaskDelayUntil 绝对延时的本质区别，以及周期任务为什么必须用 vTaskDelayUntil。
tags: [FreeRTOS, 嵌入式, RTOS, 时间管理, vTaskDelay, vTaskDelayUntil]
category: FreeRTOS
draft: false
prevTitle: 内存管理
prevSlug: "freertos/0015-memory-management"
nextTitle: 中断管理与临界区
nextSlug: "freertos/0013-interrupts-and-critical-sections"
---

# 时间管理

这是 FreeRTOS 系列课程笔记的第 14 课：系统时钟节拍、vTaskDelay 相对延时与 vTaskDelayUntil 绝对延时——让任务"准点上班"。**本课目标：**搞清楚三件事：FreeRTOS 的"心跳"（系统时钟节拍）从哪来、怎么跳；`vTaskDelay()` 和 `vTaskDelayUntil()` 有什么本质区别；为什么周期任务必须用 `vTaskDelayUntil()`。学完你能用示波器验证"相对延时会漂、绝对延时不漂"这个关键差异。

---

## 1. 系统时钟节拍：RTOS 的"心跳"

FreeRTOS 靠一个全局计数器 `xTickCount` 记录"现在是什么时刻"，它在 `tasks.c` 里定义，初值由 `configINITIAL_TICK_COUNT` 决定（通常为 0）。每次系统时钟节拍中断发生，`xTickCount` 就加 1。所有延时、超时、时间片轮转，都建立在这个计数器上（PDF 12.1.1 节 PDF p.211）。

节拍中断从哪来？教材配套例程用 **SysTick** 作为节拍源（当然你也可以换成别的定时器）。注意一个容易踩坑的细节：`delay_init()` 先配置了 SysTick 用于裸机阻塞延时，但调度器启动时 `xPortStartScheduler() → vPortSetupTimerInterrupt()` 会**重新配置 SysTick 并覆盖之前的设置**。另外 STM32F1 系列 SysTick 时钟源是 CPU 的 1/8，需要在 FreeRTOSConfig.h 里定义 `configSYSTICK_CLOCK_HZ (configCPU_CLOCK_HZ / 8)`；你的 F407 时钟源与 CPU 同频，不用定义这个宏（PDF 12.1.2 节 PDF p.211）。

节拍频率由 `configTICK_RATE_HZ` 决定，教材工程设为 **1000**，即 1 个 tick = 1 毫秒。每来一次 SysTick 中断，中断服务函数就调用 `xPortSysTickHandler()`，最终由 `xTaskIncrementTick()` 完成三件大事（PDF 12.1.3 节 PDF p.213）：

1. **节拍计数**：`xTickCount` 加 1；若溢出则切换两个阻塞态任务列表（这是 FreeRTOS 解决 tick 溢出问题的手段）。
2. **检查阻塞任务**：阻塞态任务列表按"唤醒时刻"排序，所以只需从表头检查到第一个未超时的任务即可停止（由 `xNextTaskUnblockTime` 加速）。超时的任务从阻塞列表移除、加入就绪列表。
3. **决定是否切换**：如果超时任务的优先级 ≥ 当前任务（抢占式调度），或同优先级还有别的就绪任务（时间片调度），就标记需要切换，挂起 PendSV 异常——等当前中断处理完，PendSV 服务函数里才真正完成切换。

```c
/* ===== 你的 FreeRTOS 分支工程里 SysTick_Handler（delay.c 中） ===== */
void SysTick_Handler(void)
{
    HAL_IncTick();                          /* 给 HAL 库的毫秒计数，别删 */

    /* 调度器跑起来之后，才处理 FreeRTOS 的节拍事务 */
    if (xTaskGetSchedulerState() != taskSCHEDULER_NOT_STARTED)
    {
        xPortSysTickHandler();              /* FreeRTOS 节拍处理入口 */
    }
}

/* xPortSysTickHandler() 内部逻辑（port.c，思路示意）：
 * 1. 屏蔽受 FreeRTOS 管理的中断（SysTick 优先级最低，防被打扰）
 * 2. xTaskIncrementTick()：xTickCount+1，唤醒超时阻塞任务，判断时间片
 * 3. 返回 pdTRUE 就挂起 PendSV，中断全部退出后再切换任务
 */
```

> 💡 理解"tick 中断只做标记、PendSV 才做切换"很重要：切换动作被推迟到所有高优先级中断处理完之后，这保证了中断的实时性，也是第 13 课中断与临界区知识的延伸。

---

## 2. vTaskDelay()：相对延时

`vTaskDelay(xTicksToDelay)` 让**调用它的任务**阻塞指定的节拍数，单位是 tick 而不是毫秒（需要 `INCLUDE_vTaskDelay` 配置为 1）。它的本质是调用 `prvAddCurrentTaskToDelayedList()`，把当前任务从就绪列表摘下来，算好唤醒时刻 `xTimeToWake = xTickCount + xTicksToDelay` 后挂进阻塞态任务列表（若溢出则挂进溢出列表），然后触发一次任务切换（PDF 12.2.1 节 PDF p.219）。

三个要点：

- **相对时间**：从"调用该函数的那一刻"开始算延时。任务体执行多久，唤醒时刻就跟着往后漂多少——周期任务用它，周期必然抖动。
- **传 0 不是延时 0**：`vTaskDelay(0)` 不阻塞任务，只强制切换一次（让出 CPU），常用于同优先级任务间主动让位。
- **单位换算**：别手写 `vTaskDelay(100)` 就当 100ms——一旦有人把 `configTICK_RATE_HZ` 改成 200，语义就变了。官方推荐用 `pdMS_TO_TICKS(100)` 宏换算，语义一目了然。

```c
/* 100ms 周期翻转 LED：用 vTaskDelay 实现（周期会受任务体耗时影响） */
void led_task(void *pvParameters)
{
    while (1)
    {
        LED0_TOGGLE();
        do_extra_work();                    /* 假设这里耗时不定（模拟真实任务） */
        vTaskDelay(pdMS_TO_TICKS(100));     /* 从"调用时刻"起延时 100ms */
    }
}
```

---

## 3. vTaskDelayUntil()：绝对延时

`vTaskDelayUntil()` 实际上是个宏，展开后调用 `xTaskDelayUntil()`（需要 `INCLUDE_vTaskDelayUntil` 配置为 1）。它不关心"现在"，只关心**上一次唤醒时刻**：唤醒时间 `xTimeToWake = *pxPreviousWakeTime + xTimeIncrement`，阻塞结束后再把基准更新为这次唤醒时刻（PDF 12.2.2 节 PDF p.224）。

这意味着：只要任务体执行时间不超过一个周期，任务就会**精确地按固定节拍周期执行**，任务体耗时的波动不会累积成周期漂移。用法上必须注意：

- `xLastWakeTime` 首次使用前要初始化为当前 tick（`xTaskGetTickCount()`），之后**永远不要手动改它**，由函数内部维护。
- 任务体耗时如果超过一个周期，`vTaskDelayUntil` 会"追不上"基准，表现为直接跳过一次阻塞（源码里溢出判断后可能不延时直接返回），周期任务就退化成忙跑——设计任务体时要留足余量。

```c
/* 100ms 绝对周期任务：无论任务体执行多久，唤醒点始终是 100ms 的整数倍 */
void periodic_task(void *pvParameters)
{
    TickType_t xLastWakeTime = xTaskGetTickCount(); /* 首次基准：当前时刻 */

    while (1)
    {
        do_something();                     /* 任务体，耗时可长可短 */

        /* 阻塞到 xLastWakeTime + 100ms，并自动把 xLastWakeTime 更新为本次唤醒点 */
        vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(100));
    }
}
```

---

## 4. 两者对比与选型

| 维度 | vTaskDelay() | vTaskDelayUntil() |
| --- | --- | --- |
| 时间基准 | 从**调用时刻**起算（相对） | 从**上一次唤醒时刻**起算（绝对） |
| 周期精度 | 任务体耗时越长，周期越漂 | 任务体耗时 < 周期时，周期恒定 |
| 适用场景 | 单次延时、非周期性等待、按键消抖等 | 固定周期的周期性任务（采集、刷屏、心跳） |
| 需要维护的变量 | 无 | `xLastWakeTime` 基准，由函数内部维护 |
| 参数 | `xTicksToDelay` | `pxPreviousWakeTime` + `xTimeIncrement` |

选型一句话：**周期任务必须用 `vTaskDelayUntil()`**。哪怕你现在觉得任务体"执行时间恒定"，加需求、改代码后它也会漂——用绝对延时是从一开始就杜绝这类隐患。教材配套的延时实验例程里，两个任务分别用两种延时翻转 LED，示波器上一对比，周期误差的差别一目了然。

---

## 5. xTaskAbortDelay()：中途取消延时

`xTaskAbortDelay(xTask)` 可以**终止一个处于阻塞态任务的延时**，把它从阻塞列表中移除并加入就绪列表（需要 `INCLUDE_xTaskAbortDelay` 配置为 1，PDF 12.2.3 节 PDF p.227）。注意三点：

- 只有目标任务**正处于阻塞态**时才成功（返回 `pdPASS`），否则返回 `pdFAIL`。
- 它终止的不只是延时，也包括任务因"等待事件（队列/信号量）"而进入的阻塞。
- 被中断阻塞的任务会通过 TCB 里的 `ucDelayAborted` 标志知道"我是被中断的"，从而决定是否重试等待。

它的典型用途：系统收到关机/复位命令时，把正在做长延时的任务提前叫醒去做收尾工作。日常开发用得不多，知道存在即可。

---

## 6. 延时实验：用示波器看周期抖动

教材配套《实验 12 任务延时实验》：start_task 创建 task1/task2 两个任务，各自翻转 LED 并打印运行计数。把示波器或逻辑分析仪夹到 LED 引脚上，你能直接数出两种延时函数的周期差异。本课练习就带你做这件事，而且更狠一点——刻意加长任务体，让漂移"现形"。

> ⚠️ **tick 是 tick，毫秒是毫秒**：所有延时 API 的单位都是系统时钟节拍，不是毫秒。换算请一律走 `pdMS_TO_TICKS()` 宏。改 `configTICK_RATE_HZ` 会全局改变时间语义，改之前先想清楚你的延时任务会不会跟着变快/变慢。

---

## 动手练习

### 练习 14.1：vTaskDelay 的 100ms 周期任务——先看它怎么漂

- 1️⃣ 在你的 FreeRTOS 分支工程里新建两个任务（优先级相同），任务 A 用 `vTaskDelay(pdMS_TO_TICKS(100))` 翻转 LED0，任务 B 用 `vTaskDelay(pdMS_TO_TICKS(100))` 翻转 LED1。
- 2️⃣ 给任务 A 的任务体里加一段耗时约 10ms 的忙等（比如循环做几千次加法），再烧录。
- 3️⃣ 示波器/逻辑分析仪夹在 LED0 上测周期。**观察什么：**理论 100ms 的周期，实测比 100ms 大多少？这个差值就是"任务体耗时"造成的相对延时漂移。

### 练习 14.2：vTaskDelayUntil 的 100ms 周期任务——漂移消失

- 1️⃣ 把任务 A 的延时换成 `vTaskDelayUntil()` 写法（参考第 3 节模板，`xLastWakeTime` 用 `xTaskGetTickCount()` 初始化），保持同样的 10ms 忙等。
- 2️⃣ 再次用示波器测 LED0 周期，并连续观察 1 分钟以上（让误差累计到可见）。
- **观察什么：**周期应精确回到 100ms 附近，且长时间运行不累积漂移；对比练习 14.1 的数据，在笔记里写一句结论：为什么周期任务必须用 vTaskDelayUntil。
- 3️⃣ 加餐题：把忙等加到 120ms（超过周期）会发生什么？为什么？（提示：源码里溢出判断的逻辑——基准追不上了）

---

## 自测

### 随堂小测 1

每次系统时钟节拍中断里，最终决定"是否要切换任务"的关键函数是？

- A. vTaskDelay()
- B. xTaskIncrementTick()
- C. vPortSetupTimerInterrupt()

<details>
<summary>查看答案</summary>

B。xTaskIncrementTick() 完成节拍计数、唤醒超时阻塞任务、检查时间片，返回是否需要切换（PDF p.213）。
</details>

### 随堂小测 2

vTaskDelay(0) 的效果是？

- A. 任务永远阻塞
- B. 不阻塞，仅强制切换一次让出 CPU
- C. 延时 0 个 tick，立即返回

<details>
<summary>查看答案</summary>

B。xTicksToDelay 为 0 时不进阻塞列表，只触发一次任务切换（PDF p.220）。
</details>

### 随堂小测 3

周期任务选择 vTaskDelayUntil 的根本原因是？

- A. 它延时更省 CPU
- B. 它相对上一次唤醒时刻计算，任务体耗时不会让周期漂移
- C. 它的参数不用换算成 tick

<details>
<summary>查看答案</summary>

B。vTaskDelayUntil 以 xLastWakeTime 为基准做绝对延时，固定周期不受任务执行时间影响（PDF p.226）。
</details>

### 随堂小测 4

xTaskAbortDelay(xTask) 成功的前提是？

- A. 目标任务正阻塞在延时或等待事件上
- B. 目标任务正在运行
- C. 目标任务处于挂起态

<details>
<summary>查看答案</summary>

A。只有目标任务处于阻塞态（延时阻塞或等待事件阻塞）时返回 pdPASS，否则返回 pdFAIL（PDF p.227）。
</details>

---

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 12 章（PDF p.211~229）——本课全部依据，源码逐行分析值得细读
- 🌐 [FreeRTOS 官方 API：vTaskDelay()](https://www.freertos.org/a00127.html)——官方定义与使用示例
- 🌐 [Mastering the FreeRTOS Real Time Kernel](https://www.freertos.org/Documentation/RTOS_book.html)——官方免费书，Chapter 4 Task Management 有 vTaskDelayUntil 的经典讲解

---

## 下一步

下一课预告：第 15 课——内存管理。你将看到 FreeRTOS 的 5 种堆算法（heap_1~heap_5）各自的取舍，以及怎么用 xPortGetFreeHeapSize 给工程"称重"。有任何不清楚的地方，直接问我（Agent 就是你的老师）。

| [← 上一课](/my-blog/posts/freertos/0013-interrupts-and-critical-sections/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0015-memory-management/) |
| --- | --- | --- |