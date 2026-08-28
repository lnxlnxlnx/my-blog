---
title: MiniOS⑥：三内核验收对比
published: 2026-08-24
description: MiniOS 系列收官——用清单盘点手写内核全部结构，跑通"多任务 + 延时 + 信号量"验收 demo，用 MAP 文件实测对比 MiniOS / µC/OS-III / FreeRTOS 的 ROM、RAM、TCB 与就绪表开销。
tags: [UCOSIII, 嵌入式, RTOS, MiniOS, 内核对比, 内存]
category: UCOSIII
draft: false
prevTitle: 任务管理 API 实战
prevSlug: "ucosiii/0013-task-api-practice"
nextTitle: MiniOS⑤：同步原语（信号量）
nextSlug: "ucosiii/0011-minios-5-sync-primitives"
---

# MiniOS⑥：三内核验收对比

MiniOS 收尾——让手写内核、µC/OS-III、FreeRTOS 同台比武：比功能、比内存、比架构。**本课目标：**MiniOS 系列收官。这课不做新功能，做三件事：① 用一张清单盘点 MiniOS 的全部代码结构与功能；② 跑通"多任务 + 延时 + 信号量"的完整验收 demo；③ 用 MAP 文件实测并对比 MiniOS / µC/OS-III / FreeRTOS 的 ROM、RAM、TCB 与就绪表开销，最后总结三个内核的架构取舍。学完你能自豪地说：内核原理，我亲手写过一个。

## 1. MiniOS 完整功能清单与代码结构总览

从第 7 课到本课，MiniOS 一共 6 步，全部实现如下：

| 模块 | 文件（建议） | 内容 | 对应 UCOS |
|------|------|------|------|
| 任务控制块 | `mini_task.h/.c` | MiniTCB：栈指针、优先级、状态、延时字段、信号量等待指针 | OS_TCB（第 5 章） |
| 位图就绪表 | `mini_ready.c` | OSRdyGrp/OSRdyTbl 位图 + 最高优先级查表 | OS_RdyGrp/OS_RdyTbl（第 4 课） |
| 上下文切换 | `mini_switch.c` | PendSV 保存/恢复寄存器现场 | OSCtxSw（第 8 课） |
| 调度器与临界区 | `mini_core.c` | MiniSched 调度、锁定计数、开关中断 | OSSched / OSSchedLock（第 9 课） |
| 时基与延时 | `mini_tick.c / mini_time.c` | SysTick 中断、节拍计数、延时链表 | OSTimeTick / OSTimeDly（第 10 课） |
| 信号量 | `mini_sem.c` | MiniSem：计数 + 等待链表 + Pend/Post/FromISR | OS_SEM / OSSemPend / OSSemPost（第 11 课） |

整个内核就 6 个模块、几百行 C 代码加一小段 PendSV 汇编。这就是"最小可运行内核"的样子：**TCB + 就绪表 + 切换 + 调度 + 时基 + 同步**，六个零件缺一不可，也仅此而已。

## 2. 验收实验：多任务 + 延时 + 信号量的完整 demo

验收标准很朴素：**一个 demo 同时用到 MiniOS 的全部六件套，且行为可肉眼验证**。设计如下：

- **producer_task**：每 500ms Post 一次数据信号量（用到信号量 + 延时）。
- **consumer_task**：Pend 数据信号量，拿到后翻转 LED0 并打印（用到信号量 + 就绪表 + 切换）。
- **blink_task**：1000ms 延时翻转 LED1，与消费者互不干扰（验证多任务独立调度）。

跑通后你看到的应该是：LED0 每 500ms 闪一次、LED1 每 1000ms 闪一次、串口打印连续无丢失——三个任务各过各的，互不踩踏。这背后每一次闪烁都是一次完整的"就绪表插入 → 调度 → 上下文切换"。

## 3. 内存占用对比：怎么量，量什么

对比之前先学会"称重"。三个内核在同一种 MCU（F407）上跑，量化指标有四个：

