---
title: MiniOS④：时基与任务延时
published: 2026-08-22
description: 给内核装上一颗"心脏"（SysTick 时基），让任务学会"睡觉"——手写 OSTimeTick/OSTimeDly 等价物，排序链表版延时任务组织，对照 FreeRTOS vTaskDelay。
tags: [UCOSIII, 嵌入式, RTOS, MiniOS, 时基, 任务延时]
category: UCOSIII
draft: false
prevTitle: MiniOS⑤：同步原语（信号量）
prevSlug: "ucosiii/0011-minios-5-sync-primitives"
nextTitle: MiniOS③ 调度器与临界区
nextSlug: "ucosiii/0009-minios-3-scheduler"
---

# MiniOS④：时基与任务延时

给内核装上一颗"心脏"（SysTick 时基），让任务学会"睡觉"——MiniOS 实现第 4 步。**本课目标：**前几课 MiniOS 已经有了 TCB、位图就绪表、上下文切换和调度器，但任务只会"抢 CPU"，不会"让 CPU"。本课给它补上时基：SysTick 中断驱动 tick 处理，实现延时 API，让任务能按节拍"睡一觉"再醒来。学完你能说清 µC/OS-III 的 OSTimeTick/OSTimeDly 是怎么工作的，并在 MiniOS 里亲手实现一遍。

## 1. 时基来源：SysTick 就是 RTOS 的心跳

任何操作系统都需要一个"心跳"——固定的时间脉冲，内核靠它感知时间的流逝。µC/OS-III 用一个全局计数器 `OSTickCtr` 记录系统启动以来跳了多少次（os.h 中定义，本质就是一个 32 位无符号整数，PDF 10.1.1 节 (PDF p.175)）。每跳一次加 1，延时、超时、时间片轮转全建立在它上面。

这个脉冲从哪来？最优解就是 **SysTick（滴答定时器）**——它就是为操作系统提供心跳而设计的（PDF 10.1.2 节 (PDF p.175)）。µC/OS-III 里由 `OS_CPU_SysTickInit(cnts)` 配置：

- **重装载值**：`cnts = HAL_RCC_GetSysClockFreq() / OSCfg_TickRate_Hz`。你的 F407 主频 168MHz，教材默认节拍率 `OS_CFG_TICK_RATE_HZ = 1000`，所以 `cnts = 168000`，1 个 tick = 1ms。
- **时钟源**：强制 SysTick 与 CPU 内核同频（不像 F1 系列是 1/8，F407 这里直接用内核频率）。
- **中断使能**：SysTick 溢出就进 `SysTick_Handler()`。

教材里的中断入口长这样（PDF 10.1.3 节 (PDF p.177)）：

```c
/* 教材：SysTick_Handler 里判断内核是否已运行 */
void SysTick_Handler(void)
{
    if (OSRunning == OS_STATE_OS_RUNNING)   /* OS 跑起来才处理节拍事务 */
    {
        OS_CPU_SysTickHandler();            /* 内部：OSIntEnter() → OSTimeTick() → OSIntExit() */
    }
    HAL_IncTick();                          /* HAL 库的毫秒计数，别删 */
}
```

> 💡 对照 FreeRTOS 课第 14 课：FreeRTOS 用 `configTICK_RATE_HZ = 1000` 和 `xTickCount`，进入 `xPortSysTickHandler() → xTaskIncrementTick()`。两者的结构惊人相似——时基的架构几乎是所有 RTOS 的公共知识，只是名字不同。

## 2. OSTimeTick 等价物：tick 中断里干什么

µC/OS-III 里 `OSTimeTick()` 主要干两件事（PDF 10.1.3 节 (PDF p.177~180)）：

1. **更新节拍计数器**：`OSTickCtr += 1`（由 `OS_TickUpdate()` 完成）。
2. **处理 Tick 任务链表**：`OS_TickListUpdate()` 遍历"因延时或等待事件而挂起"的任务，谁的超时时间到了，谁就从 Tick 链表挪回就绪态任务链表（PDF 10.1.3 节 (PDF p.181~185)）。

