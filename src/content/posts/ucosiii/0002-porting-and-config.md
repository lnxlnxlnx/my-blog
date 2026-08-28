---
title: 移植与配置
published: 2026-08-14
description: 把 µC/OS-III 三件套搬进工程：文件分组、SYSTEM 文件修改、PendSV 向量替换与四份配置文件，并跑起第一个多任务程序。
tags: [UCOSIII, 嵌入式, RTOS, 移植, 配置, 三件套, SysTick, PendSV]
category: UCOSIII
draft: false
prevTitle: 任务基础
prevSlug: "ucosiii/0003-task-basics"
nextTitle: 初识 µC/OS-III
nextSlug: "ucosiii/0001-intro-to-ucosiii"
---

# 移植与配置

把三件套搬进工程，把 SysTick 与 PendSV 交到内核手里，再跑起第一个多任务程序。**本课目标：**移植的本质只有一句话——**让内核接管板子的"心跳"（SysTick 时基）和"换人"（PendSV 切换）**。学完你能在你的 µC/OS-III 分支工程里完成三件套文件添加、SYSTEM 文件修改、中断服务函数替换与四份配置文件设置，并跑通第一个多任务程序（LED + 串口）。对照 FreeRTOS 课第 2 课，你会看清"移植层"这件外衣两种截然不同的裁剪方式。

## 1. 移植前准备：基础工程 + 三件套源码

µC/OS-III 的移植不是从零写代码，而是"接线"：拿一个能跑的裸机工程当底座，把内核的源码接进去（PDF 第 2.1.1 节 (PDF p.28)）。教材以正点原子的内存管理实验工程为基础，我们直接以你的 µC/OS-III 分支工程为基础（它通常就是从裸机实验工程演化来的）。需要两样东西：

- 🏗️ **基础工程**：裸机能跑，LED/串口/按键外设初始化齐全——这样内核跑起来之后，我们才有"眼睛"观察它。
- 📦 **三件套源码**：µC/OS-III（内核）+ µC/CPU（CPU 抽象层）+ µC/LIB（标准库补充）。版本对应教材的 µC/OS-III V3.08.01 + µC/CPU V1.32.01。

> 💡 对照 FreeRTOS：FreeRTOS 把"CPU 相关"的代码全塞进 `portable/` 目录，内核源码就一个 `tasks.c/queue.c/list.c…`；µC/OS-III 把 CPU 抽象层拆成了独立的 µC/CPU 组件。拆开的好处：内核本身零硬件依赖，换 CPU 只换 µC/CPU 的移植文件——这也是后面我们手写 MiniOS 的参考样板。

## 2. 文件进工程：四个分组 + 八个头文件路径

把三件套源码拷进工程的 `Middlewares/uC-OS3/` 目录后，要在 Keil 里建四个分组并添加文件（PDF 第 2.1.2 节 (PDF p.28~30)）：

| 分组 | 添加的文件 | 职责 |
|------|------|------|
| **BSP** | `uC-CPU/BSP/Template/bsp_cpu.c`、`uC-OS3/Template/bsp_os_dt.c` | 板级：时间戳定时器、OS 调试 |
| **CPU** | `cpu_a.asm`、`cpu_c.c`、`cpu_core.c` | 开关中断、时间戳、CLZ 计数等 CPU 操作 |
| **LIB** | `lib_ascii.c`、`lib_math.c`、`lib_mem.c`、`lib_str.c` | 不依赖编译器库的内存/字符串/数学函数 |
| **OS3** | `os_app_hooks.c`、`os_cpu_a.asm`、`os_cpu_c.c` + `Source/` 下除 `__dbg_uCOS-III.c` 外的全部 C 文件（共 19 个） | 内核本体 + ARM-Cortex-M 移植层 |

文件加完之后，还要在 C/C++ Include Paths 里补 8 个头文件路径（含 `Source/`、`Ports/ARM-Cortex-M/ARMv7-M/ARM/`、`Cfg/Template/`、`uC-CPU/` 等）。缺一个路径，编译就会报"找不到 os.h"。**验收标准：编译 0 error。**

