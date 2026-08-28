---
title: MiniOS① TCB 与位图就绪表
published: 2026-08-19
description: 手写内核第一步：任务控制块 TCB + O(1) 位图就绪表，把 µC/OS-III 的调度数据结构亲手落地。
tags: [UCOSIII, 嵌入式, RTOS, MiniOS, TCB, 位图就绪表, 手写内核]
category: UCOSIII
draft: false
prevTitle: MiniOS② 上下文切换
prevSlug: "ucosiii/0008-minios-2-context-switch"
nextTitle: 中断管理与临界区
nextSlug: "ucosiii/0006-interrupts-and-critical-sections"
---

# MiniOS① TCB 与位图就绪表

⭐ 手写内核第一步：任务控制块 + O(1) 就绪位图，把 µC/OS-III 的调度数据结构落地。**本课目标：**从本课开始连续 6 课，我们动手造一个最小可运行的内核 **MiniOS**——设计以 µC/OS-III 为蓝本，逐层简化。第 1 步先写它的"骨架"：任务控制块 TCB 和位图就绪表。学完你能：画出 MiniOS 与 µC/OS-III 的对应关系；写出 `OS_PrioInsert / OS_PrioRemove / OS_PrioGetHighest` 三个位操作函数；并用 `__CLZ` 一条指令解释"为什么找最高优先级是 O(1)"。FreeRTOS 课的链表就绪表将在这里被完整对照。

## 1. MiniOS 设计总览：目标、目录与对应关系

先定规矩。MiniOS 的野心只有一条：**在 STM32F407 上跑起两个任务，让它们轮流打印串口**——但每一步都必须亲手写出来。为此我们对照 µC/OS-III 的真实结构做"砍功能"（砍掉时间片、消息队列、内存管理等一切非核心），保留：**位图就绪表 → 上下文切换 → 调度器 → 时基延时 → 信号量**这条最小链路。

| MiniOS 文件 | 职责 | µC/OS-III 对应物 | 本课交付 |
|------|------|------|------|
| `cpu.h / cpu.c` | CPU_STK 等类型别名、BASEPRI 临界区宏 | µC/CPU（cpu_core.h/cpu_a.asm） | 第 9 课落码 |
| `os_core.h / os_core.c` | TCB、位图就绪表、内核全局变量 | os.h 的 OS_TCB、os_core.c 的 OS_PrioXXX | ✅ 本课 |
| `os_task.c` | OSTaskStkInit、OSTaskCreate | os_task.c + 移植层 OSTaskStkInit | 第 8、9 课 |
| `os_sched.c` | OSSched、OS_SchedNew、任务挂起/恢复 | os_core.c 的 OSSched | 第 9 课 |
| `os_cpu_a.asm` | PendSV 切换、OSStartHighRdy、OSCtxSw | Ports/ARM-Cortex-M 的 os_cpu_a.asm | 第 8 课 |
| `main.c` | 测试与演示代码 | 应用工程 | 每课一个版本 |

> ⚠️ 工程纪律：MiniOS 写在你的 µC/OS-III 分支工程的 `MiniOS/` 目录下（当前分支不动）。FreeRTOS 课学过的所有切换/启动知识都会被直接复用——第 7、8 课的内容请先确保 FreeRTOS 第 6、7 课（启动流程、PendSV）已经消化，否则会看天书。

再明确一个概念对照（第 1 课剧透过）：µC/OS-III 的位图就绪表用一维数组 `OSPrioTbl[]`（第 1 课表格里写的 OSRdyGrp/OSRdyTbl 是 µC/OS-II 的两级位图写法，III 代简化了结构，但位操作思想一脉相承）。FreeRTOS 用"链表就绪表 + uxTopReadyPriority 位图找最高优先级"；**µC/OS-III 的位图既是就绪记录、又是查找索引**——这就是 O(1) 的来源。

## 2. TCB 结构体设计：从 OS_TCB 里挑"五脏"

µC/OS-III 的 OS_TCB 有几十个成员（PDF p.85~89），但大部分被配置项裁剪、或用于调试。我们只保留让内核能跑起来的五个（对照见注释）：

