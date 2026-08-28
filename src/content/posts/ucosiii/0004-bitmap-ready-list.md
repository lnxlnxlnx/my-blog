---
title: 位图就绪表
published: 2026-08-16
description: 一个 32 位整数 + 一条 CLZ 指令 = O(1) 找到最高优先级任务——µC/OS-III 位图就绪表原理，与 FreeRTOS 链表就绪表全面对比。
tags: [UCOSIII, 嵌入式, RTOS, 位图就绪表, CLZ, OSPrioTbl, O(1)]
category: UCOSIII
draft: false
prevTitle: 任务切换原理
prevSlug: "ucosiii/0005-task-switching"
nextTitle: 任务基础
nextSlug: "ucosiii/0003-task-basics"
---

# 位图就绪表

一个 32 位整数 + 一条 CLZ 指令 = O(1) 找到最高优先级任务。**本课目标：**本课是手写 MiniOS 的**理论预演**，原理必须讲透。学完你能说清 µC/OS-III 用 `OSPrioTbl[]` 位图记录就绪任务、用前导零指令（CLZ）O(1) 查最高优先级的完整原理，理解"数值越小优先级越高"与位图方向的因果关系；能对比 FreeRTOS 链表就绪表的复杂度/内存/可扩展性差异；并能在源码里指出 `OS_PrioInsert/OS_PrioRemove/OS_PrioGetHighest` 的落点。最后亲手写一遍三个操作函数。

## 1. 为什么用位图：调度器的高频操作必须 O(1)

调度器每时每刻都在做一件重复的事：**从所有就绪任务里挑出优先级最高的那个**。这个操作有多高频？任务每次让出 CPU、每次中断退出、每次 tick 都可能触发。如果挑一次要遍历几十个任务，系统越忙、任务越多，调度开销越大——这是实时内核不能接受的。

µC/OS-III 的答案：把"哪些优先级上有就绪任务"压缩成一张位图（PDF 第 5.3 节 (PDF p.84)、第 7.3 节 (PDF p.113)）。每一位代表一个优先级：**位 = 1 表示这个优先级上有就绪任务**。找最高优先级任务 = 找位图里第一个 1——而"找第一个 1"在 ARM 上是一条硬件指令的事。这就是第 3 课埋的伏笔：**优先级"数值越小越高"正是为了配合位图方向**。

> 💡 记忆锚点：**就绪表存的不是任务，是"哪些优先级有人"**。真正排队的是就绪链表 `OSRdyList[prio]`（每优先级一条，存 OS_TCB 指针）；位图是它的"快速索引"。位图回答"谁最高"，链表回答"最高的人在哪"。两件事分开，各司其职。

## 2. 数据结构：OSPrioTbl[] —— 一张位图数组

µC/OS-III 把位图存在全局数组 `OSPrioTbl[OS_PRIO_TBL_SIZE]` 里（os.h 中定义，`OS_PRIO_TBL_SIZE = OS_CFG_PRIO_MAX / 32` 向上取整）。教材配套工程把 `OS_CFG_PRIO_MAX` 配成 32，所以 `OSPrioTbl` 只有 1 个元素（PDF p.113）：

```c
/* OS_CFG_PRIO_MAX = 32 时：一个 32 位字搞定 */
/* 位方向：bit31 = 优先级 0（最高），bit0 = 优先级 31（最低） */
/*
 * OSPrioTbl[0]  =  bit31 bit30 ... bit2 bit1 bit0
 *  优先级：        0    1   ...  29   30   31
 *  bitN 置 1 = 优先级 N 上有就绪任务
 *
 * 例子：优先级 0、5、31 就绪
 * OSPrioTbl[0] = 0b1000_0010_0000_0000_0000_0000_0000_0001
 *                  ^优先级0  ^优先级5                     ^优先级31
 */
```

为什么优先级 0 坐在 bit31（最高位）而不是 bit0？因为这样"找最高优先级"恰好等于"找最高位的 1"，正好能交给 CLZ 前导零指令直接出结果——这是整节课最精巧的一个设计选择。

如果 `OS_CFG_PRIO_MAX` 配得更大（比如 64），位图就变成数组，按"组"展开——思想与 µC/OS-II 经典的 `OSRdyGrp/OSRdyTbl` 双级位图一脉相承：

