---
title: 任务基础
published: 2026-08-15
description: 五种任务状态、反向优先级、抢占+时间片调度——以及那张"身份证" OS_TCB，任务概念层的地基。
tags: [UCOSIII, 嵌入式, RTOS, 任务状态, 优先级, TCB, 任务栈]
category: UCOSIII
draft: false
prevTitle: 位图就绪表
prevSlug: "ucosiii/0004-bitmap-ready-list"
nextTitle: 移植与配置
nextSlug: "ucosiii/0002-porting-and-config"
---

# 任务基础

五种状态、反向优先级、抢占+时间片——以及那张"身份证"OS_TCB。**本课目标：**上一课内核跑起来了，这一课回答"任务是什么"。学完你能画出 µC/OS-III 五种任务状态的转换图，说清优先级"数值越小越优先"的来历（**和 FreeRTOS 正好相反，重点对比！**），分清抢占式调度与时间片调度，读懂 `OS_TCB` 的关键字段，并理解任务栈大小的单位为什么是"字"。这是后续一切 API 与内核机制的地基。

## 1. 单任务系统 vs 多任务系统

单任务系统就是裸机的前后台系统（PDF 第 5.1.1 节 (PDF p.81)）：`main()` 里一个大 while 循环顺序处理事务（后台），中断服务函数处理紧急事件（前台）。致命弱点是**实时性差**——事务没有优先级之分，再紧急也得排队。

多任务系统把大循环拆成多个独立任务（PDF 第 5.1.2 节 (PDF p.81~82)）：单核 CPU 同一时刻仍只能跑一个任务，但调度器按调度算法极快地分配 CPU 使用权，宏观上造成多个任务"同时"运行的错觉。关键收益：**紧急事务可以放进高优先级任务，像中断抢占一样立刻获得 CPU**。

## 2. 任务状态：µC/OS-III 的五种状态

µC/OS-III 中任务存在五种状态（PDF 第 5.2 节 (PDF p.82~83)），一个任务在某一时刻一定处于其中之一：

| 状态 | 含义 | 进入/离开方式 |
|------|------|------|
| 😴 **休眠态** | 代码已存在，但内核还不知道它 | 进：`OSTaskCreate()`；离开：`OSTaskDel()`（删任务只是退回休眠态，不是删代码） |
| 💺 **就绪态** | 已创建、具备运行条件，排队等 CPU | 进：创建/等待事件发生/延时结束；离开：被调度器选中 |
| 🏃 **运行态** | CPU 正在执行它（单核下同一时刻只有一个） | 进：调度器选中；离开：被抢占/等待事件/主动延时 |
| ⏳ **挂起态** | 等待某个事件：信号量、消息队列、事件标志、延时到期… | 进：`OSSemPend()`/`OSTimeDly()` 等；离开：事件发生/超时/被 `OSTaskResume()` 唤醒 |
| 🔔 **中断态** | 被中断打断，CPU 去执行 ISR | 进：中断触发；离开：`OSIntExit()` 后返回原任务或切到更高优先级任务 |

状态转换的几条主线（对应教材图 5.2.1 (PDF p.83)）：休眠→就绪靠 `OSTaskCreate()`；就绪→运行靠调度器（`OSStart()` 或 `OS_TASK_SW()`）；运行→就绪是**被更高优先级任务抢占**；运行→挂起是等待事件（`OSFlagPend()`/`OSMutexPend()`/`OSQPend()`/`OSSemPend()`/`OSTaskQPend()`/`OSTaskSemPend()`/`OSTimeDly()` 等）；挂起→就绪是事件发生（`OSxxxPost()`）、超时或终止等待（`OSxxxPendAbort()`）、`OSTimeTick()` 唤醒延时；运行→中断是被打断，中断→运行/就绪靠 `OSIntExit()` 返回。