```c
/* ---------- MiniOS/os_core.h（第 7 课交付版） ---------- */
#ifndef  OS_CORE_H
#define  OS_CORE_H

#include "cpu.h"            /* CPU_STK / CPU_DATA / CPU_INT32U 等类型 */

/* ==================== 基本配置 ==================== */
#define  OS_CFG_PRIO_MAX       32u      /* 优先级总数（0~31），31 号留给空闲任务 */
#define  OS_TASK_STATE_RDY       1u     /* 任务状态：就绪 */
#define  OS_TASK_STATE_SUSPENDED 2u     /* 任务状态：挂起（第 9 课用） */
#define  OS_TASK_STATE_DLY       3u     /* 任务状态：延时（第 10 课用） */
#define  OS_STATE_OS_STOPPED     0u
#define  OS_STATE_OS_RUNNING     1u

/* ==================== 类型别名（模仿 UCOS 的风格） ==================== */
typedef  CPU_INT32U   OS_PRIO;         /* 任务优先级 */
typedef  CPU_INT32U   OS_STATE;        /* 任务状态 */
typedef  CPU_INT32U   OS_TICK;         /* 时基节拍计数（第 10 课用） */

/* ==================== 任务控制块 TCB ==================== */
typedef  struct  os_tcb  OS_TCB;
struct  os_tcb {
    CPU_STK   *StkPtr;        /* ① 任务栈顶指针——必须是第一个成员！
                               *   切换汇编零偏移取它（UCOS 的 OS_TCB.StkPtr，PDF p.85） */
    OS_PRIO    Prio;          /* ② 任务优先级，数值越小越高（OS_TCB.Prio，PDF p.86） */
    OS_STATE   TaskState;     /* ③ 任务状态：就绪/挂起/延时（OS_TCB.TaskState） */
    OS_TICK    TickRemain;    /* ④ 剩余延时节拍，第 10 课时基用（OS_TCB.TickRemain，PDF p.87） */
    void      *TaskEntryArg;  /* ⑤ 任务函数参数（OS_TCB.TaskEntryArg，调试用成员） */
};

/* ==================== 内核全局变量 ==================== */
extern  OS_TCB   *OSTCBCurPtr;         /* 当前运行任务的 TCB */
extern  OS_TCB   *OSTCBHighRdyPtr;     /* 最高优先级就绪任务的 TCB */
extern  OS_PRIO   OSPrioCur;           /* 当前任务优先级 */
extern  OS_PRIO   OSPrioHighRdy;       /* 最高就绪优先级 */
extern  OS_STATE  OSRunning;           /* 内核运行标志 */

/* ==================== 就绪表 API ==================== */
void     OS_PrioInit     (void);
void     OS_PrioInsert   (OS_PRIO prio);
void     OS_PrioRemove   (OS_PRIO prio);
OS_PRIO  OS_PrioGetHighest (void);

#endif
```

两个设计要点：

- **StkPtr 必须是第一个成员**——FreeRTOS 课第 6 课的"机制一"在这里完全复用：任务切换的本质是换栈，汇编 `LDR R0, [R1]` 零偏移取栈顶最快，所有切换代码都依赖这个约定。
- **TCB 池按优先级索引**：MiniOS 用一个静态数组 `OSTCBTbl[OS_CFG_PRIO_MAX]` 充当"TCB 池"，优先级 P 的任务用槽位 P。这是对 µC/OS-III 的简化——UCOS 用 `OSRdyList[prio]` 双向链表支持"同优先级多任务 + 时间片"，MiniOS 初版牺牲这个能力（第 11 课之后可选扩展），换来的是索引直达、代码最短。

## 3. 位图就绪表：OSPrioTbl 与三个位操作

就绪表 = 一个 32 位字（我们的 OS_CFG_PRIO_MAX=32，数组只要 1 个元素；扩展时按 `(PRIO_MAX+31)/32` 加字）：