| 配置 | 位图结构 | 查最高优先级 |
|------|------|------|
| **µC/OS-III**（32 优先级） | `OSPrioTbl[1]`：单字，bit31=优先级 0 | CLZ 一条指令 |
| **µC/OS-III**（64 优先级） | `OSPrioTbl[2]`：组1 + 组2，每组 32 位（8 组 × 32 位同理扩展） | 跳过全 0 的组，再对命中组 CLZ |
| **µC/OS-II**（256 优先级，历史经典） | `OSRdyGrp`（组位图）+ `OSRdyTbl[8]`（组内位图），8 组 × 8 位 | 查 256 字节 OSUnMapTbl 表（无 CLZ 时代的办法） |

## 3. 置位与清位：OS_PrioInsert / OS_PrioRemove

真实源码（os_prio.c，V3.08）在 `OS_CFG_PRIO_MAX ≤ 32` 时被优化成单字运算——置位就是"或一个位"，清位就是"与一个取反位"。下面两段直接对应官方实现：

```c
/* os_prio.c —— 插入优先级（置位）：优先级 N 就绪 */
void OS_PrioInsert(OS_PRIO prio)
{
    /* 单字优化版（OS_CFG_PRIO_MAX <= 32）：
     * 优先级 N 对应第 (31 - N) 位，即 1 << (31 - N) */
    OSPrioTbl[0] |= (CPU_DATA)1u << (((CPU_CFG_DATA_SIZE * 8u) - 1u) - prio);
    /* 例：prio=5  →  OSPrioTbl[0] |= 1 << 26 */
}

/* os_prio.c —— 移除优先级（清位）：优先级 N 不再就绪 */
void OS_PrioRemove(OS_PRIO prio)
{
    OSPrioTbl[0] &= ~((CPU_DATA)1u << (((CPU_CFG_DATA_SIZE * 8u) - 1u) - prio));
    /* 例：prio=5  →  OSPrioTbl[0] &= ~(1 << 26) */
}
```

多字版本（`OS_CFG_PRIO_MAX > 32`）就是分组思想：先算"在哪一组"（`ix = prio / 32`），再算"组内第几位"（`bit = 31 - (prio % 32)`）：

```c
/* os_prio.c —— 多字版 OS_PrioInsert（64 优先级时） */
void OS_PrioInsert(OS_PRIO prio)
{
    CPU_DATA bit_nbr;
    OS_PRIO  ix;

    ix      = (OS_PRIO)(prio / (CPU_CFG_DATA_SIZE * 8u));   /* 组索引：prio/32 */
    bit_nbr = (CPU_DATA)prio & ((CPU_CFG_DATA_SIZE * 8u) - 1u);  /* 组内位号：prio%32 */
    OSPrioTbl[ix] |= (CPU_DATA)1u << (((CPU_CFG_DATA_SIZE * 8u) - 1u) - bit_nbr);
}
```

> ⚠️ 注意位方向！µC/OS-III 的"组内"也是 `1 << (31 - bit)`——组内最高位对应组内最小优先级。这和 µC/OS-II 的 `OSRdyTbl`（bit0=组内优先级 0）方向相反。写 MiniOS 时先定方向，写错方向查最高优先级就会"差之毫厘、谬以千里"。

## 4. 查最高优先级：CLZ 前导零，一次指令出结果

最精彩的一步。CPU_CntLeadZeros() 是 µC/CPU 提供的"数前导零"函数，在 ARMv7-M 上直接映射到 **CLZ 指令**（cpu_a.asm 汇编实现，由 `CPU_CFG_LEAD_ZEROS_ASM_PRESENT` 开关控制，PDF p.67）。真实源码：

```c
/* os_prio.c —— 获取最高就绪优先级：O(1)，无循环无查表 */
OS_PRIO OS_PrioGetHighest(void)
{
#if (OS_CFG_PRIO_MAX <= (CPU_CFG_DATA_SIZE * 8u))   /* 32 优先级：单字优化 */
    return ((OS_PRIO)CPU_CntLeadZeros(OSPrioTbl[0]));
#else                                              /* 多字：先找组，再组内 CLZ */
    CPU_DATA *p_tbl;
    OS_PRIO   prio;

    prio  = 0u;
    p_tbl = &OSPrioTbl[0];
    while (*p_tbl == 0u) {                          /* 跳过全 0 的组 */
        prio += (CPU_CFG_DATA_SIZE * 8u);           /* 累计组偏移 */
        p_tbl++;
    }
    prio += (OS_PRIO)CPU_CntLeadZeros(*p_tbl);      /* 组内：前导零数 = 组内优先级 */
    return (prio);
#endif
}
```