> ⚠️ 教材以战舰 F103 为例（HAL 库），你的探索者 F407 结构完全一致（SYSTEM 文件夹同为 sys/usart/delay 三件），唯一区别：中断服务函数在 `stm32f4xx_it.c` 里，而不是 `stm32f1xx_it.c`（PDF 表 2.1.1 (PDF p.36)）。照着你的 µC/OS-III 分支工程实际路径走，别照抄教材路径。

## 3. 修改 SYSTEM 文件：把"心跳"交给内核

SYSTEM 文件夹要动三个文件：`sys.h`、`usart.c`、`delay.c`（PDF 第 2.1.3 节 (PDF p.31~35)）。核心原则：**SysTick 只有一个主人——OS 跑起来之后，它属于 µC/OS-III**。

- `sys.h`：`#define SYS_SUPPORT_OS 1`——让 SYSTEM 代码知道"我们上面有 OS"。
- `usart.c`：`#include "includes.h"` 改为 `#include "os.h"`（µC/OS-III 的头文件）。
- `delay.c`：改动最大。删掉 µC/OS-II 兼容的宏与 `g_fac_ms` 变量；`delay_init()` 按 `OSCfg_TickRate_Hz` 计算 SysTick 重装载值；`delay_us()` 用 `OSSchedLock()/OSSchedUnlock()` 锁住调度器防止被任务切换打断（微秒级延时绝不能被打断！）。

最关键的交接在 `SysTick_Handler()`——它必须把时基"上报"给内核：

```c
/* delay.c —— SysTick 中断服务函数：OS 接管后的样子 */
void SysTick_Handler(void)
{
    /* OS 开始跑了，才执行正常的调度处理 */
    if (OSRunning == OS_STATE_OS_RUNNING)
    {
        /* 调用 uC/OS-III 的 SysTick 中断服务函数（时基 + 任务延时管理） */
        OS_CPU_SysTickHandler();
    }
    HAL_IncTick();          /* HAL 库自己的滴答计数照旧 */
}

/* delay_init：按内核配置的节拍频率初始化 SysTick */
void delay_init(uint16_t sysclk)
{
    uint32_t reload;
    SysTick->CTRL = 0;
    HAL_SYSTICK_CLKSourceConfig(SYSTICK_CLKSOURCE_HCLK);
    g_fac_us = sysclk;
#if SYS_SUPPORT_OS
    reload = sysclk;
    reload *= 1000000 / OSCfg_TickRate_Hz;   /* 1 秒重载多少次 = 节拍频率 */
    SysTick->CTRL |= 1 << 1;
    SysTick->LOAD = reload;
    SysTick->CTRL |= 1 << 0;
#endif
}
```

`OSCfg_TickRate_Hz` 来自配置文件 `os_cfg_app.h`（默认 1000Hz），这就是"内核设定节拍、delay 负责照做"的分工。对比 FreeRTOS：它的 SysTick 由 `xPortSysTickHandler()` 处理，同样挂在 `SysTick_Handler` 里——两个内核的交接思路一模一样，只是函数名不同。

## 4. 替换中断服务函数：PendSV 向量指向 UCOS

UCOS 有两条命脉：SysTick（时基）和 PendSV（切换）。SysTick 的 Handler 已在 delay.c 里接好，还差 PendSV（PDF 第 2.1.4 节 (PDF p.36~37)）：

1. 删掉 `stm32f4xx_it.c` 里 HAL 默认的 `PendSV_Handler()` 和 `SysTick_Handler()`（以及 .h 里的声明）——否则会与内核的符号冲突。
2. 在启动文件 `startup_stm32f407xx.s` 的向量表里，把 PendSV 那一行改为 `DCD OS_CPU_PendSVHandler`。
3. 把启动文件末尾的弱定义 `PendSV_Handler PROC [WEAK]` 同步改名，否则链接器仍会兜底。

为什么必须换成 `OS_CPU_PendSVHandler`？因为任务切换的现场保存/恢复全在这段汇编里（第 5 课逐行拆）。HAL 的空实现会直接抢走这个入口——**这大概是移植时最常见的"能编译、能烧录、但一调度就死机"的坑**。