```c
/* ---------- MiniOS/os_core.c（第 7 课交付版） ---------- */
#include "os_core.h"

/* 就绪位图：OSPrioTbl[0] 的 bit31~bit0 依次对应优先级 0~31
 * 优先级 0（最高）→ bit31，优先级 31（最低，空闲任务）→ bit0
 * 某个 bit 为 1 表示该优先级上有就绪任务 */
static  CPU_DATA  OSPrioTbl[ (OS_CFG_PRIO_MAX + 31u) >> 5u ];

/* TCB 池：按优先级索引，槽位即优先级 */
OS_TCB   OSTCBTbl[OS_CFG_PRIO_MAX];

OS_TCB   *OSTCBCurPtr;          /* 当前任务 */
OS_TCB   *OSTCBHighRdyPtr;      /* 最高优先级就绪任务 */
OS_PRIO   OSPrioCur;            /* 当前任务优先级 */
OS_PRIO   OSPrioHighRdy;        /* 最高就绪优先级 */
OS_STATE  OSRunning;            /* 内核运行标志 */

/* ---------- 就绪表初始化 ---------- */
void  OS_PrioInit (void)
{
    CPU_DATA  i;

    for (i = 0u; i < (CPU_DATA)((OS_CFG_PRIO_MAX + 31u) >> 5u); i++) {
        OSPrioTbl[i] = 0u;
    }
}

/* ---------- 把优先级 prio 标记为就绪 ---------- */
void  OS_PrioInsert (OS_PRIO prio)
{
    CPU_DATA  bit;
    CPU_DATA  bit_nbr;
    OS_PRIO   ix;

    ix      = prio >> 5u;                       /* 第几个字（32 个优先级一个字） */
    bit_nbr = prio & 0x1Fu;                     /* 字内第几位 */
    bit     = (CPU_DATA)1u << (31u - bit_nbr);  /* 优先级 0 → bit31（最高位） */
    OSPrioTbl[ix] |= bit;                       /* 置位 */
}

/* ---------- 把优先级 prio 标记为不就绪 ---------- */
void  OS_PrioRemove (OS_PRIO prio)
{
    CPU_DATA  bit;
    CPU_DATA  bit_nbr;
    OS_PRIO   ix;

    ix      = prio >> 5u;
    bit_nbr = prio & 0x1Fu;
    bit     = (CPU_DATA)1u << (31u - bit_nbr);
    OSPrioTbl[ix] &= ~bit;                      /* 清位 */
}

/* ---------- 找最高优先级就绪任务：O(1) ---------- */
OS_PRIO  OS_PrioGetHighest (void)
{
    CPU_DATA *p_tbl;
    OS_PRIO   prio;

    p_tbl = &OSPrioTbl[0];
    prio  = 0u;
    while (*p_tbl == 0u) {                      /* 整字为 0 就跳下一个字（本工程只有 1 个字） */
        p_tbl++;
        prio += 32u;
    }
    prio += (OS_PRIO)(31u - __CLZ(*p_tbl));     /* 数前导零 → 最高位 1 的位置 */
    return prio;
}
```

三个函数就是 µC/OS-III 就绪表 API 的完整复刻（源码在 os_core.c，教材在 p.113、p.126、p.133 等多处调用）。数学验证一下 `OS_PrioGetHighest`：假设就绪的有优先级 3 和 7，则 `OSPrioTbl[0] = 0b...1011_1111_11...1` 里 bit(31-3)=bit28 和 bit(31-7)=bit24 为 1。前导零数 = 3，`31-3 = 28` → 优先级 3。一次 `__CLZ` 指令，常数时间——比 FreeRTOS 的链表遍历快得多。

> 💡 为什么 bit 映射要"反着放"（优先级 0 在最高位）？因为 Cortex-M 的 CLZ 指令数的是"前导零"，天然从最高位开始找。把最高优先级放在最高位，`31 - __CLZ(word)` 一步就得到答案。这是"硬件指令与数据结构互相成就"的经典案例，FreeRTOS 课的 `31 - __clz(uxTopReadyPriority)` 彩蛋在本课正式转正。

## 4. 就绪表初始化与第一个测试 main

初始化流程严格照搬 µC/OS-III：OSInit 里先 `OS_PrioInit()` 清位图、`OS_RdyListInit()` 清链表（我们简化为清 TCB 池），最后 `OSInitHook()` 算好 BASEPRI 边界（PDF p.110~113）。MiniOS 的 OSInit 精简为：