注意一个精妙的细节：µC/OS-III 的 Tick 链表**按剩余挂起时间升序排列**，每个任务 TCB 里存 `TickRemain`（相对剩余节拍数）。tick 处理时先看链表头的任务：如果头任务都没到期，后面更不会到期，直接结束——这就是 O(1) 的到期判断。

> ⚠️ 教材的 `OS_TickListUpdate()` 源码里还有互斥量优先级继承、消息清空等一大坨代码（PDF p.183~185），那是给完整内核用的。MiniOS 阶段先砍掉，只保留核心骨架：到期→回就绪表。等第 14 课学互斥量再回头看这段，你会豁然开朗。

## 3. 延时实现：OSTimeDly 的三步曲

`OSTimeDly(dly, opt, p_err)` 以系统时钟节拍为单位延时（PDF 10.2 节 (PDF p.186)）。函数本体很短，因为它只是"搬家"：

1. **加入 Tick 任务链表**：`OS_TickListInsertDly()`，把当前任务挂进延时链表并记下超时时间。
2. **移出就绪表**：`OS_RdyListRemove()`，任务不再参与调度。
3. **触发调度**：`OSSched()`，让出 CPU——从此任务进入"睡眠"，直到 tick 把它叫醒。

错误检查也是内核该有的样子：`OS_ERR_TIME_DLY_ISR`（中断里不能延时）、`OS_ERR_SCHED_LOCKED`（调度器锁着不能延时）、`OS_ERR_TIME_ZERO_DLY`（延时 0 无意义）。这些"护栏"是专业内核和玩具内核的分水岭，MiniOS 至少留一个调度器锁定检查。

## 4. 延时任务怎么组织：计数版 vs 排序链表版

这是本课最有嚼头的设计决策，两种方案都讲：

| 方案 | 做法 | 每个 tick 的开销 | 评价 |
|------|------|------|------|
| **简单计数版** | 每个 TCB 一个 `DelayCtr`，tick 里**遍历所有任务**，逐个减 1 | O(n)，n = 任务总数 | 代码最少，但任务多了浪费；且"每 tick 全表扫描"随着任务数线性恶化 |
| **排序链表版** ⭐ | 延时任务按剩余节拍升序挂链表，tick 里**只看链表头**，头不到期就收工 | O(1) 判断 + 偶尔 O(k) 唤醒 | µC/OS-III（TickRemain）和 FreeRTOS（按唤醒时刻排序）都是这个思路，只是细节不同 |

两者正确性都成立，但排序链表版的复杂度不随任务数增长，是"职业选手"的选择。本课交付代码用链表版。

顺带一提排序链表里"相对剩余时间"的妙处：插入时只要保证链表升序，tick 时只对头节点减 1，其余节点的相对顺序天然不变——不需要遍历改所有人的剩余时间。µC/OS-III 的 `TickRemain` 就是这么玩的。

## 5. 与 FreeRTOS vTaskDelay 对照

FreeRTOS 的 `vTaskDelay()`（第 14 课讲过）和 µC/OS-III 的 `OSTimeDly()` 是同一件事的两种记账方式：

| 维度 | FreeRTOS vTaskDelay | µC/OS-III OSTimeDly |
|------|------|------|
| 记账方式 | **绝对唤醒时刻**：`xTimeToWake = xTickCount + xTicksToDelay`，阻塞列表按唤醒时刻排序 | **相对剩余节拍**：TCB 里存 `TickRemain`，链表升序，tick 时头节点递减 |
| tick 溢出处理 | 唤醒时刻溢出用**双阻塞列表**切换 | 相对时间天然不怕溢出（差值永不变） |
| 到期加速 | `xNextTaskUnblockTime` 缓存最早唤醒时刻 | 链表头就是最早到期者，天然 O(1) |
| 延时 0 | 不阻塞，只让出一次 CPU | 报 `OS_ERR_TIME_ZERO_DLY` 错误 |

两种记账方式殊途同归，都做到了"tick 里只处理头部"的高效。MiniOS 用 µC/OS-III 的相对节拍流派，代码更少、更好懂。

## 6. 本课交付：让任务能"睡觉"

给 MiniOS 加三样东西，任务从此学会睡眠：