算一笔账：假设优先级 0、5、31 就绪，`OSPrioTbl[0] = 0x84000001`。CLZ 数前导零 = 0 个 → 返回 0 → 最高优先级就是 0。✅ 只做一次算术移位和一次查表/指令，无论多少个任务就绪，耗时恒定。

历史注脚：µC/OS-II 时代 Cortex-M 还没普及，没有 CLZ 指令，就用 **256 字节查表法**——`OSUnMapTbl[256]` 把 8 位值的"最低位 1 的位置"预先算好，查一次表出结果（这正是 µC/OS-II 双级位图 + 查表的结构，PDF p.84 提到前导零的两种实现路线）。**CLZ 是查表法的硬件加速版**，本质都是 O(1)。

## 5. 对比 FreeRTOS：链表就绪表 vs 位图就绪表

FreeRTOS 课第 5 课学过：`pxReadyTasksLists[configMAX_PRIORITIES]` 每个优先级一条链表。有趣的是，FreeRTOS 也偷偷用了位图——`uxTopReadyPriority` 整型变量以位图记录"哪些优先级有人"，配 `portGET_HIGHEST_PRIORITY()` 宏用 CLZ 找最高优先级（configUSE_PORT_OPTIMISED_TASK_SELECTION=1 时）。两个内核在这个问题上殊途同归：

| 维度 | FreeRTOS（已学） | µC/OS-III（本课） |
|------|------|------|
| 就绪组织 | 链表为主：`pxReadyTasksLists[]` 按优先级分链表 | 位图为主：`OSPrioTbl[]` 记优先级，`OSRdyList[]` 记任务 |
| 优先级方向 | 数值大 = 高 | **数值小 = 高**（配合位图高位） |
| 查最高优先级 | `uxTopReadyPriority` 位图 + CLZ（可选） | `OSPrioTbl` + CLZ（必选，单字零成本） |
| 取任务复杂度 | 从链表头取，O(1) | 从 `OSRdyList[prio].HeadPtr` 取，O(1) |
| 同优先级轮转 | 列表项 pxIndex 步进（时间片） | 链表头移尾 `OS_RdyListMoveHeadToTail`（时间片） |
| 内存开销 | 每个任务 2 个列表项（约 24 字节/项） | OS_TCB 内嵌链表指针，位图仅 4~N 字节 |
| 可扩展性 | 优先级数量几乎不限（软件选择算法时） | 32 位字一组，多字需循环跳组（仍是 O(组数)） |

结论：**位图是"空间换时间"的极致**——32 优先级下找最高优先级是真正的一条指令；链表则更灵活，任务数不限、优先级可扩展。两者都稳，µC/OS-III 把"选最高优先级"压到了硬件极限，这就是它敢宣称调度器 O(1) 的底气。

## 6. 位图在 UCOS 源码中的落点

光会背原理不算会，要能在源码里找到它。位图的生命周期贯穿内核每个角落（PDF 第 7 章 (PDF p.113~128)）：

| 调用点 | 文件 | 做什么 |
|------|------|------|
| `OSInit() → OS_PrioInit()` | os_core.c / os_prio.c | 清空位图（OS_CFG_PRIO_MAX=32 时 1 个字清零） |
| `OSTaskCreate() → OS_PrioInsert(prio)` | os_task.c | 任务创建即就绪：把优先级"点亮"（PDF p.126） |
| 任务阻塞/删除 → `OS_PrioRemove(prio)` | os_core.c 等 | 任务不再就绪：把优先级"熄灭" |
| `OSSched()/OSIntExit()/OSStart() → OS_PrioGetHighest()` | os_core.c | 调度三处全部走位图查最高优先级（PDF p.128, 133, 138） |

动手验证路径：在你的 µC/OS-III 分支工程里打开 `os_prio.c`（约 100 行），你会看到本课贴的几乎就是它的原貌；再到 `os_core.c` 搜 `OS_PrioGetHighest`，能看到它在 OSSched/OSIntExit/OSStart 三处的调用——**一处实现，三处复用**，这就是"内核把高频操作集中优化"的范例。

> 💡 MiniOS 预告：第 8 课（MiniOS 第一步）你会从零写一张自己的位图就绪表。记住这课的三个函数名字和方向约定，到那时它们会原样复活——只是名字换成你起的。

