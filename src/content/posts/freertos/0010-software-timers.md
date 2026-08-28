---
title: 软件定时器
published: 2026-08-21
description: FreeRTOS 课程第 10 课：软件定时器的角色、命令队列机制、休眠/运行两种状态与核心 API，以及单次/周期双定时器实验。
tags: [FreeRTOS, 嵌入式, RTOS, 软件定时器, 回调函数]
category: FreeRTOS
draft: false
prevTitle: 事件标志组
prevSlug: "freertos/0011-event-groups"
nextTitle: 信号量
nextSlug: "freertos/0009-semaphores"
---

# 软件定时器

这是 FreeRTOS 系列课程笔记的第 10 课：不用占用任务，也能周期干活——软件定时器与它的"服务任务"。**本课目标：**软件定时器是"挂在系统上"的定时器——不占任务名额，超时了由内核替你调用回调函数。学完你能说清：它跑在哪个任务里、命令是怎么传过去的、单次与周期定时器差在哪，并且能手写一个双定时器实验（正点原子《FreeRTOS 开发指南 V1.12》第 15 章 PDF p.326~340）。

---

## 1. 软件定时器是个什么角色

回想第 3 课学的硬件定时器（TIM）：它是外设，超时了触发中断，中断里干的事要尽量短。而**软件定时器**是内核在 RAM 里模拟出来的定时器：创建时设定超时时间（单位：系统时钟节拍 tick），启动后开始计时，超时就调用你注册的**回调函数**。它不需要硬件资源，想建几个建几个（前提是 RAM 够）（PDF 15.1 节 PDF p.326）。

软件定时器是可裁剪功能，必须先在 `FreeRTOSConfig.h` 里打开开关（PDF 15.2 节 PDF p.329）：

```c
#define configUSE_TIMERS                1       /* 使能软件定时器 */
#define configTIMER_TASK_PRIORITY       2       /* 软件定时器服务任务优先级 */
#define configTIMER_QUEUE_LENGTH        10      /* 软件定时器命令队列长度 */
#define configTIMER_TASK_STACK_DEPTH    256     /* 软件定时器服务任务栈大小（字） */
```

> 💡 软件定时器是"可裁剪"的：`configUSE_TIMERS` 设为 1 后，`vTaskStartScheduler()` 启动调度器时会自动创建一个**软件定时器服务任务**（也叫 timer daemon task），栈大小和优先级就来自上面两个宏。它负责三件事：判断哪些定时器超时了、调用超时定时器的回调函数、处理命令队列（PDF 15.1.1 节 PDF p.326）。

---

## 2. 命令队列：用户任务不直接碰定时器

有意思的是：用户任务调用 `xTimerStart()` 之类 API 时，**并不会直接操作定时器对象**，而是往一个"软件定时器命令队列"里写入一条消息（发送命令），消息内容包含"要操作的定时器句柄 + 要执行的命令"。软件定时器服务任务从队列里取出命令，再去真正操作定时器（PDF 15.1.2 节 PDF p.326）。

这个命令队列是**用户不能直接访问的**，只能通过 API 间接使用。所以"开启定时器"这个动作是异步的——API 只是把命令塞进队列就返回了，真正的启动动作由服务任务稍后执行。这也解释了为什么 `xTimerStart()` 有个 `xTicksToWait` 参数：命令队列满的时候，API 会阻塞等待空位。

> ⚠️ 回调函数不是任务！它运行在**软件定时器服务任务的上下文中**，用的也是服务任务的栈。因此在回调里**严禁调用任何可能导致阻塞的 API**（如 `vTaskDelay()`、`vTaskDelayUntil()`、阻塞式等待队列/信号量），否则会把整个服务任务卡死，所有定时器一起罢工（PDF 15.1 节 PDF p.326）。回调里干活要快，想干重活就通过队列/信号量转发给别的任务。

---

## 3. 定时器的状态：休眠与运行

软件定时器只有两种状态（PDF 15.1.3 节 PDF p.327）：

| 状态 | 说明 |
| --- | --- |
| 休眠态（Dormant） | 定时器被创建了、句柄有效，但没在计时，回调不会执行 |
| 运行态（Active） | 正在计时，超时后会执行回调（周期定时器还会自动重新计时） |

单次定时器超时一次就回到休眠态，不会自动重启；周期定时器超时后自动开始下一轮计时，周而复始（PDF 15.1.4 节 PDF p.327）。两者的状态转换图分别如教材 15.1.5.1 与 15.1.5.2 所示，核心区别就在"超时后是否回运行态"。

