---
title: 任务基础知识
published: 2026-08-14
description: FreeRTOS 系列课程第 3 课：从任务这个最小单元讲起——四种状态转换、优先级数值与调度顺序（与中断优先级相反）、抢占式/时间片/协程式调度、任务控制块 TCB 逐字段解读与任务栈"字"单位。
tags: [FreeRTOS, 嵌入式, RTOS, 任务状态, 优先级, 调度, TCB, 任务栈]
category: FreeRTOS
draft: false
prevTitle: 任务 API 实战
prevSlug: "freertos/0004-task-api"
nextTitle: 移植与第一个任务
nextSlug: "freertos/0002-porting-and-first-task"
---

# 任务基础知识

这是 FreeRTOS 系列课程笔记的第 3 课：状态、优先级、调度方式与 TCB——任务的身世档案。**本课目标：**从"任务"这个最小单元讲起。学完你能用文字画出任务四种状态的转换图，说清优先级数值与调度顺序的关系（注意和中断优先级相反！），区分抢占式调度与时间片调度，并读懂任务控制块 TCB 里每个字段在干嘛，理解任务栈大小的单位为什么是"字"。这是后续一切 API 与内核机制的地基。

## 1. 单任务系统 vs 多任务系统

单任务系统就是裸机的前后台系统（PDF 第 5.1.1 节（PDF p.82））：`main()` 里一个大 while 循环顺序处理事务（后台），中断服务函数处理紧急事件（前台）。它的致命弱点是**实时性差**——事务没有优先级之分，紧急事务没轮到就只能干等。

多任务系统把大循环拆成多个独立任务（PDF 第 5.1.2 节（PDF p.82~83））：单核 CPU 同一时刻仍只能跑一个任务，但调度器按调度算法极快地分配 CPU 使用权，宏观上造成多个任务"同时"运行的错觉。关键收益：**紧急事务可以放进高优先级任务，像中断抢占一样立刻获得 CPU**。

## 2. 任务的四种状态

FreeRTOS 中任务必然处于以下四种状态之一（PDF 第 5.2 节（PDF p.83~84））：

| 状态 | 含义 | 典型进入/退出方式 |
|------|------|------|
| 🏃 运行态 | 正在占用 CPU 执行 | 单核下任意时刻只有一个任务处于运行态 |
| 💺 就绪态 | 具备运行条件，但 CPU 被同/更高优先级任务占着 | 阻塞/挂起解除后进入；被更高优先级抢占时退回 |
| 😴 阻塞态 | 因延时或等待事件而暂停 | vTaskDelay() 延时未到、等待队列/信号量/事件组；超时后自动解除 |
| ⏸️ 挂起态 | 被主动挂起，不参与调度 | vTaskSuspend() 进入，vTaskResume() 退出（不会自动恢复！） |

**状态转换图（文字版）**（对应 PDF 图 5.2.1（PDF p.84））：

- 任务创建 → **就绪态**（创建成功即进入就绪列表，等调度器选中）
- 就绪态 → **运行态**：调度器选中该任务（优先级最高，或同优先级时间片轮转到）
- 运行态 → **就绪态**：被更高优先级任务抢占，或时间片用完
- 运行态 → **阻塞态**：调用 vTaskDelay / 等待事件（带超时）
- 运行态 → **挂起态**：调用 vTaskSuspend
- 阻塞态/挂起态 → **就绪态**：延时超时 / 事件到达 / vTaskResume 恢复
- 任意状态 → 任务删除（vTaskDelete）

> 💡 判断状态的土办法：问两个问题——"它能不能被调度器选中？"能 → 看它是否正在跑：跑着=运行态，排队=就绪态；"它是不是主动让位了？"阻塞是"睡到点或等事件自动醒"，挂起是"被叫醒才醒"。阻塞和挂起都不占 CPU，但解除条件完全不同。

## 3. 任务优先级：数值越大越优先

每个任务被分配 0~(configMAX_PRIORITIES-1) 的优先级（PDF 第 5.3 节（PDF p.84））：

- **数值 0 是最低优先级**，数值 (configMAX_PRIORITIES-1) 是最高优先级。
- 如果启用硬件优化选任务（configUSE_PORT_OPTIMISED_TASK_SELECTION=1，用 CLZ 前导零指令），STM32 上 configMAX_PRIORITIES 不能超过 32。
- 优先级数量越多，系统消耗资源越多，够用就好。

> ⚠️ FreeRTOS 任务优先级与 STM32 中断优先级的数值含义**正好相反**（PDF 图 5.3.1（PDF p.84））：任务优先级数值越大越优先；NVIC 中断优先级数值越小越优先。刚入门特别容易在这上面栽跟头——把两个体系混着记。

