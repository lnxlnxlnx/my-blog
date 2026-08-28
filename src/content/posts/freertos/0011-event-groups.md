---
title: 事件标志组
published: 2026-08-22
description: FreeRTOS 课程第 11 课：事件标志组用一组 bit 表达"哪些事件发生了"——24 个可用事件位、xEventGroupWaitBits 的与/或等待逻辑与多任务置位实验。
tags: [FreeRTOS, 嵌入式, RTOS, 事件标志组, 事件同步]
category: FreeRTOS
draft: false
prevTitle: 任务通知
prevSlug: "freertos/0012-task-notifications"
nextTitle: 软件定时器
nextSlug: "freertos/0010-software-timers"
---

# 事件标志组

这是 FreeRTOS 系列课程笔记的第 11 课：24 个 bit 的"信号灯牌"——一次等待多个事件，还能组合条件。**本课目标：**信号量只能表达"一个事件发生了没有"，而事件标志组用一组 bit 表达"哪些事件发生了"。学完你能说清：24 个可用事件位从哪来、`xEventGroupWaitBits` 的"与/或"等待逻辑怎么用，并完成一个"多任务置位、单任务等待"的实验（正点原子《FreeRTOS 开发指南 V1.12》第 16 章 PDF p.341~352）。

---

## 1. 事件标志与事件组：一堆 bit 的集合

第 9 课学的信号量像是"单盏信号灯"：红/绿两种状态，要么有信号要么没有。而实际产品里常有这种需求：**任务要等"网络就绪"和"数据到达"两个条件同时满足才干活**。信号量得建两个、分两次等，麻烦。

事件标志组就是为这个而生的（PDF 16.1 节 PDF p.341）：

- **事件标志**：一个布尔值，0 表示事件没发生，1 表示发生了。一个事件一个 bit。
- **事件组**：一堆事件标志的集合，存进一个 `EventBits_t` 变量里。

`EventBits_t` 的本质就是 `TickType_t`（本课程所有例程中 `configUSE_16_BIT_TICKS` 为 0，即 32 位无符号数）。但这 32 个 bit 不是全都能用——**低 24 位 [23:0] 存事件标志，高 8 位 [31:24] 被内核用作控制信息**。所以一个事件组最多只能存 24 个事件标志（PDF 16.1 节 PDF p.341）。

```c
/* EventBits_t 与位分配（configUSE_16_BIT_TICKS = 0 时） */
typedef TickType_t EventBits_t;   /* 实际是 uint32_t */

#define EVENTBIT_0    ( 1UL << 0 )   /* 事件 0：bit0 */
#define EVENTBIT_1    ( 1UL << 1 )   /* 事件 1：bit1 */
#define EVENTBIT_ALL  ( EVENTBIT_0 | EVENTBIT_1 )  /* 同时要两个事件 */

#define EVENTBIT_23   ( 1UL << 23 )  /* 最多用到 bit23，高 8 位归内核 */
```

> 💡 事件组是"广播"的：同一个事件组可以被任意多个任务同时等待（第 12 课的任务通知就不行）。置位、等待、清零都围绕同一个 `EventBits_t` 变量操作，像一块所有任务都能看到的"信号灯牌"。

---

## 2. 创建与基础操作 API

常用 API（PDF 16.2 节 PDF p.342）：

| 函数 | 作用 |
| --- | --- |
| `xEventGroupCreate()` | 动态创建事件组，返回句柄（静态版 `xEventGroupCreateStatic()`） |
| `vEventGroupDelete()` | 删除事件组 |
| `xEventGroupSetBits()` / `xEventGroupSetBitsFromISR()` | 把指定事件位置 1 |
| `xEventGroupClearBits()` / `xEventGroupClearBitsFromISR()` | 把指定事件位清 0 |
| `xEventGroupGetBits()` / `xEventGroupGetBitsFromISR()` | 读取当前事件位值（不阻塞） |
| `xEventGroupWaitBits()` | 阻塞等待指定事件位（核心函数） |
| `xEventGroupSync()` | 置位自己的事件，同时等待别人的事件——多任务同步用 |

置位与读取的用法很直观：

```c
EventGroupHandle_t EventGroupHandler;   /* 事件组句柄 */

/* 任务 A：按键触发事件 0 */
xEventGroupSetBits(EventGroupHandler, EVENTBIT_0);

/* 任务 B：查看当前哪些事件发生了（非阻塞） */
EventBits_t ev = xEventGroupGetBits(EventGroupHandler);
if (ev & EVENTBIT_1)
{
    /* 事件 1 已经发生 */
}
```