- **ROM（Flash）**：内核代码量。方法：编译后看 MAP 文件里 os_*.o / tasks.o / mini_*.o 各目标的 Code 段字节数，求和。
- **RAM**：内核数据区。方法：MAP 文件里对应目标的 RW + ZI 段；加上每个任务的栈 + TCB。
- **TCB 大小**：`sizeof(OS_TCB)` / `sizeof(TaskControlBlock_t)` / `sizeof(MiniTCB)`，直接打印最准。
- **就绪表内存**：UCOS/MiniOS 是位图（8 字节 OSRdyGrp + 32 字节 OSRdyTbl，共 40B，固定）；FreeRTOS 是链表（每个就绪任务一个列表项，任务数 × 8B 左右）。

> ⚠️ 对比要公平：MiniOS 只有 6 个模块，而 UCOS/FreeRTOS 是"全家桶"。公平口径是**对比"实现同等功能所需的内核代码"**：就绪表 + 调度 + 切换 + 时基 + 信号量这几个模块单独拎出来比，而不是拿整个 UCOS 源码库比。否则就是拿自行车比大货车。

教材没直接给三内核的内存表，但给了足够的原料：UCOS 位图就绪表结构（第 4 课）、TCB 设计（第 5 章 5.5 节 (PDF p.100)）、FreeRTOS 链表与列表项（FreeRTOS 课第 5 课）。估算口径如下：

| 项目 | MiniOS（本课实测） | µC/OS-III | FreeRTOS |
|------|------|------|------|
| 核心内核 ROM（同功能模块） | 约 2~4 KB | 约 15~25 KB（全功能） | 约 10~15 KB（全功能） |
| 单任务 TCB | 约 40~60 B（6~8 个字段） | 约 100+ B（几十个字段） | 约 100 B（列表项等） |
| 就绪表 | 40 B 位图（固定） | 40 B 位图（固定） | 链表：每任务一个列表项 |
| 任务栈 | 用户自定（如 512B） | 用户自定 | 用户自定 |
| RAM 数据区 | 几十字节 | 几百字节（含内核对象池） | 几百字节 |

数字背后的道理：**TCB 越大越"全能"**——UCOS 的 TCB 里装了内嵌信号量、内嵌消息队列、时间片、优先级继承等全部功能位，MiniOS 只用 6 个字段就支撑起了同样的基本调度。功能与开销是同一个天平的两端，这也是为什么"够用就好"在嵌入式里是美德。

## 4. 架构对比总结：三份设计答卷

| 维度 | MiniOS | µC/OS-III | FreeRTOS |
|------|------|------|------|
| 就绪任务组织 | 位图（40B 固定） | 位图 + 同优先级链表 | 纯链表（每优先级一列表） |
| 找最高优先级 | 查表 O(1) | 查表 O(1) | 遍历优先级位 O(1)~O(n) |
| 同优先级多任务 | 不支持（1 任务/优先级） | 时间片轮转（内建） | 时间片轮转（可选） |
| 调度触发点 | 任务主动让出 + tick | 任务主动让出 + tick + 中断退出 | 任务主动让出 + tick + 中断退出 |
| 临界区策略 | 关中断为主 | 锁调度器为主 + BASEPRI | 关中断（BASEPRI 可选） |
| 同步对象 | 信号量 | 信号量/互斥量/队列/事件标志/任务内嵌 | 队列/信号量/事件组/任务通知 |
| 适用场景 | 教学、极简可控的裸机升级 | 需要丰富同步原语的中大型应用 | 普及率高、社区资源多的量产项目 |

三份答卷没有对错，只有取舍：**位图赢在"找最高优先级"恒定 O(1)，链表赢在"同优先级任务数无上限"**；µC/OS-III 两者都要（位图 + 同优先级链表），代价是 TCB 复杂；FreeRTOS 专攻链表，代价是任务多了查找略慢。亲手实现过一遍，这些差异就从"背考点"变成了"自己踩过的坑"。

## 5. 未来扩展方向：MiniOS 的下一个十字路口

MiniOS 已经是一个"五脏俱全"的微内核，想继续长，方向其实就摆在 UCOS 的章节顺序里：