```c
/* ---------- MiniOS/os_core.c：内核初始化（第 7 课版，调度部分第 9 课补） ---------- */
void  OSInit (void)
{
    CPU_DATA  i;

    OS_PrioInit();                      /* ① 就绪位图清零 */
    for (i = 0u; i < OS_CFG_PRIO_MAX; i++) {
        OSTCBTbl[i].StkPtr     = (CPU_STK *)0;
        OSTCBTbl[i].Prio       = (OS_PRIO)i;
        OSTCBTbl[i].TaskState  = OS_TASK_STATE_SUSPENDED;   /* 无任务 → 非就绪 */
        OSTCBTbl[i].TickRemain = 0u;
    }
    OSTCBCurPtr     = (OS_TCB *)0;      /* ② 当前任务为空 */
    OSTCBHighRdyPtr = (OS_TCB *)0;
    OSPrioCur       = 0u;
    OSPrioHighRdy   = 0u;
    OSRunning       = OS_STATE_OS_STOPPED;
}

/* ---------- main.c：第 7 课验收测试 ---------- */
#include "os_core.h"
#include "usart.h"      /* 板级串口 */

int main (void)
{
    OS_ERR  err;                        /* 占位，第 9 课才真正用于任务创建 */

    HAL_Init();
    uart_init(115200);
    OSInit();

    /* 模拟"创建了 3 个任务"：优先级 2、3、31（31 是空闲任务）进入就绪表 */
    OS_PrioInsert(31u);
    OS_PrioInsert(3u);
    OS_PrioInsert(2u);
    printf("highest = %d\r\n", OS_PrioGetHighest());    /* 应输出 2 */

    OS_PrioRemove(2u);                                  /* 任务 2 让出/挂起 */
    printf("highest = %d\r\n", OS_PrioGetHighest());    /* 应输出 3 */

    OS_PrioRemove(3u);
    printf("highest = %d\r\n", OS_PrioGetHighest());    /* 应输出 31（只剩空闲） */

    for (;;) { ; }
}
```

验收很简单：串口依次打印 2、3、7。跑通了，就说明位图插入/删除/取最高三个核心操作正确——下一课的切换汇编要站在这个地基上。

## 5. 本课交付与 FreeRTOS 对照

本课落地的代码（`MiniOS/os_core.h` + `MiniOS/os_core.c` + 测试 main）：TCB 结构体、TCB 池、OSInit、就绪表初始化、三个位操作函数。对照 FreeRTOS 第 5 课，两种就绪表设计殊途同归：

| 维度 | FreeRTOS（第 5 课） | µC/OS-III / MiniOS（本课） |
|------|------|------|
| 就绪任务组织 | pxReadyTasksLists[32] 链表数组 | OSPrioTbl[] 位图（+ TCB 池索引） |
| 最高优先级查找 | 位图找优先级 → 链表取任务 | 位图直接出答案，一步到位 |
| 同优先级多任务 | 链表多节点，时间片轮转 | UCOS 用 OSRdyList 链表支持；MiniOS 暂不支持 |
| 优先级方向 | 数值越大越高 | 数值越小越高（bit 高位 = 高优先级） |
| 查找复杂度 | 位图 O(1) + 链表 O(1) | **纯位图 O(1)**（__CLZ 一条指令） |

一句话：**FreeRTOS 的位图是"索引"，µC/OS-III 的位图是"答案"**。两种都是教科书级设计——你在两门课里亲手实现了它们，这比任何结论都值钱。

## 动手练习（约 25 分钟）

### 练习 7.1：在 MiniOS/ 写下 TCB 与就绪表代码

- 1️⃣ 在你的 µC/OS-III 分支工程下新建 `MiniOS/` 目录，按本课第 2、3 节代码写下 `os_core.h` 和 `os_core.c`（中文注释自己补全，理解每一行再落笔）。
- 2️⃣ 写一个 `cpu.h` 的"迷你版"：只需 `typedef unsigned int CPU_STK; typedef unsigned int CPU_DATA; typedef unsigned int CPU_INT32U;` 三个别名（正式版第 9 课补临界区宏）。
- 3️⃣ 把两个文件加进工程（或直接和 main.c 一起编译），跑第 4 节的测试 main。
- 4️⃣ 验收标准：串口依次打印 2、3、31；再用调试器 Watch `OSPrioTbl[0]`，亲手验证插入 2/3/31 后位图的值（bit29、bit28、bit0 置 1）。