## 动手练习（约 40 分钟）

### 练习 4.1：手写位图三操作，单步验证

- 1️⃣ 新建一个 `bitmap_demo.c`（可放工程里用串口打印，也可放 Keil 模拟器裸跑）：定义 `uint32_t OSPrioTbl = 0;`，按本课代码写 `PrioInsert(prio)`、`PrioRemove(prio)`、`PrioGetHighest()`（用 `__CLZ()` 内建函数或自己写软件前导零）。
- 2️⃣ 测试序列：插入 0、5、31 → 期望最高为 0；移除 0 → 期望最高为 5；移除 5、31 → 期望返回 32（无人就绪的约定值）。
- **观察什么：**在 Watch 里盯着 `OSPrioTbl` 的二进制值，每一步都心算出"下一个 1 在哪"，再和函数返回值对表。把位方向（1 << (31 - prio)）写错一次，你就永远记住它了。

### 练习 4.2：源码落点大搜查

- 1️⃣ 在你的 µC/OS-III 分支工程里打开 `os_prio.c`，把 `OS_PrioInsert/OS_PrioRemove/OS_PrioGetHighest/OS_PrioInit` 四个函数通读一遍，对照本课代码找差异（版本可能有微调）。
- 2️⃣ 在 `os_core.c` 里搜 `OS_PrioGetHighest`，数出它被调用的位置，逐个记录"调用者是谁、在什么时机"。
- **观察什么：**再搜一次 `OS_PrioRemove`——找到任务阻塞时（如 `OS_TaskBlock`）它被调用的证据，你就把"就绪表"和"任务状态"两课打通了。

## 自测（答完再点答案）

### 随堂小测 1

Q1. µC/OS-III 中，优先级 0 对应 OSPrioTbl[0] 的哪一位？

- A. bit0
- B. bit31
- C. bit16

<details>
<summary>查看答案</summary>

B。优先级 0（最高）坐 bit31（最高位），配合 CLZ 前导零直接出结果。

</details>

### 随堂小测 2

Q2. 查最高优先级用的 CPU_CntLeadZeros() 在 ARMv7-M 上对应什么？

- A. CLZ 指令
- B. RBIT 指令
- C. 软件查表

<details>
<summary>查看答案</summary>

A。CLZ 数前导零，由 cpu_a.asm 实现；µC/OS-II 时代无 CLZ 才用 256 字节查表。

</details>

### 随堂小测 3

Q3. 任务创建后 OS_PrioInsert(prio) 把位图置 1，表示什么？

- A. 该优先级有就绪任务
- B. 该优先级被禁用
- C. 该任务正在运行

<details>
<summary>查看答案</summary>

A。位图记录"哪些优先级上有就绪任务"，创建即就绪即点亮（PDF p.126）。

</details>

### 随堂小测 4

Q4. FreeRTOS 找最高优先级任务靠什么（启用优化时）？

- A. 遍历所有链表
- B. uxTopReadyPriority 位图
- C. 随机选择

<details>
<summary>查看答案</summary>

B。uxTopReadyPriority 以位图记录就绪优先级，taskSELECT_HIGHEST_PRIORITY_TASK 用 CLZ 找最高位（FreeRTOS 课第 6 课）。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 5.5 节（PDF p.85~89）——TCB 与就绪表的关系
- 📖 同书第 7.3/7.4/7.5 节（PDF p.113, 126, 128）——OS_PrioInit、OS_PrioInsert、OS_PrioGetHighest 的源码现场
- 🌐 [Weston Embedded（Micrium 后继）µC/OS-III 主页](https://weston-embedded.com/uc-os-iii)——GitHub 源码 os_prio.c 在线阅读
- 🔁 对照：[FreeRTOS 课程第 5 课（链表与列表项）](/my-blog/posts/freertos/0005-lists-and-list-items/)和第 [6 课（启动流程）](/my-blog/posts/freertos/0006-scheduler-startup/)——链表就绪表 vs 位图就绪表

## 下一步

位图解决了"选谁"的问题，下一课解决"怎么换人"——OSSched、OSIntExit 与 PendSV 里的任务切换，把"选人"和"换人"串成完整链路。有疑问随时问我 😄

| [← 上一课](/my-blog/posts/ucosiii/0003-task-basics/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0005-task-switching/) |