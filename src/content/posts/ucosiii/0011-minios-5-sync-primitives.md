---
title: MiniOS⑤：同步原语（信号量）
published: 2026-08-23
description: 让任务之间能"打招呼"——手写 MiniSem 结构体 + Pend/Post/FromISR，用生产者-消费者 demo 验证同步，对照 µC/OS-III 的 OS_SEM/OSSemPend/OSSemPost。
tags: [UCOSIII, 嵌入式, RTOS, MiniOS, 信号量, 同步原语]
category: UCOSIII
draft: false
prevTitle: MiniOS⑥：三内核验收对比
prevSlug: "ucosiii/0012-minios-6-kernel-review"
nextTitle: MiniOS④：时基与任务延时
nextSlug: "ucosiii/0010-minios-4-tick-and-delay"
---

# MiniOS⑤：同步原语（信号量）

让任务之间能"打招呼"——手写一个信号量，MiniOS 实现第 5 步。**本课目标：**上一课任务会睡觉了，但这还不够——任务之间怎么互相协调？一个任务等数据、一个任务发数据，谁来通知谁？答案是信号量。本课参照 µC/OS-III 的 `OS_SEM`/`OSSemPend`/`OSSemPost`，在 MiniOS 里实现一个精简版信号量，并验证"生产者-消费者"同步。学完你就明白：所谓同步原语，就是"计数 + 等待队列"两个字段加上两个函数。

## 1. 为什么需要信号量：同步与互斥

多任务系统里有两类经典问题，信号量就是为它们而生的（PDF 11.1 节 (PDF p.194)）：

- **同步**：任务 A 干完某件事，任务 B 才能继续（比如传感器数据采集完，显示任务才能刷新）。B 需要"等一个通知"。
- **互斥**：两个任务同时操作共享资源（串口、LCD、全局变量），必须"你用完我再进"。二值信号量就是一把锁。

信号量的本质就两个要素：一个**计数器**（还有多少资源可用）+ 一个**等待任务链表**（资源用完了，谁在排队等）。µC/OS-III 的 `OS_SEM` 结构体里，最重要的成员就是 `Ctr`（资源计数器）和 `PendList`（挂起等待任务链表）（PDF 11.2 节 (PDF p.197)）。教材里说的"二值信号量"（计数只能是 0/1，当锁用）和"计数型信号量"（计数可以 >1，当资源池用）共用同一套 API，区别只在初始计数值（PDF 11.5 节 (PDF p.240)）。

> 💡 一句话记忆：信号量 = 计数器（资源还剩几个）+ 等待链表（谁在排队）。Pend 是"申请资源"，Post 是"归还资源"——教科书里 P/V 操作、FreeRTOS 的 Take/Give、UCOS 的 Pend/Post，全是这两个动作。

## 2. 信号量结构体设计：简化版 OS_SEM

µC/OS-III 的完整 `OS_SEM` 带名字、调试指针、时间戳等一大堆字段（PDF p.196~197）。MiniOS 只要最核心的三个：

```c
/* ========== MiniOS/mini_sem.h：简化版 OS_SEM ========== */
typedef struct mini_sem
{
    uint32_t   ctr;            /* 资源计数器，对应 UCOS 的 OS_SEM.Ctr */
    MiniTCB   *wait_head;      /* 等待任务链表头，按优先级排序（对应 UCOS 的 PendList） */
} MiniSem;

/* 创建信号量：传入指针 + 初始计数值（对应 UCOS 的 OSSemCreate） */
void MiniSemCreate(MiniSem *sem, uint32_t cnt);
void MiniSemPend(MiniSem *sem);          /* 申请资源，拿不到就阻塞（对应 OSSemPend） */
void MiniSemPost(MiniSem *sem);          /* 归还资源，唤醒等待者（对应 OSSemPost） */
void MiniSemPostFromISR(MiniSem *sem);   /* 中断版 Post：只置位不调度（对应 OSSemPostFromISR） */
```

三个字段背后是三个问题：还有多少资源？（`ctr`）谁在等？（`wait_head`）等的人先唤醒谁？（链表按优先级排序——最高优先级先醒，这是 µC/OS-III 与 FreeRTOS 共同的策略）。

