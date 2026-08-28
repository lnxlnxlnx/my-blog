---
title: 任务 API 实战
published: 2026-08-15
description: FreeRTOS 系列课程第 4 课：xTaskCreate 动态创建、vTaskDelete 删除与内存回收铁律、xTaskCreateStatic 静态创建、vTaskSuspend/vTaskResume 挂起与恢复的逐参数讲解，含按键删任务、按键挂起/恢复两个真机实验。
tags: [FreeRTOS, 嵌入式, RTOS, 任务API, 动态创建, 静态创建, 挂起, 恢复]
category: FreeRTOS
draft: false
prevTitle: 列表与列表项
prevSlug: "freertos/0005-lists-and-list-items"
nextTitle: 任务基础知识
nextSlug: "freertos/0003-task-basics"
---

# 任务 API 实战

这是 FreeRTOS 系列课程笔记的第 4 课：xTaskCreate、vTaskDelete、xTaskCreateStatic、vTaskSuspend/vTaskResume 全套上手。**本课目标：**把第 3 课的概念落到代码。学完你能不看手册写出动态创建/删除、静态创建、挂起/恢复任务的完整代码，并清楚每个 API 的参数、返回值、配置开关（INCLUDE_xxx）和内存责任归属——尤其是"谁的内存谁来释放"这条铁律。两个真机实验：按键删任务、按键挂起/恢复任务。

## 1. xTaskCreate：动态创建任务

最常用的创建方式：TCB 和任务栈都由 FreeRTOS 从堆（heap_4）里自动分配（PDF 第 6.1 节（PDF p.90））。前提：FreeRTOSConfig.h 里 `configSUPPORT_DYNAMIC_ALLOCATION` = 1（默认开），工程里加了 heap_x.c。创建成功后任务**立刻进入就绪态**，由调度器决定何时运行。

六个形参逐一拆解：

| 形参 | 含义 | 要点 |
|------|------|------|
| `pxTaskCode` | 任务函数指针 | 形如 `void task(void *pvParameters)` |
| `pcName` | 任务名 | 最长 configMAX_TASK_NAME_LEN 字符，仅调试用 |
| `usStackDepth` | 任务栈大小 | 单位**字**！不是字节 |
| `pvParameters` | 传给任务函数的参数 | 不用就传 NULL |
| `uxPriority` | 任务优先级 | 范围 0~(configMAX_PRIORITIES-1) |
| `pxCreatedTask` | 任务句柄指针 | 成功后写入句柄（本质是 TCB 指针），后续删除/挂起都靠它 |

返回值：`pdPASS`（创建成功）；`errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY`（堆内存不足，创建失败）。**好习惯：创建后检查返回值。**

## 2. vTaskDelete：删除任务与内存回收

删除任务 = 把它从就绪/阻塞/挂起/事件列表中移除（PDF 第 6.1 节（PDF p.92））。使用前提：`INCLUDE_vTaskDelete` = 1。

- 🧹 **内核分配的内存由空闲任务回收**：被删任务的 TCB 和任务栈是内核从堆里分配的，删除后由空闲任务负责释放（不是立刻释放，而是标记后等空闲任务处理）。
- 💸 **用户自己的内存自己管**：任务里用 pvPortMalloc 申请的、或静态定义的资源，删除前必须自己释放，否则内存泄漏。
- 🪞 **删除自己**：传 NULL 或自己的句柄都可以。正点原子例程里 start_task 创建完其他任务后 `vTaskDelete(StartTask_Handler)` 自我删除，就是标准用法。
- 🛡️ **句柄置 NULL 是好习惯**：防止对已删除任务再次操作（重复删除会触发断言）。

## 3. xTaskCreateStatic：静态创建任务

TCB 和任务栈的内存**由用户提供**（PDF 第 6.1 节（PDF p.91））。使用前提：`configSUPPORT_STATIC_ALLOCATION` = 1。静态创建不依赖堆，适合确定性要求高的场景（比如安全关键、不允许运行时分配失败的场合）。

- 比动态创建多两个参数：`puxStackBuffer`（用户定义的 `StackType_t` 数组，即任务栈）和 `pxTaskBuffer`（用户定义的 `StaticTask_t` 变量，即 TCB 内存）。
- 返回值：NULL = 内存没给够/创建失败；其他值 = 任务句柄。
- ⚠️ 开启静态分配后，**空闲任务和定时器服务任务（若启用）的内存也要用户提供**：必须实现回调 `vApplicationGetIdleTaskMemory()` 和 `vApplicationGetTimerTaskMemory()`（PDF p.98~99）。

## 4. vTaskSuspend / vTaskResume：挂起与恢复

挂起 = 无论优先级多高都不再参与调度，直到被恢复（PDF 第 6.4 节（PDF p.103~104））。使用前提：`INCLUDE_vTaskSuspend` = 1。

