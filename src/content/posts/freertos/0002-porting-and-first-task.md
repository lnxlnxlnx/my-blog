---
title: 移植与第一个任务
published: 2026-08-13
description: FreeRTOS 系列课程第 2 课：完成 FreeRTOS V10.4.6 到 STM32F407 的移植认知闭环——内核/移植层文件、SysTick 时基交接、SVC/PendSV/SysTick 中断三剑客、FreeRTOSConfig.h 关键宏，并跑通两个 LED 任务交替闪烁。
tags: [FreeRTOS, 嵌入式, RTOS, 移植, 第一个任务, SysTick, PendSV]
category: FreeRTOS
draft: false
prevTitle: 任务基础知识
prevSlug: "freertos/0003-task-basics"
nextTitle: 初识 FreeRTOS
nextSlug: "freertos/0001-intro-to-freertos"
---

# 移植与第一个任务

这是 FreeRTOS 系列课程笔记的第 2 课：把 FreeRTOS 内核装进你的分支工程，点亮第一个任务。**本课目标：**完成 FreeRTOS V10.4.6 到 STM32F407 的移植认知闭环。学完你能在自己的 FreeRTOS 分支工程里说清楚：哪些文件是内核、哪些是移植层、为什么 SysTick 时基要"交接"给 FreeRTOS、三个中断服务函数为什么被屏蔽，以及一个任务从创建到跑起来的完整链路。真机实验：两个 LED 任务交替闪烁。

## 1. 移植前准备：一个基础工程 + 一份源码

移植的本质是**把"与芯片无关的内核"和"与芯片有关的硬件"对接起来**。准备两样东西（PDF 第 2.1.1 节（PDF p.28））：

- 🎯 **基础工程**：裸机 HAL 库工程即可（含 LED、串口等驱动）。正点原子例程以内存管理实验为底子，你的 FreeRTOS 分支工程同理——功能不需要多，能跑裸机就够。
- 📦 **内核源码**：FreeRTOS v202112.00（内核 V10.4.6），也就是本课程依据的版本。

正点原子把"源码全量拷进工程"作为移植方法。F407 探索者对应关系（PDF 表 2.1.2.1（PDF p.29））：

| 开发板 | ARMCC（AC5） | ARMClang（AC6） |
|------|------|------|
| STM32F1 | RVDS/ARM_CM3 | GCC/ARM_CM3 |
| **STM32F4 / G4（你的板子）** | **RVDS/ARM_CM4F** | **GCC/ARM_CM4F** |
| STM32F7 / H7 | RVDS/ARM_CM7/r0p1 | GCC/ARM_CM7/r0p1 |

CM4F 里的 `F` 代表带 FPU（浮点单元），port 文件里会额外处理 FPU 寄存器保存（比如 `prvEnableVFP()`），所以 F4 的移植层和 F1 不能混用。

## 2. 添加文件：内核 + 移植层 + 内存管理

在工程里新建分组，把源码按三类放好（PDF 第 2.1.2 节（PDF p.29~30））：

- 🧩 **内核核心**：`Source/` 下的 8 个 .c（tasks.c、queue.c、list.c、timers.c、event_groups.c、stream_buffer.c、croutine.c 等），对应 `Middlewares/FreeRTOS_CORE` 分组。
- 🔌 **移植层 port 文件**：F407 + AC5 用 `portable/RVDS/ARM_CM4F/`（port.c、portmacro.h 等）；AC6 用 `portable/GCC/ARM_CM4F/`。port 文件是"软件内核 ↔ MCU 硬件"的桥梁。
- 🗄️ **内存管理算法**：`portable/MemMang/` 下 5 个 heap_x.c，正点原子例程选 `heap_4.c`（后续内存管理课详细分析，先记住：任务栈、TCB 都从这里分配）。