## 4. 调度方式：抢占式 + 时间片

FreeRTOS 支持三种调度方式（PDF 第 5.4 节（PDF p.85））：

- ⚔️ **抢占式调度**：针对优先级不同的任务。高优先级任务随时抢占低优先级任务，只有高优先级任务阻塞或挂起，低优先级任务才有机会跑。
- 🔁 **时间片调度**：针对优先级相同的任务。每个系统节拍（tick）切换一次，同优先级任务轮流各跑一个 tick。
- 🗑️ **协程式调度**：官方已声明不再开发（"专为资源极少的设备设计，现已很少用到"），本课程不涉及。

抢占式调度的"抢占"发生在哪？主要两个时刻：tick 中断里发现更高优先级任务就绪（`xTaskIncrementTick()` 返回需要切换）、以及任务从阻塞中醒来时。具体切换动作由 PendSV 完成，第 7 课逐行分析。

## 5. 任务控制块 TCB：任务的"身份证"

每个创建的任务都有一个任务控制块结构体变量，存储任务的属性（PDF 第 5.5 节（PDF p.86~87））。`TaskHandle_t` 其实就是指向 TCB 的指针。核心字段逐个看：

```c
/* tasks.c 中 TCB 的定义（核心字段） */
typedef struct tskTaskControlBlock
{
    volatile StackType_t *pxTopOfStack;  /* 指向任务栈栈顶：切换现场时从这里恢复寄存器 */

    ListItem_t xStateListItem;   /* 状态列表项：任务挂在就绪/阻塞/挂起列表里就是靠它 */
    ListItem_t xEventListItem;   /* 事件列表项：任务等待队列/信号量等事件时使用 */

    UBaseType_t uxPriority;      /* 任务优先级：数值越大优先级越高 */
    StackType_t *pxStack;        /* 任务栈起始地址 */
    char pcTaskName[configMAX_TASK_NAME_LEN]; /* 任务名（调试用） */

#if (configUSE_MUTEXES == 1)
    UBaseType_t uxBasePriority;  /* 基础优先级：互斥量优先级翻转后用来恢复原优先级 */
#endif

#if (configUSE_TASK_NOTIFICATIONS == 1)
    volatile uint32_t ulNotifiedValue[configTASK_NOTIFICATION_ARRAY_ENTRIES]; /* 任务通知值 */
#endif
} tskTCB;

typedef struct tskTaskControlBlock *TaskHandle_t;
```

TCB 字段大多能用 FreeRTOSConfig.h 的宏裁剪（PDF p.87）：不用互斥量就不编译 uxBasePriority，不用任务通知就不编译 ulNotifiedValue。内核保持"按需编译"，这也是 FreeRTOS 内存占用可控的原因之一。

特别留意 `xStateListItem` 和 `xEventListItem`：它们就是第 5 课的主角——列表项。调度器靠"任务 TCB 里的列表项"把任务挂进各种列表来管理，这解释了为什么第 5 课列表知识是内核原理的地基。

## 6. 任务栈：单位是"字"，别搞成"字节"

函数局部变量、函数调用的现场保护和返回地址都存在栈里（PDF 第 5.6 节（PDF p.88~89））。RTOS 里每个任务有独立的栈，任务切换时现场（寄存器）保存到当前任务栈，恢复时从目标任务栈弹回。

- 创建任务时给的栈大小参数，单位是**字（word）**，不是字节！
- STM32 上 `StackType_t` 就是 `uint32_t`，所以 128 字 = 128×4 = 512 字节。动态创建时内核用 `pxStack = pvPortMallocStack(usStackDepth * sizeof(StackType_t))` 申请内存。
- `configMINIMAL_STACK_SIZE` 是空闲任务的栈大小（正点原子例程为 128 字）。
- 任务函数里的局部变量、调用的函数嵌套越深，需要的栈越大。给不够会**栈溢出**：栈指针冲出边界，踩坏相邻内存（可能是另一个任务的栈或堆数据），表现通常是"跑一阵子莫名死机/HardFault"。可以在 FreeRTOSConfig.h 打开 `configCHECK_FOR_STACK_OVERFLOW`（1 或 2）检测溢出，或让栈底填充已知值来检查。

```c
/* 任务栈大小 = 字数的直观理解 */
#define TASK_STK_SIZE  128   /* 128 字 = 512 字节 */
TaskHandle_t Task_Handler;

xTaskCreate(task_entry, "task", TASK_STK_SIZE, NULL, 2, &Task_Handler);

/* 动态创建时内核做的事（tasks.c）：
 * pxStack = pvPortMallocStack(128 * sizeof(StackType_t));
 * 即申请 128 * 4 = 512 字节，够不够用全看任务代码 */
```