## 3. OSSemPend：拿到就用，拿不到就等

`OSSemPend(p_sem, timeout, opt, p_ts, p_err)` 的完整实现有一堆参数检查和错误码（PDF 11.2 节 (PDF p.205~211)），核心逻辑其实只有两条路：

1. **有资源**（`Ctr > 0`）：`Ctr--`，直接返回，任务继续跑。
2. **没资源**（`Ctr == 0`）：把当前任务加入信号的等待链表（任务状态 → 等待），**触发调度**让出 CPU，挂起等待。直到有人 Post 把它唤醒，代码才继续往下执行。

这就是"阻塞式 API"的奥妙：`OSSemPend` 后半段代码要等任务被唤醒后才执行，而 µC/OS-III 里用 `PendStatus`（挂起结果）区分"成功拿到 / 超时 / 被中止"三种醒来的原因——这也是为什么它带 timeout 参数（PDF p.210~211）。MiniOS 第一步先不做超时，保持最简。

## 4. OSSemPost：唤醒等待者，而不是攒资源

`OSSemPost(p_sem, opt, p_err)` 的逻辑和 Pend 正好镜像（PDF 11.2 节 (PDF p.216~219)）：

1. **有等待者**（等待链表非空）：不累加计数，直接把资源交给等待链表中**优先级最高的任务**——把它从等待链表摘下、状态改回就绪、加入就绪表，然后触发调度。资源"直达"，不经过计数器。
2. **没等待者**：`Ctr++`，资源攒着给将来的 Pend 用。

教材代码里还有两个选项：`OS_OPT_POST_ALL`（唤醒所有等待者，计数型信号量广播用）和 `OS_OPT_POST_NO_SCHED`（只唤醒不调度，批量 Post 时最后再统一调度一次）。MiniOS 只要默认的"唤醒最高优先级一个 + 调度"即可。

## 5. 中断里也能 Post：只置位，不调度

真实系统里经常有这种场景：串口收到一字节 → 中断里 Post 信号量 → 等待中的解析任务被唤醒。但中断里**不能直接调度**（上下文切换要等所有中断退出，这是第 5 课中断知识的延伸）。

µC/OS-III 的做法：`OSSemPost()` 检测到自己在中断里（`OSIntNestingCtr > 0`）就跳过 `OSSched()`；FreeRTOS 则专门提供 `xSemaphoreGiveFromISR()`，把"需要切换"标记成 `pxHigherPriorityTaskWoken = pdTRUE`，由中断退出路径统一处理。MiniOS 的 `MiniSemPostFromISR` 就学 FreeRTOS：唤醒任务、置一个标志，调度推迟到中断退出后。等第 13 课学完中断管理，你能把这个标志接到 PendSV 上。

> ⚠️ 千万别在中断里调用普通版 `MiniSemPost()`：它会直接调用 `MiniSched()` 触发上下文切换，在中断上下文中做切换会破坏中断现场，行为不可预测。UCOS 对这种误用会返回 `OS_ERR_POST_ISR` 之类的错误码拦下来（PDF p.216），MiniOS 至少要在代码注释里写清楚这个约定。

## 6. 与 UCOS / FreeRTOS 对照 + 本课交付

| 维度 | µC/OS-III | FreeRTOS（已学） | MiniOS（本课） |
|------|------|------|------|
| 结构体 | `OS_SEM`：Ctr + PendList + 调试字段 | `SemaphoreHandle_t` 背后是 Queue | `MiniSem`：ctr + wait_head |
| 申请 | `OSSemPend`（带超时） | `xSemaphoreTake`（带超时） | `MiniSemPend`（无超时） |
| 释放 | `OSSemPost` | `xSemaphoreGive` | `MiniSemPost` |
| 中断版 | Post 内部自动判断 | `xSemaphoreGiveFromISR` | `MiniSemPostFromISR` |
| 唤醒顺序 | 按优先级 | 按优先级 | 按优先级 |

**本课交付：**MiniSem 结构体 + Create/Pend/Post 三个函数，用"生产者-消费者"demo 验证同步。学完这一步，MiniOS 就集齐了"调度 + 延时 + 同步"三件套，具备跑通真实同步场景的能力。