## 5. 四个配置文件：裁剪的艺术

µC/OS-III 是被设计成"按需裁剪"的：用不到的模块不编译，RAM/Flash 就省下来了。一共四份配置文件（PDF 表 2.1.2 (PDF p.38)）：

| 文件 | 配置什么 | 关键项举例 |
|------|------|------|
| `os_cfg.h`（第 3 章 (PDF p.60~65)） | 内核功能开关 | `OS_CFG_PRIO_MAX`（最大优先级数，默认 32）、`OS_CFG_SCHED_ROUND_ROBIN_EN`（时间片）、`OS_CFG_SEM_EN` / `OS_CFG_Q_EN` / `OS_CFG_MUTEX_EN` / `OS_CFG_FLAG_EN` / `OS_CFG_TMR_EN` / `OS_CFG_MEM_EN`（各功能模块）、`OS_CFG_ARG_CHK_EN`（参数检查） |
| `os_cfg_app.h`（(PDF p.65~66)） | 内核任务参数 | `OS_CFG_TICK_RATE_HZ`（节拍频率 1000）、`OS_CFG_IDLE_TASK_STK_SIZE`（空闲任务栈）、`OS_CFG_STAT_TASK_PRIO`（统计任务优先级）、`OS_CFG_ISR_STK_SIZE`（异常栈）、`OS_CFG_TMR_TASK_PRIO`（定时器任务优先级） |
| `cpu_cfg.h`（(PDF p.66~67)） | CPU 硬件相关 | `CPU_CFG_NVIC_PRIO_BITS`（F407 设 4）、`CPU_CFG_TS_32_EN`（时间戳）、`CPU_CFG_LEAD_ZEROS_ASM_PRESENT`（CLZ 指令，第 4 课主角） |
| `lib_cfg.h`（(PDF p.68)） | µC/LIB 库 | `LIB_MEM_CFG_HEAP_SIZE`（内存堆大小）、`LIB_MEM_CFG_ARG_CHK_EXT_EN` |

初次移植的偷懒正道：**直接复制教材移植实验配套的这四份配置文件**（教材原话建议，PDF p.38），先跑起来，之后再逐个开关体会裁剪效果。µC/CPU 那份例外——`cpu_cfg.h` 里的 `CPU_CFG_NVIC_PRIO_BITS` 必须打开（`#if 1`），否则内核无法正确管理中断优先级。

> 💡 对照 FreeRTOS：FreeRTOS 只有 `FreeRTOSConfig.h` 一份配置，内核任务（空闲/定时器）的栈大小、优先级也都是宏。UCOS 把配置拆成"功能开关（os_cfg.h）"和"资源参数（os_cfg_app.h）"两份——功能开关决定"编译哪些模块"，资源参数决定"给内核任务分多少栈"。思路更工程化，适合大项目多人协作。

## 6. 移植验证：第一个多任务程序

移植完必须立刻验证。教材的实验结构（PDF 第 2.2 节 (PDF p.56~58)）：`main()` 只做硬件初始化，最后调用 `uc_os3_demo()`；`uc_os3_demo()` 里按"**OSInit → 创建任务 → OSStart**"三步走。经典做法是创建两个任务让它们"同时"闪两个 LED，再加上一个串口任务做旁观者：