### 练习 7.2：位图边界实验

- 1️⃣ 在测试 main 里连续插入 `OS_PrioInsert(0u)` 和 `OS_PrioInsert(31u)`，验证 `OS_PrioGetHighest()` 返回 0——优先级 0 必须压过一切（这就是 UCOS 保留 0/1 给内核任务的原因）。
- 2️⃣ 把 `OS_CFG_PRIO_MAX` 改成 64，重新算 `OSPrioTbl` 的数组长度（应变成 2 个字），插入优先级 40，验证 `OS_PrioGetHighest` 的 while 循环能正确跳过第一个空字返回 40。
- 3️⃣ 思考题：为什么空闲任务必须"常驻就绪表"（bit0 永远为 1）？如果位图全 0，`OS_PrioGetHighest` 会怎样？（提示：while 会越界——这正是 UCOS 无论如何都保证最低优先级有位的原因，PDF p.113 的 OS_PrioInit 注释。）
- 4️⃣ 验收标准：能口头解释"位图永不为空"这个不变式，以及它在调度器里的安全意义。

## 自测（答完再点答案）

### 随堂小测 1

Q1. MiniOS 的 OSPrioTbl 中，优先级 5 对应哪个 bit？

- A. bit5
- B. bit26
- C. bit31
- D. bit27

<details>
<summary>查看答案</summary>

B。bit_nbr = 5 & 0x1F = 5，bit = 1 << (31-5) = 1 << 26。优先级越小越靠近高位（OS_PrioInsert 实现）。

</details>

### 随堂小测 2

Q2. OS_PrioGetHighest 用 __CLZ 在做什么？

- A. 统计就绪任务的总数量
- B. 清零位图中最高位的 1
- C. 数前导零，定位位图最高位的 1
- D. 反转位图的比特顺序

<details>
<summary>查看答案</summary>

C。前导零数 n 对应的最高位 1 位置是 31-n，即最高就绪优先级，一条指令 O(1) 完成查找。

</details>

### 随堂小测 3

Q3. TCB 第一个成员为什么必须是 StkPtr？

- A. 编译器要求结构体首成员为指针
- B. 切换汇编零偏移取栈顶，约定俗成
- C. 方便统计任务栈使用量
- D. 任务名数组必须排在指针后面

<details>
<summary>查看答案</summary>

B。任务切换的本质是换栈；PendSV 汇编用 ldr r0,[r1] 取 TCB 第一个字当新栈顶，零偏移最快。µC/OS-III 与 FreeRTOS 都遵守这个约定（PDF p.85、FreeRTOS 课第 6 课）。

</details>

### 随堂小测 4

Q4. 与 FreeRTOS 链表就绪表相比，位图就绪表的直接优势是？

- A. 支持任意数量的同优先级任务
- B. 找最高优先级一步到位，无需二级查找
- C. 节省内存，不需要任务控制块
- D. 调度器可以不做任务选择

<details>
<summary>查看答案</summary>

B。位图既是就绪记录又是查找索引，__CLZ 直接出最高优先级；FreeRTOS 需先查位图再按优先级进链表取任务。同优先级多任务恰恰是 UCOS 用 OSRdyList 链表补的。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》5.5 节（(PDF p.84~89)）——OS_TCB 完整结构，对照本课"砍掉"的成员
- 📖 同书 7.3 节（(PDF p.110~117)）——OSInit 里 OS_PrioInit/OS_RdyListInit 的原始调用流程
- 🔁 对照：[FreeRTOS 课程第 5 课（列表与列表项）](/my-blog/posts/freertos/0005-lists-and-list-items/)——链表就绪表的家底，本课对照的基准
- 🌐 [CMSIS 内置函数文档（__CLZ）](https://arm-software.github.io/CMSIS_5/core/html/group__intrinsic__CS.html)——CLZ 指令的官方说明

## 下一步

地基打好了：TCB 池 + 就绪位图，下一个任务是让这些数据结构"动"起来。下一课 MiniOS②：任务栈初始化 + PendSV 切换汇编——让 CPU 真的从一个任务跳到另一个任务。

| [← 上一课](/my-blog/posts/ucosiii/0006-interrupts-and-critical-sections/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0008-minios-2-context-switch/) |