> 💡 对照 FreeRTOS：FreeRTOS 任务只有四态（运行/就绪/阻塞/挂起），µC/OS-III 是五态——多了一个"中断态"，而且把"等待事件"和"延时"都归入挂起态（FreeRTOS 里阻塞态管这两件事）。另外 UCOS 的"休眠态"对应 FreeRTOS 的"任务还没被 xTaskCreate"的状态。状态划分只是记账粒度不同，本质都是"排队等 CPU / 等事件 / 正在跑"。

## 3. 任务优先级：数值越小，优先级越高 ⚠️

每个任务被分配 0~(OS_CFG_PRIO_MAX-1) 的优先级，µC/OS-III 支持多个任务相同优先级（PDF 第 5.3 节 (PDF p.84)）：

- **数值 0 是最高优先级**，(OS_CFG_PRIO_MAX-1) 是最低优先级。
- 优先级数值与优先级的逻辑关系**和 STM32 中断优先级完全一致**（数值小=高），很好记。
- `OS_CFG_PRIO_MAX` 默认 32：因为 STM32 的 CLZ 前导零指令最多处理 32 位，位图就绪表直接一表到底（第 4 课主角）。配置的优先级数量越多，系统消耗资源越多，够用就好。

> ⚠️ 与 FreeRTOS 相反！FreeRTOS 数值越大越优先（0 最低），µC/OS-III 数值越小越优先（0 最高）。两套课程来回切换时这是最容易栽的跟头——写错优先级不会编译报错，只会出现"任务永远不运行"的诡异现象。记忆锚点：µC/OS-III 的优先级方向和 STM32 中断一致，FreeRTOS 是反的。

## 4. 调度方式：抢占式 + 时间片

µC/OS-III 是一个基于优先级的抢占式内核，抢占为主、时间片为辅（PDF 第 5.4 节 (PDF p.84~85)）：

- ⚔️ **抢占式调度**：针对优先级不同的任务。高优先级任务随时抢占低优先级任务；高优先级任务等待的事件在中断里发生时，中断退出后**直接返回高优先级任务**，而不是低优先级任务——这是"抢占"最锋利的体现。
- 🔁 **时间片调度**：针对优先级相同的任务。多个同优先级任务就绪时，按各自设置的时间片轮流运行，时间片以一次节拍（tick）为单位。默认时间片 = `OSCfg_TickRate_Hz / 10`（1000Hz 时就是 100 个 tick，见 os_core.c 的 `OSSchedRoundRobinDfltTimeQuanta`）。时间片运行中依然会被更高优先级任务抢占。

抢占发生的两个典型时刻：任务调用了会触发调度的 API（如 `OSTimeDly`、信号量 `Post`），以及 SysTick 节拍中断里发现更高优先级任务就绪（第 5 课拆 `OSSched()`/`OSIntExit()` 时会看到）。

## 5. 任务控制块 OS_TCB：任务的"身份证"

任务控制块（TCB）是内核存放任务信息的数据结构，**每个任务都要一个独立的 OS_TCB 变量，内存由用户提供**（PDF 第 5.5 节 (PDF p.85~89)）。结构体定义在 os.h，绝大部分字段可由配置文件裁剪。核心字段逐个看：

```c
/* os.h 中 struct os_tcb 的关键字段（裁剪掉调试/统计等次要成员） */
struct os_tcb {
    CPU_STK   *StkPtr;            /* 指向任务栈栈顶：切换现场时从这里恢复寄存器（第一个成员！） */
    void      *ExtPtr;            /* 指向用户自定义数据 */
    CPU_STK   *StkLimitPtr;       /* 任务栈"水位"限制：栈剩余量小于此值视为危险 */
    OS_TCB    *NextPtr, *PrevPtr; /* 双向链表指针：把任务串进就绪链表/任务链表 */

    OS_TCB    *PendNextPtr, *PendPrevPtr;   /* 挂起等待链表的双向指针 */
    OS_PEND_OBJ *PendObjPtr;      /* 指向所等待的内核对象（信号量/队列/互斥量…） */
    OS_STATE  PendOn;             /* 在等什么：OS_TASK_PEND_ON_SEM / _Q / _MUTEX… */
    OS_STATUS PendStatus;         /* 等待结果：正常 / 超时 / 被终止 */

    OS_STATE  TaskState;          /* 任务当前状态：就绪/运行/挂起/… */
    OS_PRIO   Prio;               /* 任务优先级（数值小 = 高） */
    OS_PRIO   BasePrio;           /* 原始优先级：互斥量优先级翻转后用来恢复（第 12 课） */

    OS_SEM_CTR SemCtr;            /* 任务内嵌信号量计数（任务也能直接收信号） */
    OS_TICK   TickRemain;         /* 任务延时的剩余节拍数 */
    OS_TICK   TimeQuanta;         /* 任务时间片（tick 数，0 = 用默认值） */
    OS_TICK   TimeQuantaCtr;      /* 剩余时间片计数 */
    void     *MsgPtr;             /* 任务内嵌消息队列收到的消息指针 */
};
```