---

## 3. 等待：与还是或，这是个问题

重头戏是 `xEventGroupWaitBits()`，五个参数个个有用（PDF 16.2.3 节 PDF p.343）：

```c
EventBits_t xEventGroupWaitBits(
    EventGroupHandle_t xEventGroup,   /* 要等待的事件组 */
    const EventBits_t  uxBitsToWaitFor, /* 等待哪些事件位（按位或组合） */
    const BaseType_t   xClearOnExit,  /* pdTRUE：等到后自动清零这些位 */
    const BaseType_t   xWaitForAllBits, /* pdTRUE：全部满足才返回（与）；pdFALSE：任一满足即返回（或） */
    TickType_t         xTicksToWait); /* 最多阻塞多久，portMAX_DELAY 为无限 */
```

等待逻辑是重点：

| xWaitForAllBits | 语义 | 返回值 |
| --- | --- | --- |
| `pdTRUE` | 逻辑与（AND）：所有被等待的位都置 1 才返回 | 满足条件的事件位值 |
| `pdFALSE` | 逻辑或（OR）：只要任一被等待的位置 1 就返回 | 满足条件的事件位值 |

超时或条件不满足时返回事件组当前值；用 `xClearOnExit = pdTRUE` 可以在"等到"的瞬间自动清零，免去手动 `xEventGroupClearBits()` 的竞态烦恼（教材实验正是这么用的）。

> ⚠️ 注意区分两个参数：`xClearOnExit` 是"等到后要不要清"，`xWaitForAllBits` 是"要全部还是任意一个"。初次使用最容易把两者搞混——教材 16.3 实验里 task2 的调用是 `xEventGroupWaitBits(x, EVENTBIT_ALL, pdTRUE, pdTRUE, portMAX_DELAY)`：等"事件 0 和事件 1 同时发生"，等到后自动清零（PDF 16.3.2 节 PDF p.349）。

另外，置位/清零/等待都有 FromISR 版本（`xEventGroupSetBitsFromISR()` 等）。注意 `xEventGroupSetBitsFromISR()` 返回 `pdPASS`/`pdFAIL` 而不是事件值，因为它其实是往一个内部队列投递"置位任务"，由定时器服务任务代劳。

---

## 4. 教材实验：多任务置位、一个任务等待

教材 16.3 实验设计了四个任务（PDF 16.3.1 节 PDF p.346）：

- **start_task**：创建事件组和其他任务
- **task1**：扫描按键，KEY0 置位事件 0，KEY1 置位事件 1
- **task2**：等待事件 0 **和** 事件 1 同时置位，等到后 LCD 刷新
- **task3**：每 10 tick 读取并显示事件组当前值

task1 与 task2 的核心代码：

```c
/* task1：按键置位（PDF 16.3.2 节，p.348） */
void task1(void *pvParameters)
{
    uint8_t key = 0;

    while (1)
    {
        key = key_scan(0);
        switch (key)
        {
            case KEY0_PRES:
                xEventGroupSetBits(EventGroupHandler, EVENTBIT_0);  /* 置位事件 0 */
                break;
            case KEY1_PRES:
                xEventGroupSetBits(EventGroupHandler, EVENTBIT_1);  /* 置位事件 1 */
                break;
            default:
                break;
        }
        vTaskDelay(10);
    }
}

/* task2：等待两个事件同时发生（PDF 16.3.2 节，p.349） */
void task2(void *pvParameters)
{
    while (1)
    {
        /* 等待事件 0 和 1 同时被置位，等到后自动清零 */
        xEventGroupWaitBits(EventGroupHandler,   /* 事件组 */
                            EVENTBIT_ALL,        /* 等待的位 */
                            pdTRUE,              /* 等到后自动清零 */
                            pdTRUE,              /* 逻辑与：全部满足 */
                            portMAX_DELAY);      /* 无限阻塞 */
        printf("事件 0 和事件 1 都发生了\r\n");
        vTaskDelay(10);
    }
}
```

实验现象很有教学意义：只按 KEY0 或只按 KEY1，task2 纹丝不动；两个都按过之后（先按的不清零、一直挂在那里），task2 立刻被唤醒。这就是"与"等待与信号量的本质差异——信号量用一次少一次，事件位可以一直"亮着"等你凑齐。