还要加两个头文件路径：`Source/include` 和 port 文件所在目录。最后是 `FreeRTOSConfig.h`——FreeRTOS 的"裁剪开关"，获取途径有三种（自己写 / 官方 Demo 工程抄 / 例程 User 文件夹拿），新手建议直接拿例程的（PDF p.30~31）。**注意：F1 和 F4 的 FreeRTOSConfig.h 不通用**，原因是两者 SysTick 时钟源不同（F1 是 HCLK/8，F4 是 HCLK），这个差异在第 3 节会看到影响。

> 💡 一个辨认技巧：凡是 `portable/` 里的文件，都是"这芯片专属"的；凡是 `Source/` 根目录的 .c，都是"全世界通用"的。以后看 FreeRTOS 源码时，用这个边界区分关注点。

## 3. 修改系统文件：SysTick 时基的"交接仪式"

这是移植里最"反直觉"的一步。正点原子例程的 SYSTEM 文件夹（sys.h、usart.c、delay.c）原本是给 µC/OS 写的，要改成配合 FreeRTOS（PDF 第 2.1.3 节（PDF p.32~40））：

### 3.1 sys.h：打开 OS 支持开关

```c
/* sys.h：SYS_SUPPORT_OS 用于定义系统文件夹是否支持 OS */
#define SYS_SUPPORT_OS  1   /* 0: 不支持 OS   1: 支持 OS */
```

### 3.2 usart.c：删掉 µC/OS 的中断进出函数

µC/OS 要求中断里调用 OSIntEnter()/OSIntExit()，FreeRTOS 没这套机制，直接删掉这两行，保留 HAL 库的串口中断处理即可。

### 3.3 delay.c：SysTick 时基交接（核心）

**原则：SysTick 是 FreeRTOS 的心跳（系统节拍），必须由 FreeRTOS 接管。**裸机时 delay_ms 靠 SysTick 忙等，OS 起来后 SysTick 归调度器管。正点原子的改造思路：

- `delay_init()`：重装载值不再写死，改用 `configTICK_RATE_HZ`（每秒节拍数）计算——调度器启动前这段时间，SysTick 仍可做裸机延时。
- `SysTick_Handler()`：OS 运行后调用 `xPortSysTickHandler()`，让 FreeRTOS 完成节拍计数并可能触发任务切换。AC5 下 port 文件没实现这个函数，要 `extern` 导入；AC6 下 port 文件自带 SysTick_Handler，需要在 delay.c 里仿照实现。
- `delay_us()/delay_ms()`：删掉 µC/OS 的调度锁/OS 延时，delay_ms 简化为纯忙延时。任务里要"睡一会儿"，请用 `vTaskDelay()`（第 12 课时间管理详讲）。

```c
/* delay.c（F4 系列）——SysTick 时基交接给 FreeRTOS */

/* AC5 下需要手动导入这个函数（AC6 的 port 文件自带） */
extern void xPortSysTickHandler(void);

void delay_init(uint16_t sysclk)
{
    uint32_t reload;

    HAL_SYSTICK_CLKSourceConfig(SYSTICK_CLKSOURCE_HCLK); /* F4：SysTick 时钟源 = HCLK */
    g_fac_us = sysclk;

    reload = sysclk;
    /* 关键点：重装载值由 configTICK_RATE_HZ 决定，不再写死 */
    reload *= 1000000 / configTICK_RATE_HZ;

    SysTick->CTRL |= SysTick_CTRL_TICKINT_Msk;
    SysTick->LOAD  = reload;
    SysTick->CTRL |= SysTick_CTRL_ENABLE_Msk;
}

void SysTick_Handler(void)
{
    HAL_IncTick();   /* HAL 库自己的时基计数，保留 */
    /* OS 开始跑了，才执行正常的调度处理 */
    if (xTaskGetSchedulerState() != taskSCHEDULER_NOT_STARTED)
    {
        xPortSysTickHandler();  /* 让 FreeRTOS 处理节拍：计数 + 可能触发调度 */
    }
}
```

## 4. 中断三剑客：SVC、PendSV、SysTick

FreeRTOS 内核依赖三个异常来工作（PDF 第 2.1.4 节（PDF p.40~41））：