三个值得记住的设计点：

- `StkPtr` 是**第一个成员**——和 FreeRTOS 的 `pxTopOfStack` 一样，汇编代码 `LDR R0, [R2]` 零偏移取栈顶指针，这是任务切换的硬件约定（第 5 课验证）。
- `PendObjPtr` 指向"任务在等什么"——µC/OS-III 用**内核对象指针**表达等待关系；FreeRTOS 则是把列表项挂进对象的等待列表。两种表达，同一个意思。
- 绝大多数字段按配置裁剪：不用互斥量就不编译 `BasePrio`，不用时间片就不编译 `TimeQuanta`——"按需编译"是 UCOS 内存可控的秘诀。

> 💡 对照 FreeRTOS TCB：FreeRTOS 的 `tskTCB` 里是 `pxTopOfStack`（栈顶）、`uxPriority`（优先级）、`uxBasePriority`（基础优先级）、`xStateListItem/xEventListItem`（两个列表项）——**用"列表项+链表"组织任务**；UCOS 的 OS_TCB 里是 `NextPtr/PrevPtr/PendNextPtr/PendPrevPtr` 直接内嵌链表指针，加一个 `PendObjPtr` 指对象——**用"指针+双向链表"组织任务**。两种流派，本质都是把任务挂进各种"队列"里管理。

## 6. 任务栈：单位是"字"，向下生长

任务的局部变量、函数调用现场、被切换时的寄存器现场都存在任务栈里。创建任务前必须为任务准备好栈空间（PDF 第 5.6 节 (PDF p.89~90)）：

```c
/* CPU_STK 的定义：unsigned int，32 位机上一个"字" */
typedef unsigned int CPU_INT32U;
typedef CPU_INT32U   CPU_STK;

/* 任务栈：以 CPU_STK（字）为单位的数组 */
#define TASK1_STK_SIZE  512
CPU_STK  Task1Task_STK[TASK1_STK_SIZE];   /* 实际占用 512 * 4 = 2048 字节 */

/* 内核自己的空闲任务也这么配：os_cfg_app.h 中 */
#define OS_CFG_IDLE_TASK_STK_SIZE  64u    /* 64 字 = 256 字节 */
```

关键认知：`stk_size` 的单位是**字（CPU_STK）**，不是字节——教材明确举例 `OS_CFG_IDLE_TASK_STK_SIZE` 配置为 64，实际栈大小是 64×4 = 256 字节（PDF p.90）。栈增长方向：ARM Cortex-M 的栈是**向下生长**（从高地址往低地址压），`StkPtr` 始终指向栈顶，创建任务时内核会把任务入口地址、参数等预置进栈，第一次切换时"恢复"出来的就是一个能跑的任务。

> ⚠️ 栈给小了，任务会"爆栈"踩掉邻居的数据，表现千奇百怪（随机死机、变量莫名被改）。UCOS 给了两个帮手：`OS_OPT_TASK_STK_CHK` 选项开启栈检查、`OS_OPT_TASK_STK_CLR` 创建时把栈清零（第 2 课创建任务时我们都传了）。养成习惯：任务里定义大数组时，优先用 `static` 或 malloc，别塞栈里。