```c
/* uc-os3_demo.c —— 第一个多任务程序的骨架 */
#define START_TASK_PRIO   2                        /* start_task 优先级（数值小 = 优先级高） */
#define START_STK_SIZE    512
OS_TCB   StartTask_TCB;                            /* 任务控制块：用户自己提供 */
CPU_STK  StartTask_STK[START_STK_SIZE];            /* 任务栈：用户自己提供 */

void uc_os3_demo(void)
{
    OS_ERR err;
    OSInit(&err);                                  /* ① 初始化内核（必须先于一切） */

    OSTaskCreate((OS_TCB*)&StartTask_TCB,          /* ② 创建 start_task */
                 (CPU_CHAR*)"start_task",
                 (OS_TASK_PTR)start_task,          /* 任务函数指针 */
                 (void*)0,                         /* 传给任务的参数 */
                 (OS_PRIO)START_TASK_PRIO,         /* 优先级 */
                 (CPU_STK*)StartTask_STK,          /* 任务栈首地址 */
                 (CPU_STK_SIZE)START_STK_SIZE / 10,/* 栈警戒水位 */
                 (CPU_STK_SIZE)START_STK_SIZE,     /* 栈大小（单位：字） */
                 (OS_MSG_QTY)0,                    /* 任务内嵌消息队列长度 */
                 (OS_TICK)0,                       /* 时间片（0 = 用默认值） */
                 (void*)0,                         /* 扩展指针 */
                 (OS_OPT)(OS_OPT_TASK_STK_CHK | OS_OPT_TASK_STK_CLR), /* 选项 */
                 (OS_ERR*)&err);                   /* 错误码指针：UCOS 的"返回值" */

    OSStart(&err);                                 /* ③ 启动调度（永不返回） */
    for (;;);                                      /* 到不了这里 */
}

void start_task(void *p_arg)
{
    OS_ERR err;
    CPU_Init();                                    /* 初始化 CPU 库 */
    OS_CPU_SysTickInit((CPU_INT32U)(HAL_RCC_GetSysClockFreq() / OSCfg_TickRate_Hz));
                                                   /* 按配置频率启动 SysTick */
    OSSchedRoundRobinCfg(OS_TRUE, 0, &err);        /* 开启时间片调度 */

    OSTaskCreate((OS_TCB*)&Task1Task_TCB, (CPU_CHAR*)"task1", task1,
                 (void*)0, (OS_PRIO)3, Task1Task_STK,
                 TASK1_STK_SIZE / 10, TASK1_STK_SIZE,
                 0, 0, (void*)0, OS_OPT_TASK_STK_CHK | OS_OPT_TASK_STK_CLR, &err);
    OSTaskCreate((OS_TCB*)&Task2Task_TCB, (CPU_CHAR*)"task2", task2,
                 (void*)0, (OS_PRIO)4, Task2Task_STK,
                 TASK2_STK_SIZE / 10, TASK2_STK_SIZE,
                 0, 0, (void*)0, OS_OPT_TASK_STK_CHK | OS_OPT_TASK_STK_CLR, &err);

    OSTaskDel((OS_TCB*)0, &err);                   /* start_task 功成身退：删除自己 */
}

void task1(void *p_arg)                            /* 任务 1：闪 LED */
{
    OS_ERR err;
    while (1) {
        LED0_TOGGLE();
        OSTimeDly(1000, OS_OPT_TIME_DLY, &err);    /* 延时 1000 ticks = 1 秒，主动让出 CPU */
    }
}

void task2(void *p_arg)                            /* 任务 2：串口旁观者 */
{
    OS_ERR err;
    float num = 0.0f;
    while (1) {
        num += 0.01f;
        printf("task2: %0.4f\r\n", num);
        OSTimeDly(1000, OS_OPT_TIME_DLY, &err);
    }
}
```

**验收标准：**烧录后两个 LED 各按 1 秒周期交替闪烁，串口每秒吐一行浮点数——说明两个任务真的在"同时"跑，移植成功。观察两个细节：`OSTaskCreate` 的 TCB 和栈都要用户自己给（对比 FreeRTOS 的动态创建 `xTaskCreate` 是内核帮你分配的）；错误码不是返回值，而是 `OS_ERR*` 指针写出来的。

> ⚠️ 两个新坑预警：① `OSStart()` 之前必须至少创建一个应用任务，否则它直接报 `OS_ERR_OS_NO_APP_TASK` 返回（PDF p.128）；② `OS_CPU_SysTickInit()` 一定要在 start_task 里、创建其他任务之前调用——它没跑，内核没有心跳，任务会全部"原地踏步"。

## 动手练习（约 30 分钟）

### 练习 2.1：在你的 µC/OS-III 分支工程指认三件套