- ⏱️ **SysTick**：系统时基，每个节拍产生一次中断（心跳）。
- 🔄 **PendSV**：任务切换的"专车"——可挂起的异常，优先级最低，等当前中断处理完再切换，避免任务切换打断中断。
- 🚀 **SVC**：启动第一个任务时使用。

HAL 库在 `stm32f4xx_it.c` 里给了这三个函数的空实现，必须屏蔽，否则和 FreeRTOS 自己的实现冲突（链接重复定义）。正点原子的做法是加宏开关（PDF p.40）：

```c
/* stm32f4xx_it.c —— 三个中断服务函数全部交给 FreeRTOS */

#include "./SYSTEM/SYS/sys.h"   /* 导入 SYS_SUPPORT_OS 宏 */

#if (!SYS_SUPPORT_OS)
void SVC_Handler(void)      /* FreeRTOS 启动第一个任务时使用 */
{
}
#endif

#if (!SYS_SUPPORT_OS)
void PendSV_Handler(void)   /* FreeRTOS 任务切换时使用 */
{
}
#endif

#if (!SYS_SUPPORT_OS)
void SysTick_Handler(void)  /* FreeRTOS 时基使用（delay.c 里已有实现） */
{
    HAL_IncTick();
}
#endif
```

三个中断的具体工作流程，第 6 课（系统启动流程）和第 7 课（任务切换）会逐行拆解，这里先混个脸熟。

最后还有一个 Keil 专属坑：`stm32f407xx.h` 里的 `__NVIC_PRIO_BITS` 定义为 `4U`，直接编译 FreeRTOS 会报错，把 `4U` 改成 `4` 即可（PDF p.41）。

## 5. FreeRTOSConfig.h 关键宏初识

配置宏分两类："config"开头管功能裁剪，"INCLUDE"开头管 API 条件编译（PDF 第 3.2 节（PDF p.57~60））。先认识 6 个最重要的：

| 宏 | 含义 | 正点原子例程典型值 |
|------|------|------|
| `configTICK_RATE_HZ` | 系统节拍频率（每秒 tick 数），单位 Hz | 1000（每 tick 1ms） |
| `configTOTAL_HEAP_SIZE` | FreeRTOS 内存堆大小，单位**字节** | 几十 KB（按 RAM 定） |
| `configMINIMAL_STACK_SIZE` | 空闲任务栈大小，单位**字** | 128 |
| `configUSE_PREEMPTION` | 1=抢占式调度，0=协程式调度 | 1 |
| `configMAX_PRIORITIES` | 任务优先级数量，优先级范围 0~(N-1) | 32 |
| `configUSE_TIME_SLICING` | 同优先级任务是否时间片轮转 | 1 |

> ⚠️ `configTOTAL_HEAP_SIZE` 是**字节**，任务栈大小是**字**（1 字 = 4 字节）。一个 128 字的任务栈实际吃掉 512 字节堆内存。把这两个单位搞混，轻则任务创建失败，重则堆耗尽系统跑飞——这是新手最常见的移植翻车点。

## 6. 第一个任务：两个任务交替闪烁

移植完当然是跑一个任务验证。正点原子移植实验的结构（PDF 第 2.1.6 节（PDF p.43~51））：`main()` 只做外设初始化，然后调用 `freertos_demo()`；应用代码全部放 `freertos_demo.c`。