## 核心代码：信号量完整实现

```c
/* ========== MiniOS/mini_sem.c：Pend/Post 核心逻辑（对应 UCOS 的 OSSemPend/OSSemPost） ========== */
#include "minios.h"

void MiniSemCreate(MiniSem *sem, uint32_t cnt)
{
    sem->ctr       = cnt;        /* 初始资源数 */
    sem->wait_head = NULL;       /* 等待链表为空 */
}

/* 申请资源：拿到就用，拿不到就挂起等待 */
void MiniSemPend(MiniSem *sem)
{
    MiniTCB *cur = g_cur_tcb;

    /* 关中断保护：计数与链表操作不能被打断（对应 UCOS 的 CPU_CRITICAL_ENTER） */
    uint32_t sr = enter_critical();

    if (sem->ctr > 0)
    {
        sem->ctr--;              /* 1. 有资源：直接拿走 */
        exit_critical(sr);
        return;
    }

    /* 2. 没资源：当前任务加入等待链表（按优先级排序），状态改为等待 */
    cur->state = TASK_WAIT;
    sem_wait_insert_sorted(sem, cur);   /* 优先级高的排在前面，先被唤醒 */
    exit_critical(sr);

    /* 3. 触发调度让出 CPU——任务在这里"睡着"，直到被 Post 唤醒 */
    MiniSched();
}

/* 归还资源：有等待者就直接唤醒，没有才攒进计数器 */
void MiniSemPost(MiniSem *sem)
{
    uint32_t sr = enter_critical();

    if (sem->wait_head != NULL)
    {
        /* 1. 有等待者：唤醒优先级最高的那个，资源"直达"不经过计数器 */
        MiniTCB *tcb = sem->wait_head;
        sem->wait_head = tcb->sem_next;
        tcb->state = TASK_RDY;
        rdy_insert(tcb);         /* 回就绪表，对应 UCOS 的 OS_RdyListInsert */
    }
    else
    {
        sem->ctr++;              /* 2. 没等待者：资源攒起来 */
    }
    exit_critical(sr);

    MiniSched();                 /* 3. 触发调度：唤醒者可能优先级更高 */
}

/* 中断版 Post：只唤醒不调度，切换留到中断退出后（对应 FreeRTOS 的 GiveFromISR） */
void MiniSemPostFromISR(MiniSem *sem)
{
    if (sem->wait_head != NULL)
    {
        MiniTCB *tcb = sem->wait_head;
        sem->wait_head = tcb->sem_next;
        tcb->state = TASK_RDY;
        rdy_insert(tcb);
        g_pendsv_pending = 1;    /* 标记：中断退出后需要切换 */
    }
    else
    {
        sem->ctr++;
    }
}
```

```c
/* ========== MiniOS 生产-消费者 demo（main 或 start_task 里创建） ========== */
MiniSem g_sem;                    /* 全局信号量：数据就绪通知 */

/* 生产者：每 100ms "生产"一个数据，Post 一次 */
void producer_task(void *arg)
{
    uint32_t count = 0;
    while (1)
    {
        count++;
        g_shared_data = count;    /* 模拟往缓冲区放数据 */
        MiniSemPost(&g_sem);      /* 通知消费者：有数据了 */
        MiniTimeDly(100);         /* 上一课的延时 */
    }
}

/* 消费者：等通知才消费，否则阻塞 */
void consumer_task(void *arg)
{
    while (1)
    {
        MiniSemPend(&g_sem);      /* 拿不到就"睡觉"，不空转 */
        printf("消费: %lu\r\n", g_shared_data);
        LED1_TOGGLE();            /* 用 LED 肉眼验证节奏 */
    }
}

int main(void)
{
    /* ...硬件初始化... */
    MiniSemCreate(&g_sem, 0);     /* 初始 0：消费者必须先等生产者 */
    MiniTaskCreate(producer_task, 2);   /* 第 7 课的任务创建 */
    MiniTaskCreate(consumer_task, 3);
    MiniStart();                  /* 第 9 课的调度器启动 */
}
```