- 1️⃣ 打开你的 µC/OS-III 分支工程，确认 `Middlewares/uC-OS3/` 下三个组件目录（OS3 / CPU / LIB）齐全，核对四个分组（BSP/CPU/LIB/OS3）里的文件与本文表格一致。
- 2️⃣ 检查 Include Paths 是否覆盖 `Source/`、`Ports/…/ARM/`、`Cfg/Template/`、`uC-CPU/` 等关键目录，然后全量编译一次，目标：0 error 0 warning（有 warning 也顺手清掉）。
- **观察什么：**对照 FreeRTOS 分支工程：FreeRTOS 的 portable 目录与 UCOS 的 Ports 目录里都有 `*.asm`（汇编切换代码），找出来各是哪个文件，写一行笔记。

### 练习 2.2：跑通第一个多任务程序

- 1️⃣ 按第 6 节骨架写两个任务：task1 翻转 LED0、task2 翻转 LED1，都用 `OSTimeDly(500, OS_OPT_TIME_DLY, &err)`，观察两个 LED 各自闪烁。
- 2️⃣ 修改 `os_cfg_app.h` 里的 `OS_CFG_TICK_RATE_HZ`：从 1000 改成 500，重新编译烧录——观察 LED 闪烁频率变化。
- **观察什么：**`OSTimeDly(500)` 是"500 个 tick"，不是"500 毫秒"！节拍频率从 1000 降到 500 后，500 tick 从 0.5s 变成 1s——LED 明显变慢。这堂课的价值：**tick 与毫秒的换算**是 RTOS 新手第一道坎。

## 自测（答完再点答案）

### 随堂小测 1

Q1. µC/OS-III 移植中，SysTick 中断服务函数最终要调用谁？

- A. HAL_IncTick()
- B. OS_CPU_SysTickHandler()
- C. OS_CPU_PendSVHandler()

<details>
<summary>查看答案</summary>

B。SysTick 是内核时基，OS 运行后必须调用 OS_CPU_SysTickHandler()（PDF p.33~34）；PendSV 才是切换用的。

</details>

### 随堂小测 2

Q2. 向量表中 PendSV 的入口要替换成哪个函数？

- A. PendSV_Handler
- B. OS_CPU_PendSVHandler
- C. OS_CPU_SysTickHandler

<details>
<summary>查看答案</summary>

B。任务切换的现场保存在 OS_CPU_PendSVHandler 汇编里，必须替换掉 HAL 的空实现（PDF p.37）。

</details>

### 随堂小测 3

Q3. 配置 STM32F407 时，cpu_cfg.h 中 NVIC 优先级位数应设为？

- A. 1 位
- B. 2 位
- C. 4 位

<details>
<summary>查看答案</summary>

C。STM32F4 的 NVIC 使用 4 位优先级，CPU_CFG_NVIC_PRIO_BITS 必须置 1 打开并设为 4（PDF p.38, 67）。

</details>

### 随堂小测 4

Q4. OSStart() 之前，最少要完成什么准备工作？

- A. OSInit 加至少一个应用任务
- B. 只调用 OSInit 即可
- C. 配置好全部四个配置文件

<details>
<summary>查看答案</summary>

A。OSStart() 会检查 OSInitialized 和应用任务数量，两者不满足直接报错返回（PDF p.128）。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 2 章（PDF p.28~58）——移植全流程与移植实验
- 📖 同书第 3 章（PDF p.60~69）——四份配置文件的全部配置项详解
- 🌐 [Weston Embedded（Micrium 后继）µC/OS-III 主页](https://weston-embedded.com/uc-os-iii)——官方文档、配置项在线说明入口
- 🔁 对照：[FreeRTOS 课程第 2 课（移植与第一个任务）](/my-blog/posts/freertos/0002-porting-and-first-task/)——两套移植方案的差异对照基准

## 下一步

移植跑通只是热身，接下来要钻进内核看"任务到底是个什么东西"——状态、优先级、调度、TCB、任务栈，把地基打牢。有疑问随时问我，Agent 就是你的老师 😄

| [← 上一课](/my-blog/posts/ucosiii/0001-intro-to-ucosiii/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0003-task-basics/) |