```c
/* freertos_demo.c —— 第一个 FreeRTOS 任务 */

void task1(void *pvParameters);
void task2(void *pvParameters);

#define START_TASK_PRIO  1      /* 开始任务优先级 */
#define START_STK_SIZE   128    /* 开始任务栈大小（单位：字） */
TaskHandle_t StartTask_Handler;

#define TASK1_PRIO       2
#define TASK1_STK_SIZE   128
TaskHandle_t Task1Task_Handler;

#define TASK2_PRIO       3
#define TASK2_STK_SIZE   128
TaskHandle_t Task2Task_Handler;

void freertos_demo(void)
{
    /* 先创建"开始任务"，它负责创建其他任务 */
    xTaskCreate((TaskFunction_t)start_task,   /* 任务函数 */
                (const char *)"start_task",   /* 任务名 */
                (uint16_t)START_STK_SIZE,     /* 栈大小：128 字 = 512 字节 */
                (void *)NULL,                 /* 任务参数 */
                (UBaseType_t)START_TASK_PRIO, /* 优先级 1 */
                (TaskHandle_t *)&StartTask_Handler);
    vTaskStartScheduler();   /* 开启调度器：正常情况从此不再返回 */
}

void start_task(void *pvParameters)
{
    taskENTER_CRITICAL();   /* 进临界区：创建过程中禁止调度 */
    xTaskCreate(task1, "task1", TASK1_STK_SIZE, NULL, TASK1_PRIO, &Task1Task_Handler);
    xTaskCreate(task2, "task2", TASK2_STK_SIZE, NULL, TASK2_PRIO, &Task2Task_Handler);
    vTaskDelete(StartTask_Handler);  /* 开始任务功成身退，删除自己 */
    taskEXIT_CRITICAL();
}

void task1(void *pvParameters)
{
    uint32_t task1_num = 0;
    while (1)
    {
        lcd_clear(lcd_discolor[++task1_num % 14]); /* 刷新屏幕 */
        LED0_TOGGLE();                            /* LED0 翻转 */
        vTaskDelay(1000);  /* 阻塞 1000 个 tick（约 1 秒），让出 CPU */
    }
}

void task2(void *pvParameters)
{
    float float_num = 0.0f;
    while (1)
    {
        float_num += 0.01f;
        printf("float_num: %0.4f\r\n", float_num); /* 串口打印 */
        vTaskDelay(1000);
    }
}
```

`vTaskStartScheduler()` 启动调度器时干六件事（PDF p.132）：① 创建空闲任务；② 若启用软件定时器则创建定时器服务任务；③ 关闭中断（防止 SysTick 在调度器就绪前抢跑）；④ 初始化全局变量并置调度器运行标志；⑤ 初始化运行时间统计的时基（若启用）；⑥ 调用 `xPortStartScheduler()` 启动第一个任务。

为什么 task1 和 task2 能"同时"闪烁？优先级 3 > 2 > 1，抢占式调度下 task2 先跑，但两个任务都会在 `vTaskDelay(1000)` 处主动阻塞让出 CPU，于是它们在时间轴上交替占用 CPU，宏观上就像同时在跑（PDF 第 2.2.3 节（PDF p.55））。

> 💡 移植是否成功的判据很简单：LED 以可预测的节奏闪烁 + 串口稳定输出，且两个任务互不干扰。如果 LED 乱闪或系统死机，优先怀疑三处：中断屏蔽是否生效（SVC/PendSV 重复定义）、configTOTAL_HEAP_SIZE 是否够用、SysTick_Handler 是否调用了 xPortSysTickHandler。

## 动手练习（约 30 分钟）

### 练习 2.1：在 FreeRTOS 分支工程里指认移植文件

- 1️⃣ 切换到你的 FreeRTOS 分支工程（当前分支不动），找到内核源码目录（一般是 `Middlewares/Third_Party/FreeRTOS/Source/` 或类似路径）。
- 2️⃣ 对照本课表格确认：8 个内核 .c、`portable/` 下针对你编译器的 `ARM_CM4F` 目录、`MemMang/heap_4.c`、两个头文件路径、FreeRTOSConfig.h。
- 3️⃣ 打开 `stm32f4xx_it.c`，确认 SVC/PendSV/SysTick 三个函数被宏开关屏蔽；打开 `delay.c`，确认 SysTick_Handler 调用了 `xPortSysTickHandler()`。
- **观察什么：**编译 0 Error；在 delay.c 的 SysTick_Handler 里打断点，复位后能看到它被节拍中断持续命中。