另外还有**复位**操作：`xTimerReset()` 会让定时器"从复位那一刻重新开始计时"，超时时刻整体后移。这个特性非常适合做"看门狗"式的操作——每次按键都复位一次，5 秒没人按键就超时报警（PDF 15.1.6 节 PDF p.329）。

---

## 4. 核心 API 一览

常用 API 如下（PDF 15.3 节 PDF p.330）：

| 函数 | 作用 |
| --- | --- |
| `xTimerCreate()` | 动态创建定时器（静态版 `xTimerCreateStatic()`） |
| `xTimerStart()` / `xTimerStartFromISR()` | 开启定时 |
| `xTimerStop()` / `xTimerStopFromISR()` | 停止定时 |
| `xTimerReset()` / `xTimerResetFromISR()` | 复位定时（重新开始计时） |
| `xTimerChangePeriod()` / `xTimerChangePeriodFromISR()` | 修改超时时间（未启动则相当于 Start） |
| `xTimerDelete()` | 删除定时器 |

创建定时器的原型（回调类型 `TimerCallbackFunction_t` 就是 `void (*)(TimerHandle_t)`）：

```c
TimerHandle_t xTimerCreate(
    const char * const     pcTimerName,      /* 定时器名字，调试用 */
    const TickType_t       xTimerPeriodInTicks, /* 超时时间，单位：tick */
    const UBaseType_t      uxAutoReload,     /* pdTRUE=周期定时器, pdFALSE=单次 */
    void * const           pvTimerID,        /* 定时器 ID，多个定时器共用回调时区分身份 */
    TimerCallbackFunction_t pxCallbackFunction); /* 超时回调函数 */
```

ID 参数很实用：多个定时器可以共用同一个回调函数，进回调后用 `pvTimerGetTimerID(xTimer)` 分辨是哪个定时器超时。任务版 API（如 `xTimerStart()`）返回 `pdPASS`/`pdFAIL`，并有 `xTicksToWait` 表示"命令队列满时最多等多久"；FromISR 版没有等待参数，改用 `pxHigherPriorityTaskWoken` 传出是否需要任务切换。

---

## 5. 动手之前：看看教材实验怎么写的

教材 15.4 实验创建了两个定时器：Timer1 是 1000 tick 的**周期定时器**，Timer2 是 1000 tick 的**单次定时器**，都在 LCD 上刷新区域并计数（PDF 15.4.2 节 PDF p.335）。按键 0 启动两个定时器，按键 1 停止。下面这段是精简后的核心逻辑：

```c
/* 超时回调：参数 xTimer 可以配合 pvTimerGetTimerID() 区分定时器 */
void Timer1Callback(TimerHandle_t xTimer)
{
    static uint32_t timer1_num = 0;
    /* 周期定时器：每次都执行，LCD 区域刷新并计数 */
    timer1_num++;
    printf("Timer1 超时 %d 次\r\n", timer1_num);
}

void Timer2Callback(TimerHandle_t xTimer)
{
    static uint32_t timer2_num = 0;
    /* 单次定时器：只执行一次，之后回到休眠态 */
    timer2_num++;
    printf("Timer2 超时 %d 次\r\n", timer2_num);
}

/* 在 start_task 里创建 */
TimerHandle_t Timer1Timer_Handler, Timer2Timer_Handler;

Timer1Timer_Handler = xTimerCreate(
    "Timer1",            /* 定时器名 */
    1000,                /* 超时时间 1000 tick */
    pdTRUE,              /* 周期定时器 */
    (void *)1,           /* 定时器 ID */
    Timer1Callback);     /* 回调函数 */

Timer2Timer_Handler = xTimerCreate(
    "Timer2",            /* 定时器名 */
    1000,                /* 超时时间 1000 tick */
    pdFALSE,             /* 单次定时器 */
    (void *)2,           /* 定时器 ID */
    Timer2Callback);     /* 回调函数 */
```

然后在按键任务里控制开关（PDF 15.4.2 节 PDF p.336）：

```c
void task1(void *pvParameters)
{
    uint8_t key = 0;

    while (1)
    {
        key = key_scan(0);
        switch (key)
        {
            case KEY0_PRES:   /* 按键 0：启动两个定时器 */
                xTimerStart(Timer1Timer_Handler, portMAX_DELAY);
                xTimerStart(Timer2Timer_Handler, portMAX_DELAY);
                break;
            case KEY1_PRES:   /* 按键 1：停止两个定时器 */
                xTimerStop(Timer1Timer_Handler, portMAX_DELAY);
                xTimerStop(Timer2Timer_Handler, portMAX_DELAY);
                break;
            default:
                break;
        }
        vTaskDelay(10);
    }
}
```