1. **时基初始化**：`MiniTickInit()` 配置 SysTick（重装载值 + 使能中断）。
2. **tick 处理**：`SysTick_Handler → MiniTickUpdate()`，更新计数器 + 处理延时链表。
3. **延时 API**：`MiniTimeDly(ticks)`，三步曲搬家 + 触发调度。

## 核心代码：延时链表版实现

下面两段代码就是本课的交付物，直接落进 MiniOS 分支的 `MiniOS/` 目录。命名延续前几课（`rdy_insert/rdy_remove` 是第 8 课就绪表、`MiniSched` 是第 9 课调度器、`MiniTCB` 是第 7 课任务控制块），跟你自己实现里的名字对不上就替换成你自己的。

```c
/* ========== MiniOS/os_tick.c：tick 中断处理（对应 UCOS 的 OSTimeTick + OS_TickListUpdate） ========== */
#include "minios.h"

volatile uint32_t g_tick_ctr;        /* 系统节拍计数器，对应 UCOS 的 OSTickCtr */
MiniTCB *g_dly_head;                 /* 延时链表头，按剩余节拍升序排列 */

/* SysTick 中断入口：在中断向量里指向这里，或包一层 SysTick_Handler */
void SysTick_Handler(void)
{
    HAL_IncTick();                   /* HAL 库毫秒计数，别删 */
    MiniTickUpdate();
}

void MiniTickUpdate(void)
{
    g_tick_ctr++;                    /* 1. 更新节拍计数器 */

    /* 2. 处理延时链表：只关心链表头，头没到期后面更不会到期 */
    while (g_dly_head != NULL)
    {
        MiniTCB *tcb = g_dly_head;

        if (tcb->dly_remain > 0)     /* 头任务还有剩余节拍 */
        {
            tcb->dly_remain--;       /* 只减头，其余节点相对顺序不变 */
            break;                   /* 收工，本 tick 到此为止 */
        }

        /* 到期：从延时链表摘下，回就绪表 */
        dly_remove(tcb);
        rdy_insert(tcb);             /* 第 8 课的位图就绪表插入 */
        tcb->state = TASK_RDY;
    }
}
```

```c
/* ========== MiniOS/os_time.c：任务延时（对应 UCOS 的 OSTimeDly） ========== */
void MiniTimeDly(uint32_t ticks)
{
    MiniTCB *cur = g_cur_tcb;        /* 当前任务（第 9 课调度器的全局量） */

    if (ticks == 0)                  /* 延时 0 无意义，UCOS 报错；这里退化为让出 CPU */
    {
        MiniSched();
        return;
    }

    cur->dly_remain = ticks;
    cur->state = TASK_DLY;

    rdy_remove(cur);                 /* 1. 从就绪表（位图）移除 */
    dly_insert_sorted(cur);          /* 2. 按剩余节拍升序插入延时链表 */
    MiniSched();                     /* 3. 触发调度，交出 CPU，任务开始"睡觉" */
}

/* 按剩余节拍升序插入：tick 处理时才能"只看头节点" */
static void dly_insert_sorted(MiniTCB *tcb)
{
    MiniTCB **pp = &g_dly_head;
    while (*pp != NULL && (*pp)->dly_remain <= tcb->dly_remain)
    {
        pp = &(*pp)->dly_next;
    }
    tcb->dly_next = *pp;
    *pp = tcb;
}
```

对比一下"简单计数版"长什么样——你就明白为什么推荐链表版：

```c
/* ========== 简单计数版（仅示意，不推荐用于交付） ========== */
/* 每个 TCB 多一个 DelayCtr 字段，g_task_list 是所有任务的数组 */
void MiniTickUpdate_counting(void)
{
    g_tick_ctr++;
    for (int i = 0; i < g_task_cnt; i++)        /* 每个 tick 都遍历所有任务 */
    {
        if (g_task_list[i].state == TASK_DLY && g_task_list[i].DelayCtr > 0)
        {
            if (--g_task_list[i].DelayCtr == 0) /* 到期回就绪表 */
            {
                rdy_insert(&g_task_list[i]);
                g_task_list[i].state = TASK_RDY;
            }
        }
    }
}
```

> 💡 调试技巧：把 `g_tick_ctr` 和任务状态打印到串口，肉眼确认"两个任务 1s 交替一次"的节拍。MiniOS 没有调试器依赖，串口 printf 就是你的逻辑分析仪。