> 💡 为什么 task2 能等到"先按的 KEY0"？因为事件位置 1 后不会自己消失。这正是事件组适合做"状态汇报"的原因：某个模块把"初始化完成"的位一置，之后谁等谁都能等到，不用关心时序先后。

---

## 动手练习

### 练习 11.1：双事件等待实验——观察阻塞行为

- 1️⃣ 在你的 FreeRTOS 分支工程里建一个事件组，创建三个任务：taskA 每按 KEY0 置位事件 0；taskB 每按 KEY1 置位事件 1；主任务用 `xEventGroupWaitBits(…, EVENTBIT_ALL, pdTRUE, pdTRUE, 5000)` 等待。
- 2️⃣ 分别试验：只按 KEY0、只按 KEY1、两个都按，记录主任务每次是被唤醒还是 5000 tick 超时。
- 3️⃣ 把 `xWaitForAllBits` 改成 `pdFALSE` 再试，对比唤醒条件的变化，把结果记入笔记。

### 练习 11.2：中断置位改造

- 1️⃣ 把练习 11.1 中 taskA 的按键置位，改成在定时器中断里调用 `xEventGroupSetBitsFromISR()`（1Hz 置位事件 0）。
- 2️⃣ 注意处理返回值与 `pxHigherPriorityTaskWoken`：若返回 `pdPASS` 且标志被置位，退出中断前调用 `portYIELD_FROM_ISR()`。
- 3️⃣ 验收标准：串口按 1Hz 稳定输出"事件 0 发生"，按 KEY1 后主任务立即被唤醒并输出"全部满足"。

---

## 自测

### 随堂小测 1

EventBits_t 是 32 位时，一个事件组最多能存多少个事件标志？

- A. 32 个
- B. 24 个
- C. 16 个

<details>
<summary>查看答案</summary>

B。低 24 位 [23:0] 存事件标志，高 8 位被内核用作控制信息（PDF 16.1 节，p.341）。
</details>

### 随堂小测 2

xEventGroupWaitBits 中 xWaitForAllBits = pdTRUE 表示？

- A. 任一被等待的事件位置 1 就返回
- B. 所有被等待的事件位都置 1 才返回
- C. 等到后自动清零所有位

<details>
<summary>查看答案</summary>

B。pdTRUE 是逻辑与（AND）等待，全部满足才返回；自动清零由 xClearOnExit 负责（PDF 16.2.3 节，p.343）。
</details>

### 随堂小测 3

任务等待期间，事件位被置 1 后没有清零，会怎样？

- A. 事件位保持 1，之后等待该位的任务能立即满足条件
- B. 事件位自动恢复为 0
- C. 触发内核异常

<details>
<summary>查看答案</summary>

A。事件位置 1 后保持，直到手动或用 xClearOnExit 清零（教材实验里先按的键挂起等待凑齐，正是利用这一点，p.349）。
</details>

### 随堂小测 4

xEventGroupSetBitsFromISR() 与任务版 xEventGroupSetBits() 的返回值有何不同？

- A. 没有区别，都返回事件值
- B. 前者返回 pdPASS/pdFAIL，后者返回事件值
- C. 前者返回 void

<details>
<summary>查看答案</summary>

B。FromISR 版返回 pdPASS/pdFAIL，且多一个 pxHigherPriorityTaskWoken 参数（PDF 16.2.4 节，p.344）。
</details>

---

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 16 章（PDF p.341~352）——本课全部依据，实验例程为《FreeRTOS 实验例程 16》
- 🌐 [FreeRTOS 官方文档：Event Groups](https://freertos.org/Documentation/02-Kernel/02-Kernel-features/06-Event-groups)——事件组概念与适用场景
- 🔧 [FreeRTOS API 参考：Event Groups API](https://freertos.org/Documentation/02-Kernel/04-API-references/12-Event-groups-or-flags/00-Event-groups)——各函数完整原型

---

## 下一步

有问题随时问我。下一课预告：第 12 课——任务通知，FreeRTOS 里最快最省的"轻量通信"方案，官方称比队列/信号量快约 45%，但它有什么代价？下一课见分晓。

| [← 上一课](/my-blog/posts/freertos/0010-software-timers/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0012-task-notifications/) |
| --- | --- | --- |