运行起来你会看到：Timer1 每 1000 tick 打印一次、永不停歇；Timer2 只打印一次就没了。这"一次与无数次"的差别，就是单次与周期定时器的全部意义。

> 💡 教材实验里所有定时器 API 的 `xTicksToWait` 都传 `portMAX_DELAY`——命令队列几乎不会满，传最大值最省心。但如果你的回调里有 FromISR 版之外的阻塞 API，编译器不会报错，跑起来才炸，切记。

---

## 动手练习

### 练习 10.1：双定时器实验——观察回调时机

- 1️⃣ 在你的 FreeRTOS 分支工程里，按教材 15.4 的思路创建两个定时器：Timer1 为周期 2000 tick、Timer2 为单次 5000 tick。
- 2️⃣ 两个回调里都用串口打印超时计数；任务里每 1000 tick 打印一次 `xTaskGetTickCount()`（第 6 课学的）。
- 3️⃣ 思考并验证：Timer1 首次回调发生在启动后约 2000 tick 还是 3000 tick？Timer2 只触发一次后，再按一次复位（`xTimerReset`）它会重新计时吗？把观察结果写进你的实验笔记。

### 练习 10.2：在中断里操作定时器

- 1️⃣ 用第 4 课/实验 4 的定时器中断思路（TIM3 更新中断，1Hz），在中断服务函数里调用 `xTimerStartFromISR()` 启动 Timer1，记得处理 `pxHigherPriorityTaskWoken` 并在退出中断前判断是否 `portYIELD_FROM_ISR()`。
- 2️⃣ 在任务里改成调用 `xTimerStart()` 对比行为差异，体会"FromISR 版不能阻塞等待、只能返回切换标志"这一约束。
- 3️⃣ 验收标准：中断启动定时器后，串口能稳定周期性看到 Timer1 回调输出，且任务调度不受影响。

---

## 自测

### 随堂小测 1

软件定时器的超时回调函数运行在哪个上下文中？

- A. 调用 xTimerStart() 的任务
- B. 定时器中断服务函数
- C. 软件定时器服务任务

<details>
<summary>查看答案</summary>

C。所有定时器的回调都由软件定时器服务任务（daemon task）调用，栈也用它自己的（PDF 15.1.1 节，p.326）。
</details>

### 随堂小测 2

用户任务调用 xTimerStart() 后，实际发生了什么？

- A. 直接修改定时器对象并启动
- B. 向命令队列发送一条启动命令
- C. 触发一次 SysTick 中断

<details>
<summary>查看答案</summary>

B。API 只往软件定时器命令队列写消息，由服务任务取出命令后再操作定时器对象（PDF 15.1.2 节，p.326）。
</details>

### 随堂小测 3

uxAutoReload 参数为 pdFALSE 时，定时器超时后会？

- A. 自动重新计时，周期执行
- B. 回到休眠态，不再执行回调
- C. 立即触发一次系统复位

<details>
<summary>查看答案</summary>

B。pdFALSE 创建的是单次定时器，超时一次即回到休眠态，可手动重启但不会自动重开（PDF 15.1.4 节，p.327）。
</details>

### 随堂小测 4

在软件定时器回调函数中，下列哪个操作是允许的？

- A. vTaskDelay(100)
- B. 短小的计算并写 GPIO
- C. 阻塞等待一个空队列

<details>
<summary>查看答案</summary>

B。回调运行在服务任务中，任何会阻塞服务任务的 API 都不允许（A、C 都会卡死所有定时器），应保持回调短小（PDF 15.1 节，p.326）。
</details>

---

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 15 章（PDF p.326~340）——本课全部依据，实验例程为《FreeRTOS 实验例程 15》
- 🌐 [FreeRTOS 官方文档：Software Timers](https://www.freertos.org/Documentation/02-Kernel/02-Kernel-features/05-Software-timers/01-Software-timers)——软件定时器概念与 daemon 任务详解
- 🔧 [FreeRTOS API 参考：Software Timer API](https://freertos.org/Documentation/02-Kernel/04-API-references/11-Software-timers/00-FreeRTOS-Software-Timer-API-Functions)——各函数完整原型

---

## 下一步

有问题随时问我。下一课预告：第 11 课——事件标志组，用"几个 bit"玩出多任务同步的新花样，还记得第 9 课信号量只能管"有没有"吗？事件组能管"哪些发生了"。

| [← 上一课](/my-blog/posts/freertos/0009-semaphores/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0011-event-groups/) |
| --- | --- | --- |