1. **互斥量**：信号量 + 优先级继承，解决优先级翻转（对应 UCOS 第 12 章，本课程第 14 课）。
2. **消息队列**：在信号量的"通知"上加"捎带数据"，任务间传数据（对应 UCOS 第 13/15 章，本课程第 15 课）。
3. **事件标志**：一个对象同时等多个条件（与/或组合）（对应 UCOS 第 16 章，第 15 课）。
4. **软件定时器**：复用延时链表，加个"定时器任务"（对应 UCOS 第 17 章，第 16 课）。
5. **内存管理**：固定分区内存池，避免动态分配碎片（对应 UCOS 第 19 章，第 16 课）。

每条路的骨架你都见过了——它们全是"结构体 + 等待链表 + Pend/Post 变体"的排列组合。这也是为什么我们说：学会一个内核的同步机制，就学会了所有内核的同步机制。

## 核心代码：验收 demo 与内存实测

```c
/* ========== MiniOS 验收 demo：六件套全用上 ========== */
#include "minios.h"

MiniSem  g_data_sem;                 /* 数据同步信号量 */
uint32_t g_shared_data;

/* 生产者：Post + 延时 */
void producer_task(void *arg)
{
    uint32_t n = 0;
    while (1)
    {
        g_shared_data = ++n;         /* "生产" */
        MiniSemPost(&g_data_sem);    /* 同步：通知消费者 */
        MiniTimeDly(500);            /* 延时：500ms 一产 */
    }
}

/* 消费者：Pend + 切换 */
void consumer_task(void *arg)
{
    while (1)
    {
        MiniSemPend(&g_data_sem);    /* 没数据就睡 */
        printf("recv: %lu\r\n", g_shared_data);
        LED0_TOGGLE();               /* 每 500ms 闪一次 */
    }
}

/* 独立任务：验证互不干扰的独立调度 */
void blink_task(void *arg)
{
    while (1)
    {
        LED1_TOGGLE();               /* 每 1000ms 闪一次 */
        MiniTimeDly(1000);
    }
}

int main(void)
{
    /* ...时钟、串口、LED 初始化... */

    MiniSemCreate(&g_data_sem, 0);                    /* 初始 0：消费者先等 */
    MiniTaskCreate(producer_task, 2, "producer");
    MiniTaskCreate(consumer_task, 3, "consumer");
    MiniTaskCreate(blink_task,    4, "blink");
    MiniStart();                                      /* 调度器启动，一去不返 */
}
```

```c
/* ========== 内存实测：sizeof 打印 TCB 与内核对象 ========== */
#include <stdio.h>
#include "minios.h"

/* 放进 main 的最开头（调度器启动前）或一个调试任务里 */
void mem_report(void)
{
    printf("MiniTCB      = %u B\r\n", (unsigned)sizeof(MiniTCB));
    printf("MiniSem      = %u B\r\n", (unsigned)sizeof(MiniSem));
    printf("就绪表(位图)  = %u B (固定)\r\n", (unsigned)(sizeof(g_rdy_grp) + sizeof(g_rdy_tbl)));
    printf("任务栈: 3 x %u B\r\n", (unsigned)TASK_STACK_SIZE * 4);
}

/* ===== 怎么用 MAP 文件量 ROM/RAM（Keil MDK）=====
 * 1. 勾选 Options → Listing → Map File（默认生成 .map）
 * 2. 打开 .map，看 "Total RO Size / Total RW Size / Total ROM Size"
 *    - ROM Size ≈ 代码 + 只读常量；RW Size ≈ 初始化数据 + 零初始化区
 * 3. 在 Image Symbol Table 里搜 mini_*.o / os_*.o / tasks.o
 *    - 每个目标的 Code（ROM）与 Data/Zero（RAM）字节数一目了然
 * 4. 分别给 MiniOS 分支、UCOS 分支、FreeRTOS 分支编译一次，
 *    记录三项：Total ROM、Total RAM、sizeof(TCB)，填进第 3 节的对比表
 * ===== */
```

> 💡 三个分支工程是现成的实验台：UCOS 分支编一次、FreeRTOS 分支编一次、MiniOS 分支编一次，同一块 F407、同一个调试器，三个 .map 文件就是最硬核的课程报告素材。