```c
/* 抢占式调度演示：高优先级任务先跑、常驻 */
void high_task(void *pvParameters)   /* 优先级 4 */
{
    while (1)
    {
        printf("high  running\r\n");
        LED0_TOGGLE();
        vTaskDelay(500);
    }
}

void low_task(void *pvParameters)    /* 优先级 1 */
{
    while (1)
    {
        printf("low   running\r\n");
        LED1_TOGGLE();
        vTaskDelay(500);
    }
}

/* 观察现象：high 一就绪就抢 CPU，"low running" 只出现在
 * high 阻塞的 500 tick 期间 —— 这就是抢占式调度 */
```

## 动手练习（约 30 分钟）

### 练习 3.1：改优先级，观察调度变化

- 1️⃣ 在你的 FreeRTOS 分支工程里，创建两个任务：task_hi（LED0 翻转，vTaskDelay(500)）和 task_lo（LED1 翻转，vTaskDelay(500)），先给 task_hi 优先级 2、task_lo 优先级 1。
- 2️⃣ 把优先级互换：task_hi 改成 1，task_lo 改成 2。
- **观察什么：**互换前 task_hi 常"压着" task_lo（LED0 闪烁节奏正常，LED1 只在 task_hi 阻塞时动）；互换后 LED0 变"慢半拍"。用串口打印两个任务名更能看清先后顺序——高优先级任务永远先输出。

### 练习 3.2：让任务阻塞，观察就绪态

- 1️⃣ 三个任务：t1（优先级 3，串口打印 "t1"，vTaskDelay(1000)）、t2（优先级 2，打印 "t2"，vTaskDelay(3000)）、t3（优先级 1，打印 "t3"，vTaskDelay(5000)）。
- 2️⃣ 把 t3 的 vTaskDelay 改成 0（vTaskDelay(0) 表示让出当前时间片但不进入阻塞，立即回就绪态）。
- **观察什么：**阻塞时打印顺序严格按优先级排队；t3 用 vTaskDelay(0) 后，打印频率暴涨——它始终就绪，但永远轮不到它跑（t1/t2 优先级更高），这就是"就绪态任务在排队等 CPU"的直观体现。也可以中途把 t1 删除，观察 t3 突然"翻身"。

## 自测（答完再点答案）

### 随堂小测 1

Q1. FreeRTOS 中任务优先级数值与优先级的对应关系是？

- A. 数值越大优先级越高
- B. 数值越小优先级越高
- C. 数值与优先级无关

<details>
<summary>查看答案</summary>

A。FreeRTOS 优先级 0 最低，configMAX_PRIORITIES-1 最高，与 STM32 中断优先级（数值小=高）相反（PDF p.84）。

</details>

### 随堂小测 2

Q2. 任务调用 vTaskDelay(1000) 后处于什么状态？

- A. 挂起态，等待恢复
- B. 阻塞态，延时到期自动就绪
- C. 就绪态，等待调度器分配

<details>
<summary>查看答案</summary>

B。vTaskDelay 延时未到前任务处于阻塞态，超时后自动解除阻塞进入就绪态（PDF p.84）。

</details>

### 随堂小测 3

Q3. 两个同优先级任务轮流运行，靠的是什么机制？

- A. 抢占式调度
- B. 时间片调度
- C. 协程式调度

<details>
<summary>查看答案</summary>

B。时间片调度针对同优先级任务，每个 tick 切换一次；抢占式针对不同优先级（PDF p.85）。

</details>

### 随堂小测 4

Q4. xTaskCreate 的栈大小参数 128，实际占用内存是多少？

- A. 128 字节
- B. 128 字 = 512 字节
- C. 128 个栈帧

<details>
<summary>查看答案</summary>

B。STM32 上 StackType_t 为 uint32_t，1 字 = 4 字节，128 字 = 512 字节（PDF p.88~89）。

</details>

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 5 章（PDF p.82~89）——本课全部依据
- 📖 同书第 3 章 FreeRTOSConfig.h（PDF p.57~65）——configUSE_PREEMPTION、configUSE_TIME_SLICING 等宏出处
- 🌐 [FreeRTOS 官方配置项文档](https://www.freertos.org/a00110.html)——调度相关配置宏的官方说明
- 📕 [Mastering the FreeRTOS™ Real Time Kernel](https://www.freertos.org/Documentation/RTOS_book.html)——第 3 章 "Tasks" 系统讲解任务状态与调度

## 下一步

任务的状态和调度是"概念层"，下一课把它们落成代码——创建、删除、挂起、恢复四个 API 实战。如果对 TCB 里的列表项好奇，那是第 5 课埋的彩蛋，到时候逐字段解剖 😉

| [← 上一课](/my-blog/posts/freertos/0002-porting-and-first-task/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0004-task-api/) |