- `vTaskSuspend(handle)`：挂起指定任务；传 NULL 挂起自己（**注意：任务不能恢复自己，只能靠别人恢复**）。
- `vTaskResume(handle)`：在**任务中**恢复挂起的任务。
- `xTaskResumeFromISR(handle)`：在**中断中**恢复任务，返回 pdTRUE 表示需要任务切换（调用方应触发一次上下文切换）。
- 🔑 **挂起不嵌套**：不管 vTaskSuspend 调几次，vTaskResume 一次就够。恢复后的任务回到挂起前的状态列表（就绪或阻塞），而不是直接运行。

> ⚠️ 挂起态和阻塞态最大的区别：阻塞有"自动醒"的机制（延时超时、事件到达），挂起**没有**——被挂起的任务只能由 vTaskResume 系列函数叫醒。如果某任务被挂起后没人恢复它，它就永远"消失"了，这在产品上表现为"功能神秘失效"。

## 5. 实验一：动态创建与删除（按键控制）

教材实验思路（PDF 第 6.2 节（PDF p.93~96））：task1/task2 各自周期性刷新 LCD 区域并计数，task3 扫描按键——KEY0 删除 task1，KEY1 删除 task2。删除后对应区域停止刷新，数字定格。

```c
/* task3：扫描按键，动态删除 task1 / task2 */
void task3(void *pvParameters)
{
    uint8_t key = 0;

    while (1)
    {
        key = key_scan(0);
        switch (key)
        {
            case KEY0_PRES:   /* 删除任务 1 */
                if (Task1Task_Handler != NULL)
                {
                    vTaskDelete(Task1Task_Handler);
                    Task1Task_Handler = NULL;   /* 防止重复删除 */
                }
                break;

            case KEY1_PRES:   /* 删除任务 2 */
                if (Task2Task_Handler != NULL)
                {
                    vTaskDelete(Task2Task_Handler);
                    Task2Task_Handler = NULL;
                }
                break;

            default:
                break;
        }
        vTaskDelay(10);
    }
}
```

创建端在 start_task 里，和上一课移植实验完全一样：临界区内三个 xTaskCreate + 删除自己。区别只在 task1/task2 的任务体换成区域刷屏计数。

## 6. 实验二：静态创建 + 挂起与恢复

### 6.1 静态创建（PDF 第 6.3 节（PDF p.98~102））

```c
/* 静态创建：任务栈和 TCB 都由用户提供 */

/* 任务栈和任务控制块（全局或 static） */
static StackType_t   Task1TaskStack[TASK1_STK_SIZE];
static StaticTask_t  Task1TaskTCB;

/* 静态方式下，空闲任务内存也要用户提供 */
static StackType_t   IdleTaskStack[configMINIMAL_STACK_SIZE];
static StaticTask_t  IdleTaskTCB;

/* FreeRTOS 启动调度器时回调：交出空闲任务的内存 */
void vApplicationGetIdleTaskMemory(StaticTask_t **ppxIdleTaskTCBBuffer,
                                   StackType_t   **ppxIdleTaskStackBuffer,
                                   uint32_t       *pulIdleTaskStackSize)
{
    *ppxIdleTaskTCBBuffer   = &IdleTaskTCB;
    *ppxIdleTaskStackBuffer = IdleTaskStack;
    *pulIdleTaskStackSize   = configMINIMAL_STACK_SIZE;
}

/* 静态创建任务 */
Task1Task_Handler = xTaskCreateStatic(
    (TaskFunction_t)task1,          /* 任务函数 */
    (const char *)"task1",          /* 任务名 */
    (uint32_t)TASK1_STK_SIZE,       /* 栈大小（字） */
    (void *)NULL,                   /* 任务参数 */
    (UBaseType_t)TASK1_PRIO,        /* 优先级 */
    (StackType_t *)Task1TaskStack,  /* 用户提供的任务栈 */
    (StaticTask_t *)&Task1TaskTCB); /* 用户提供的任务控制块 */

if (Task1Task_Handler == NULL)      /* 创建失败 */
{
    printf("static create task1 failed\r\n");
}
```

### 6.2 挂起与恢复（PDF 第 6.5 节（PDF p.104~108））

同一个实验框架，task3 换成：KEY0 挂起 task1、KEY1 恢复 task1。task2 保持运行作为"对照组"——验证挂起只影响被挂起的任务。

```c
/* task3：按键挂起/恢复 task1 */
void task3(void *pvParameters)
{
    uint8_t key = 0;

    while (1)
    {
        key = key_scan(0);
        switch (key)
        {
            case KEY0_PRES:                 /* 挂起任务 1 */
                vTaskSuspend(Task1Task_Handler);
                break;

            case KEY1_PRES:                 /* 恢复任务 1 */
                vTaskResume(Task1Task_Handler);
                break;

            default:
                break;
        }
        vTaskDelay(10);
    }
}

/* 现象：KEY0 后 Task1 区域刷新与计数全部定格，Task2 区域照常；
 * KEY1 后 Task1 从定格处继续 —— 挂起期间任务"时间暂停"了 */
```