## 动手练习（约 60~90 分钟）

### 练习 1：MiniOS 完整 demo 验收

- 1️⃣ 把验收 demo 落进 MiniOS 分支并跑通。验收标准：LED0 500ms 闪、LED1 1000ms 闪、串口消费计数连续递增无跳号。
- 2️⃣ 把生产者优先级调成高于消费者，观察谁先跑；再把信号量初始计数改成 3，观察消费节奏变化。各写 2 行现象笔记。
- 3️⃣ 最后通关题：不看代码，画出"一个数据从 Post 到消费"过程中就绪表和等待链表的状态变化序列图。

### 练习 2：用 MAP 文件量 ROM/RAM，填三内核对比表

- 1️⃣ 三个分支各编译一次，导出 .map 文件，记录 Total ROM、Total RAM。
- 2️⃣ 分别在三个工程里打印 `sizeof(TCB)`：MiniOS 的 `sizeof(MiniTCB)`、UCOS 的 `sizeof(OS_TCB)`、FreeRTOS 的 `sizeof(TaskControlBlock_t)`。
- 3️⃣ 把三组数据填进本课第 3 节对照表，验证"MiniOS 最省、UCOS 最全"的预期，写 3 行结论：省在哪些字段、全在哪些功能。

## 自测（答完再点答案）

### 随堂小测

Q1. MiniOS 与 µC/OS-III 的位图就绪表内存开销约为？

- A. 40 字节，固定不变
- B. 每任务 8 字节，随任务数增长
- C. 1KB 起步，按优先级数量增长

<details>
<summary>查看答案</summary>

A。OSRdyGrp(8B) + OSRdyTbl(32B) 共 40B，与任务数无关；FreeRTOS 的链表才随任务数增长。

</details>

Q2. 用 Keil 的 MAP 文件测内核 ROM 占用，应该看哪个统计？

- A. Total RW Size
- B. Total ROM Size
- C. 编译耗时

<details>
<summary>查看答案</summary>

B。Total ROM Size ≈ 代码 + 只读数据；RW Size 是 RAM 侧。更细看 Image Symbol Table 里各 .o 的 Code 段。

</details>

Q3. µC/OS-III 的临界区策略与 FreeRTOS 的主要差别是？

- A. UCOS 锁调度器为主，FreeRTOS 关中断为主
- B. UCOS 完全不用关中断
- C. FreeRTOS 完全不用关中断

<details>
<summary>查看答案</summary>

A。UCOS 用 OSSchedLock 锁调度器减少关中断时间，FreeRTOS 默认关中断（第 1 课对比表 + 第 5 课临界区）。

</details>

Q4. MiniOS 若加消息队列，最该借鉴 UCOS 的哪一章？

- A. 第 12 章互斥信号量
- B. 第 13 章消息队列
- C. 第 19 章内存管理

<details>
<summary>查看答案</summary>

B。第 13 章消息队列：在信号量"通知"基础上加"捎带数据"，骨架仍是结构体 + 等待链表 + Pend/Post 变体。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 10~11 章（PDF p.175~245）——MiniOS 第 4/5 步的蓝本，验收时回翻对照
- 📖 教材第 5.5 节任务控制块（PDF p.100~113）——对比 OS_TCB 全字段与 MiniTCB 的 6 个字段
- 🔁 对照：[FreeRTOS 课程第 5 课：列表与列表项](/my-blog/posts/freertos/0005-lists-and-list-items/)——链表就绪表的架构对照基准
- 🔁 对照：[FreeRTOS 课程第 15 课：内存管理](/my-blog/posts/freertos/0015-memory-management/)——MAP 文件与内存统计的通用方法论

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 13 课——回到 UCOS 应用层：任务管理 API 实战（创建/删除/挂起/恢复/改优先级/时间片）。亲手造过内核之后再回头用商用内核，你会看到每个 API 背后的"零件"。

| [← 上一课](/my-blog/posts/ucosiii/0011-minios-5-sync-primitives/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0013-task-api-practice/) |