> 💡 验证要点：把 `g_sem` 初始计数改成 3 再跑一遍——消费者会一口气消费 3 次才停下来等，这就直观看到了"计数型信号量"和"二值信号量"的差别（对应教材 11.5 节计数型信号量实验 (PDF p.240)）。

## 动手练习（约 50~70 分钟）

### 练习 1：实现信号量并用生产者-消费者验证

- 1️⃣ 在 MiniOS 分支新建 `mini_sem.h / mini_sem.c`，实现上面的 Create/Pend/Post 三个函数（`enter_critical/exit_critical` 用你第 5 课学的临界区实现，`rdy_insert` 用第 8 课的）。
- 2️⃣ 跑通生产-消费 demo。验收标准：串口打印的消费计数连续无丢失，LED1 闪烁频率与生产者 100ms 节拍一致。
- 3️⃣ 写一个"互斥"实验：两个任务都不加信号量地打印一串字符到串口（观察乱码），再用一个初始计数为 1 的信号量包住打印区域（观察整齐）。这就是二值信号量当锁用的意义。

### 练习 2：优先级唤醒验证 + FromISR 改造

- 1️⃣ 让三个不同优先级的任务同时 Pend 同一个空信号量，再让一个任务 Post 一次。验收标准：被唤醒的是优先级最高的那个，而不是先 Pend 的那个（顺序列表 vs 优先级列表的差别）。
- 2️⃣ 改造：把生产者换成"定时器中断里调用 `MiniSemPostFromISR`"，消费者在任务里 Pend。验证中断里也能完成同步，且系统不崩。
- 3️⃣ 思考题：为什么 Post 唤醒的是"最高优先级等待者"而不是"最早等待者"？提示：结合第 4 课位图就绪表的 O(1) 设计目标想 3 分钟。

## 自测（答完再点答案）

### 随堂小测

Q1. MiniSemPend 在信号量计数为 0 时会做什么？

- A. 空转等待直到计数变化
- B. 把自己挂进等待链表并触发调度
- C. 直接返回错误码

<details>
<summary>查看答案</summary>

B。计数为 0 时任务状态改为等待、加入等待链表，然后 OSSched() 让出 CPU（PDF p.209~210）。

</details>

Q2. OSSemPost 时等待链表非空，计数器会怎样？

- A. 计数器加一，唤醒等待者
- B. 计数器不变，唤醒最高优先级等待者
- C. 计数器加一，但没人被唤醒

<details>
<summary>查看答案</summary>

B。有等待者时资源"直达"，不经过计数器（PDF p.218 的 OS_Post 逻辑）。

</details>

Q3. 中断服务函数里调用 Post 版函数，最关键的限制是？

- A. 不能修改计数器
- B. 不能直接触发任务切换
- C. 不能访问全局变量

<details>
<summary>查看答案</summary>

B。切换要等所有中断退出后由 PendSV 完成，中断里直接调度会破坏中断现场。

</details>

Q4. 二值信号量与计数型信号量的本质区别是？

- A. 使用不同的 API 函数
- B. 初始计数值不同（0/1 还是 >1）
- C. 等待链表排序方式不同

<details>
<summary>查看答案</summary>

B。共用同一套 API，区别只在创建时初始计数：1 当锁（互斥），>1 当资源池（PDF 11.5 节 (PDF p.240)）。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 11 章（PDF p.194~245）——信号量简介、OS_SEM 结构体、OSSemPend/OSSemPost 全流程
- 🔁 对照：[FreeRTOS 课程第 9 课：信号量](/my-blog/posts/freertos/0009-semaphores/)——xSemaphoreTake/Give 与 FromISR 的对照基准
- 📕 内核结构参考：µC/OS-III 源码 `os_sem.c`（你的分支工程里）——对照 Pend/Post 的真实实现和错误码设计

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 12 课——MiniOS⑥：三内核验收对比。MiniOS 功能齐了，该跟 UCOS 和 FreeRTOS 正式"同台比武"：比代码量、比内存、比架构。

| [← 上一课](/my-blog/posts/ucosiii/0010-minios-4-tick-and-delay/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0012-minios-6-kernel-review/) |