> 💡 动态 vs 静态怎么选？动态简单灵活（正点原子推荐日常用），静态适合"启动时一次性创建、运行时零分配"的确定性场景。判断标准就一句：你的系统能不能接受运行时内存分配失败？不能 → 静态。

## 动手练习（约 40 分钟）

### 练习 4.1：动态创建删除实验（含任务自我删除）

- 1️⃣ 在你的 FreeRTOS 分支工程里建三个任务：task_work（LED0 每 500 tick 翻转并计数打印）、task_monitor（KEY0 按下就 `vTaskDelete(task_work 句柄)` 并置 NULL）、task_idle_demo（KEY1 按下则 `vTaskDelete(NULL)` 自我删除，删除前打印"我要自杀了"）。
- 2️⃣ 试试在 task_work 里 pvPortMalloc 一块内存不释放就删任务，观察内存变化（可以反复创建/删除循环 100 次，配合后续内存管理课验证泄漏）。
- **观察什么：**删除 task_work 后 LED0 停闪、计数停止——任务确实被移除；自我删除的任务"静默消失"；重复按 KEY0 不崩溃（因为句柄已置 NULL）。

### 练习 4.2：挂起/恢复实验

- 1️⃣ 创建三个任务：task_a（优先级 3，LED0 每 500 tick 翻转，串口打印 "A"）、task_b（优先级 2，LED1 每 500 tick 翻转，打印 "B"）、task_ctrl（优先级 1，扫描 KEY0=挂起 task_a，KEY1=恢复 task_a，KEY2=恢复被挂起的高优先级任务观察调度）。
- 2️⃣ 挂起 task_a 期间，再把 task_b 的 vTaskDelay 改成 2000，观察打印节奏。
- **观察什么：**KEY0 后 "A" 消失、LED0 定格，但 "B" 完全不受影响；KEY1 后 task_a 从暂停处继续。把 task_a 优先级改成 1 再重复实验，思考：挂起是不是"与优先级无关的强制暂停"？（是！挂起不看优先级，这也是它与抢占的本质区别）

## 自测（答完再点答案）

### 随堂小测 1

Q1. xTaskCreate 在堆内存不足时返回什么？

- A. pdPASS
- B. errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY
- C. NULL 空指针

<details>
<summary>查看答案</summary>

B。动态创建失败返回 errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY；返回 NULL 的是静态创建 xTaskCreateStatic（PDF p.90~91）。

</details>

### 随堂小测 2

Q2. 动态创建的任务被 vTaskDelete 后，TCB 和栈由谁回收？

- A. 调用 vTaskDelete 的任务自己
- B. 空闲任务负责回收释放
- C. 立即归还给系统堆

<details>
<summary>查看答案</summary>

B。内核分配的内存（TCB+栈）由空闲任务回收；用户自己申请的内存必须自己先释放（PDF p.92）。

</details>

### 随堂小测 3

Q3. xTaskCreateStatic 比 xTaskCreate 多出的两个参数是？

- A. 任务栈指针和任务控制块指针
- B. 任务名和任务优先级
- C. 任务参数和任务句柄

<details>
<summary>查看答案</summary>

A。静态创建要求用户提供 puxStackBuffer（任务栈数组）和 pxTaskBuffer（StaticTask_t TCB 内存）（PDF p.91）。

</details>

### 随堂小测 4

Q4. 任务被 vTaskSuspend 连续挂起两次，恢复需要几次 vTaskResume？

- A. 两次，每次挂起对应一次恢复
- B. 一次，挂起不嵌套计数
- C. 三次，加一次额外的确认

<details>
<summary>查看答案</summary>

B。vTaskSuspend 不支持嵌套，重复挂起多少次都只需一次恢复（PDF p.103）。

</details>

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 6 章（PDF p.90~109）——本课全部依据，含三个实验源码
- 🌐 [FreeRTOS 官方 xTaskCreate 文档](https://www.freertos.org/a00125.html)——API 参数与返回值的官方说明
- 🌐 [FreeRTOS 官方 vTaskDelete 文档](https://www.freertos.org/a00102.html)——删除任务的内存回收说明
- 📕 [Mastering the FreeRTOS™ Real Time Kernel](https://www.freertos.org/Documentation/RTOS_book.html)——第 3~4 章任务管理与调度器行为

## 下一步

API 用熟了，接下来要钻进内核里看它凭什么能"管住"这么多任务——下一课是原理深入第一站：列表与列表项，TCB 里那两个列表项字段的谜底要揭开了。有疑问随时问我！

| [← 上一课](/my-blog/posts/freertos/0003-task-basics/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0005-lists-and-list-items/) |