## 动手练习（约 25 分钟）

### 练习 3.1：读 OS_TCB 源码，画一张字段脑图

- 1️⃣ 在你的 µC/OS-III 分支工程里打开 `os.h`，找到 `struct os_tcb`，对照本课的裁剪版逐字段核对。
- 2️⃣ 用配置文件开关做"裁纸实验"：把 `OS_CFG_MUTEX_EN` 改成 0、把 `OS_CFG_SCHED_ROUND_ROBIN_EN` 改成 0，再编译——观察 os.h 里哪些字段被 `#if` 掉了。
- **观察什么：**TCB 大小随配置变化，这正是"裁剪"的含义。动手删字段后编译报错也别慌，改回来即可。

### 练习 3.2：对比 FreeRTOS TCB 结构体

- 1️⃣ 在 FreeRTOS 分支工程里打开 `tasks.c`，找到 `tskTCB`，和 OS_TCB 并排对比：`pxTopOfStack` vs `StkPtr`、`uxPriority` vs `Prio`、`xStateListItem` vs `NextPtr/PrevPtr`。
- 2️⃣ 在 Watch 窗口添加两个工程的 TCB 变量，分别展开看看各自第一个成员的值，确认"第一个成员都是栈顶指针"这个共同约定。
- **观察什么：**写一段 5 行的笔记：两个 TCB 的"共同内核"（栈顶指针 + 优先级 + 状态 + 链表挂钩）是什么，各自的"特色字段"是什么。

## 自测（答完再点答案）

### 随堂小测 1

Q1. µC/OS-III 中任务优先级数值与优先级高低的关系是？

- A. 数值越大优先级越高
- B. 数值越小优先级越高
- C. 与数值大小完全无关

<details>
<summary>查看答案</summary>

B。µC/OS-III 优先级 0 最高、(OS_CFG_PRIO_MAX-1) 最低，与 FreeRTOS 相反（PDF p.84）。

</details>

### 随堂小测 2

Q2. µC/OS-III 的任务状态一共有几种？

- A. 三种
- B. 四种
- C. 五种

<details>
<summary>查看答案</summary>

C。休眠、就绪、运行、挂起、中断五态；FreeRTOS 是四态（PDF p.82~83）。

</details>

### 随堂小测 3

Q3. 同优先级的多个任务轮流运行，靠什么机制？

- A. 抢占式调度
- B. 时间片调度
- C. 中断嵌套

<details>
<summary>查看答案</summary>

B。时间片调度针对同优先级任务；抢占式针对不同优先级任务（PDF p.84~85）。

</details>

### 随堂小测 4

Q4. 任务栈大小 64 意味着实际占用多少字节？

- A. 64 字节
- B. 128 字节
- C. 256 字节

<details>
<summary>查看答案</summary>

C。CPU_STK 是 32 位"字"，64 字 = 64×4 = 256 字节（PDF p.90）。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 5 章（PDF p.81~90）——本课全部依据
- 🌐 [Weston Embedded（Micrium 后继）µC/OS-III 主页](https://weston-embedded.com/uc-os-iii)——官方文档与 API Reference
- 📕 [《µC/OS-III: The Real-Time Kernel》](https://weston-embedded.com/uc-os-iii)——Labrosse 亲写，第 5 章 Task Management 与本章互为印证
- 🔁 对照：[FreeRTOS 课程第 3 课（任务基础）](/my-blog/posts/freertos/0003-task-basics/)——状态、优先级、TCB 的逐项对比基准

## 下一步

任务的状态和调度是"概念层"，下一课把它们落成代码——位图就绪表：µC/OS-III 凭什么 O(1) 找到最高优先级任务？这背后就是优先级"数值越小越高"的真正原因。有疑问随时问我 😄

| [← 上一课](/my-blog/posts/ucosiii/0002-porting-and-config/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0004-bitmap-ready-list/) |