### 练习 2.2：跑通两个 LED 任务 + 改节拍频率

- 1️⃣ 照教材移植实验，创建两个任务：task1 翻转 LED0、task2 翻转 LED1（或用串口打印），都用 `vTaskDelay(1000)`，优先级分别为 2 和 3。
- 2️⃣ 下载运行，观察两个 LED 交替闪烁、串口每约 1 秒输出一次。
- 3️⃣ 把 FreeRTOSConfig.h 里 `configTICK_RATE_HZ` 从 1000 改成 500，重新编译下载。
- **观察什么：**同样写 `vTaskDelay(1000)`，LED 闪烁周期翻倍（约 2 秒）——因为 1000 个 tick 现在等于 2 秒。这直观证明了"tick 是时间单位，不是毫秒单位"，也解释了为什么 delay_init 要用 configTICK_RATE_HZ 算重装载值。实验完改回 1000。

## 自测（答完再点答案）

### 随堂小测 1

Q1. STM32F407 + ARMCC（AC5）应使用哪个 port 移植文件？

- A. portable/RVDS/ARM_CM4F
- B. portable/RVDS/ARM_CM3
- C. portable/GCC/ARM_CM7/r0p1

<details>
<summary>查看答案</summary>

A。F4 带 FPU，ARMCC 用 RVDS/ARM_CM4F（PDF 表 2.1.2.1，p.29）；AC6 才换 GCC/ARM_CM4F。

</details>

### 随堂小测 2

Q2. FreeRTOS 启动任务调度后，SysTick 中断由谁接管处理？

- A. 用户自己的 SysTick_Handler 裸机逻辑
- B. FreeRTOS 的 xPortSysTickHandler 处理节拍
- C. HAL 库的 HAL_IncTick 独立处理

<details>
<summary>查看答案</summary>

B。SysTick 是 FreeRTOS 心跳，中断里要调用 xPortSysTickHandler() 完成节拍计数和调度检查（PDF p.36）。

</details>

### 随堂小测 3

Q3. 移植时为什么要屏蔽 HAL 库的 SVC/PendSV/SysTick 空实现？

- A. 因为这三个中断在 HAL 库中配置错误
- B. 因为 FreeRTOS 提供了自己的实现，会重复定义
- C. 因为 Cortex-M4 内核不支持这三个中断

<details>
<summary>查看答案</summary>

B。FreeRTOS 的 port 文件自带这三个中断服务函数，HAL 库的空实现必须用宏开关屏蔽，否则链接冲突（PDF p.40~41）。

</details>

### 随堂小测 4

Q4. configTICK_RATE_HZ = 1000 时，vTaskDelay(1000) 延时的实际时长约是多少？

- A. 约 1000 毫秒（1 秒）
- B. 约 1000 微秒（1 毫秒）
- C. 约 1000 个 CPU 时钟周期

<details>
<summary>查看答案</summary>

A。tick 频率 1000Hz 意味着每个 tick 约 1ms，1000 个 tick ≈ 1 秒（PDF p.55）。节拍频率改了，同样的 tick 数对应时长就变。

</details>

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 2 章（PDF p.28~56）——本课移植全流程依据
- 📖 同书第 3 章 FreeRTOSConfig.h 配置项详解（PDF p.57~65）——6 个关键宏的完整描述
- 🌐 [FreeRTOS 官方 FreeRTOSConfig.h 配置说明](https://www.freertos.org/a00110.html)——每个配置项的官方解释
- 📕 [Mastering the FreeRTOS™ Real Time Kernel](https://www.freertos.org/Documentation/RTOS_book.html)——官方免费书，第 1~2 章可对照"任务是什么"

## 下一步

移植跑通只是第一步，接下来要回答"任务到底是个什么东西"——状态、优先级、调度方式、任务控制块，把地基打牢。有疑问随时问我，Agent 就是你的老师 😄

| [← 上一课](/my-blog/posts/freertos/0001-intro-to-freertos/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0003-task-basics/) |