## 动手练习（约 40~60 分钟）

### 练习 1：给 MiniOS 加延时，验证双任务交替

- 1️⃣ 在 MiniOS 分支新建 `MiniOS/os_tick.c` 和 `MiniOS/os_time.c`，把上面的核心代码落进去（函数名可换成你自己的）。
- 2️⃣ 在 `MiniInit()` 里调用 `MiniTickInit()`：配置 SysTick 重装载值为 `168000`（168MHz / 1000Hz），使能 SysTick 中断（记得把 SysTick 优先级设为内核管理范围内的最低优先级，对应第 5 课临界区知识）。
- 3️⃣ 写两个任务：task1 每 500ms 翻转 LED0，task2 每 1000ms 翻转 LED1。验收标准：LED0 闪速是 LED1 的两倍，串口打印两条独立计数。
- 4️⃣ 思考：把两个任务延时都改成 1000ms 且优先级相同，观察现象；再把 task1 优先级调高，看执行顺序怎么变。写 3 行观察笔记。

### 练习 2：链路验证——从延时到唤醒

- 1️⃣ 在 `MiniTickUpdate()` 里加一个调试钩子：当有任务被唤醒回就绪表时，打印 `tcb->name` 和当前 `g_tick_ctr`。
- 2️⃣ 验证时序：task1 延时 500 ticks，观察唤醒时 `g_tick_ctr` 的差值是否正好 500（允许 ±1 tick 的边界误差）。
- 3️⃣ 进阶挑战：实现 `MiniTimeDlyHMSM`（把时分秒毫秒换算成 ticks 再调 `MiniTimeDly`），对应教材 `OSTimeDlyHMSM()`（PDF 10.2 节 (PDF p.190)）。

## 自测（答完再点答案）

### 随堂小测

Q1. µC/OS-III 的 SysTick 重装载值由什么决定？

- A. CPU 主频除以节拍频率
- B. 固定为 1000
- C. 由用户随便指定

<details>
<summary>查看答案</summary>

A。cnts = 主频 / OSCfg_TickRate_Hz，F407 是 168MHz/1000 = 168000（PDF p.175~176）。

</details>

Q2. 排序链表版延时方案里，每个 tick 需要处理多少个延时任务？

- A. 所有延时任务
- B. 只有链表头任务
- C. 随机一个任务

<details>
<summary>查看答案</summary>

B。链表按剩余节拍升序，头任务没到期后面更不会到期，O(1) 判断（PDF p.182 的 OS_TickListUpdate 思路）。

</details>

Q3. OSTimeDly 把任务从就绪表移除后，还需要做什么才能让出 CPU？

- A. 什么都不用做
- B. 主动触发一次调度
- C. 关中断等节拍

<details>
<summary>查看答案</summary>

B。OS_TickListInsertDly → OS_RdyListRemove → OSSched()，三步曲最后必须触发调度，CPU 才会交给别的任务（PDF p.189）。

</details>

Q4. 相对剩余节拍记账法相比"绝对唤醒时刻"记账法的一个天然优势是？

- A. 不需要处理 tick 计数溢出
- B. 内存占用少一半
- C. 精度更高

<details>
<summary>查看答案</summary>

A。差值记账不依赖计数器绝对值，天然不怕溢出；FreeRTOS 才需要双阻塞列表处理唤醒时刻溢出。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 10 章（PDF p.175~193）——系统时钟节拍 + 任务延时全部依据
- 🔁 对照：[FreeRTOS 课程第 14 课：时间管理](/my-blog/posts/freertos/0014-time-management/)——vTaskDelay 相对延时与绝对延时的对照基准
- 📕 内核结构参考：µC/OS-III 源码 `os_time.c / os_tick.c`（你的分支工程里）——对照 `OSTimeDly()` 与 `OS_TickListUpdate()` 的真实实现

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 11 课——MiniOS⑤：信号量。任务会睡觉了，但任务之间怎么互相"打招呼"？用同步原语。

| [← 上一课](/my-blog/posts/ucosiii/0009-minios-3-scheduler/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0011-minios-5-sync-primitives/) |