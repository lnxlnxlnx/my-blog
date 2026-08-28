---
title: 消息队列与事件标志
published: 2026-08-27
description: 消息池与万能指针、任务内嵌信号量/消息队列、事件标志组的与或等待——UCOS 的通信全家桶，全部对照 FreeRTOS 的队列/任务通知/事件组。
tags: [UCOSIII, 嵌入式, RTOS, 消息队列, 事件标志]
category: UCOSIII
draft: false
prevTitle: 软件定时器、内存管理与三内核总结
prevSlug: "ucosiii/0016-timers-memory-and-summary"
nextTitle: 信号量与互斥量
nextSlug: "ucosiii/0014-semaphores-and-mutexes"
---

# 消息队列与事件标志

消息池与万能指针、任务内嵌信号量/消息队列、事件标志组的与或等待——UCOS 的通信全家桶。**本课目标：**上两课的信号量只传"信号"不传"数据"，这一课补上数据传输与多事件同步（教材第 13~16 章，(PDF p.283~392)）。学完你能说清：UCOS 消息队列为什么只传指针不拷数据、消息池 `OS_CFG_MSG_POOL_SIZE` 是什么；任务内嵌信号量/消息队列凭什么比内核对象"快"；事件标志组怎么实现"与/或"等待。全部对照 FreeRTOS 的队列/任务通知/事件组，你会看到两套设计对同一问题的不同答案。

## 1. 消息队列：传指针，不搬数据

任务与任务、任务与中断之间传数据，最朴素的办法是全局变量——但全局变量有两个毛病（教材 13.1 节）：① 它是共享资源，要自己处理互斥；② 接收方**无法知道它什么时候被更新**，只能轮询。消息队列就是解药。

先看消息长什么样，`OS_MSG` 结构定义在 os.h（教材 13.1 节）：

```c
/* 一条消息：不装数据本身，只装"数据在哪、有多大" */
struct os_msg
{
    OS_MSG     *NextPtr;    /* 指向消息池中下一条消息 */
    void       *MsgPtr;     /* 指向消息内容的指针（万能指针） */
    OS_MSG_SIZE MsgSize;    /* 消息内容大小，单位：字节 */
#if (OS_CFG_TS_EN > 0u)
    CPU_TS      MsgTS;      /* 消息发送时的时间戳 */
#endif
};
```

关键点：**消息不拷贝数据，只传递指针**。`MsgPtr` 是 `void *`，可以指向任何东西——一个结构体、一个数组、甚至一个函数。接收方拿到指针后按"事先约定好的格式"解析。所以发送方和接收方必须约定好数据类型，这是使用消息队列的铁律。

> 💡 对照 FreeRTOS 第 8 课：FreeRTOS 队列是"定长项目 + 内存拷贝"——`xQueueSend` 把数据复制进队列存储区，`xQueueReceive` 再复制出来；UCOS 队列是"不定长指针 + 消息池"——每个 `OS_MSG` 节点从全局**消息池**里取，池的大小由 `os_cfg_app.h` 里的 `OS_CFG_MSG_POOL_SIZE` 配置。一个偏拷贝、一个偏指针，这就是两家设计的性格差异。指针方案快（只搬 8 字节），但要求消息内容在接收期间保持有效（比如别用栈上的局部变量发完就丢）。

核心 API 三个（教材 13.2 节）：

```c
/* 创建消息队列：max_qty 是队列能容纳的最大消息数 */
void OSQCreate(OS_Q *p_q, CPU_CHAR *p_name, OS_MSG_QTY max_qty, OS_ERR *p_err);

/* 发送消息：p_void 指向消息内容，msg_size 是内容大小（字节） */
void OSQPost(OS_Q *p_q, void *p_void, OS_MSG_SIZE msg_size,
             OS_OPT opt, OS_ERR *p_err);

/* 获取消息：返回指向消息的指针，p_msg_size 带回消息大小 */
void *OSQPend(OS_Q *p_q, OS_TICK timeout, OS_OPT opt,
              OS_MSG_SIZE *p_msg_size, CPU_TS *p_ts, OS_ERR *p_err);
```

- `OSQPost` 的 opt：`OS_OPT_POST_FIFO`（先进先出，默认）、`OS_OPT_POST_LIFO`（后进先出——教材 13.1 节特别强调：紧急消息用 LIFO 可以插队）、`OS_OPT_POST_ALL`（广播给所有等待任务）、可组合 `OS_OPT_POST_NO_SCHED`。队列满了返回 `OS_ERR_Q_MAX`。
- `OSQPend` 的 opt：`OS_OPT_PEND_BLOCKING` / `OS_OPT_PEND_NON_BLOCKING`，timeout=0 依然是无限等待；超时返回 `OS_ERR_TIMEOUT`，`p_msg_size` 不能传 NULL（否则 `OS_ERR_PTR_INVALID`）。
- 多个任务可以同时 `OSQPend` 同一个队列，Post 时按"等待者优先级最高"或 ALL 广播的方式唤醒（教材 13.1.1 图示）。

教材 13.3 节实验是最标准的"生产者-消费者"：task1 扫按键把键值发进队列，task2 阻塞等消息，收到后刷屏/翻转 LED：

```c
OS_Q q;   /* 消息队列对象 */

/* start_task 中创建：队列最大 1 条消息 */
OSQCreate((OS_Q *)&q, (CPU_CHAR *)"q", (OS_MSG_QTY)1, (OS_ERR *)&err);

/* task1：生产者——按键键值作为消息发出去 */
void task1(void *p_arg)
{
    OS_ERR err;
    uint8_t key;

    while (1)
    {
        key = key_scan(0);
        if (key != 0)
        {
            OSQPost((OS_Q *)&q, (void *)&key,     /* 传键值地址 */
                    (OS_MSG_SIZE)sizeof(key),
                    (OS_OPT)OS_OPT_POST_FIFO,      /* 先进先出 */
                    (OS_ERR *)&err);
        }
        OSTimeDly(10, OS_OPT_TIME_DLY, &err);     /* 每 10 tick 扫一次键 */
    }
}

/* task2：消费者——阻塞等消息，拿到再干活 */
void task2(void *p_arg)
{
    OS_ERR err;
    OS_MSG_SIZE size;
    uint8_t *key;

    while (1)
    {
        key = (uint8_t *)OSQPend((OS_Q *)&q, (OS_TICK)0,  /* 0 = 无限等待 */
                                 (OS_OPT)OS_OPT_PEND_BLOCKING,
                                 (OS_MSG_SIZE *)&size,
                                 (CPU_TS *)0, (OS_ERR *)&err);
        if (err == OS_ERR_NONE)
        {
            printf("recv key: %d\r\n", *key);   /* 按键 0 刷屏、按键 1 翻灯 */
        }
    }
}
```

## 2. 任务内嵌信号量：没有中间对象的同步

教材 14 章带来一个 UCOS 独有设计——**任务内嵌信号量**：每个任务的 `OS_TCB` 里都内置了一个信号量，创建任务时就创建好了，**不需要任何内核对象**。规则很明确（教材 14.1 节）：内嵌信号量**只能被本任务 Pend**，但**其他任务或中断可以 Post** 它。因为信号直达目标任务的 TCB，少了一层"对象 + 等待链表"的中间环节，效率比独立信号量高，实际开发可以优先考虑。

```c
/* 获取（只能自己调用）：返回更新后的资源数 */
OS_SEM_CTR OSTaskSemPend(OS_TICK timeout, OS_OPT opt,
                         CPU_TS *p_ts, OS_ERR *p_err);

/* 释放：p_tcb 指定给哪个任务发信号（其他任务/中断用它） */
OS_SEM_CTR OSTaskSemPost(OS_TCB *p_tcb, OS_OPT opt, OS_ERR *p_err);

/* 强制设置指定任务的内嵌信号量值 */
OS_SEM_CTR OSTaskSemSet(OS_TCB *p_tcb, OS_SEM_CTR cnt, OS_ERR *p_err);
```

教材 14.3 节实验：task1 扫按键，按 KEY0 就 `OSTaskSemPost(&Task2Task_TCB, ...)` 给 task2 发信号；task2 用 `OSTaskSemPend` 无限等待，收到就刷屏。对比第 14 课的二值信号量实验，你会发现**少了 OSSemCreate 这一行、少了 sem 对象，其余几乎一样**：

```c
/* task1：按键发信号给 task2（注意目标是 TCB 指针，不是对象） */
void task1(void *p_arg)
{
    OS_ERR err;
    uint8_t key;

    while (1)
    {
        key = key_scan(0);
        if (key == KEY0_PRES)
        {
            OSTaskSemPost((OS_TCB *)&Task2Task_TCB,   /* 给 task2 发信号 */
                          (OS_OPT)OS_OPT_POST_NONE, (OS_ERR *)&err);
        }
        OSTimeDly(10, OS_OPT_TIME_DLY, &err);
    }
}

/* task2：只等自己的内嵌信号量 */
void task2(void *p_arg)
{
    OS_ERR err;

    while (1)
    {
        OSTaskSemPend((OS_TICK)0,                     /* 0 = 无限等待 */
                      (OS_OPT)OS_OPT_PEND_BLOCKING,
                      (CPU_TS *)0, (OS_ERR *)&err);
        lcd_fill(6, 131, 233, 313, lcd_discolor[++task2_num % 11]);
    }
}
```

## 3. 任务内嵌消息队列：数据直达任务

同样的思路搬到消息队列上（教材 15 章）：每个任务的 TCB 里也内置了一个消息队列，**只能本任务 Pend，其他任务/中断可以 Post**。API 对应关系：

```c
/* 发送到指定任务的内嵌消息队列 */
void OSTaskQPost(OS_TCB *p_tcb, void *p_void, OS_MSG_SIZE msg_size,
                 OS_OPT opt, OS_ERR *p_err);

/* 获取本任务内嵌消息队列中的消息（只有本任务能调用） */
void *OSTaskQPend(OS_TICK timeout, OS_OPT opt,
                  OS_MSG_SIZE *p_msg_size, CPU_TS *p_ts, OS_ERR *p_err);

/* 清空本任务内嵌消息队列 */
OS_MSG_QTY OSTaskQFlush(OS_TCB *p_tcb, OS_ERR *p_err);
```

注意：`OSTaskQPend` 没有 p_tcb 参数——它隐含操作"当前任务自己"；而 Post 必须显式传目标 TCB。消息节点同样取自全局消息池（`OS_CFG_MSG_POOL_SIZE` 决定池子大小，每个 TCB 的内嵌队列 + 独立队列共用这个池）。教材 15.3 节实验与 13.3 几乎同构：task1 按键 `OSTaskQPost(&Task2Task_TCB, &key, sizeof(key), ...)`，task2 `OSTaskQPend` 收消息。

> 💡 选型口诀：**1 对 1 且收方明确 → 任务内嵌（快、省一个对象）；N 对 M、广播、或接收方不固定 → 独立队列（对象谁都能 pend）**。任务内嵌还有个隐藏好处：你不需要声明和维护队列对象，代码更干净。代价是没有"等待链表"——内嵌消息队列本质上只服务一个任务，多任务同时等同一批消息的场景它做不到。

## 4. 事件标志组：一堆 bit 的"与或"等待

事件标志是一个比特位：1 = 事件发生，0 = 未发生（教材 16.1 节）。多个事件标志装进一个**事件标志组**——结构体 `OS_FLAG_GRP` 的核心成员是 `OS_FLAGS Flags`，在 32 位 MCU 上就是一个 32 位无符号数，**每一位对应一个事件，一个组最多 32 个事件**：

```c
struct os_flag_grp    /* os.h，教材 16.1.2 节（简化版） */
{
    OS_OBJ_TYPE   Type;        /* 对象类型 OS_OBJ_TYPE_FLAG */
    CPU_CHAR     *NamePtr;     /* 名字 */
    OS_PEND_LIST  PendList;    /* 等待事件的任务链表 */
    OS_FLAGS      Flags;       /* 事件标志集合：32 个 bit */
};
```

三个核心 API（教材 16.2 节），使用需将 `OS_CFG_FLAG_EN` 配置为 1：

```c
void OSFlagCreate(OS_FLAG_GRP *p_grp, CPU_CHAR *p_name,
                  OS_FLAGS flags, OS_ERR *p_err);   /* flags = 初始值 */

/* 等待事件：返回实际等待到的标志值（任务/中断都能等） */
OS_FLAGS OSFlagPend(OS_FLAG_GRP *p_grp, OS_FLAGS flags, OS_TICK timeout,
                    OS_OPT opt, CPU_TS *p_ts, OS_ERR *p_err);

/* 设置/清除事件：返回更新后的事件标志值 */
OS_FLAGS OSFlagPost(OS_FLAG_GRP *p_grp, OS_FLAGS flags,
                    OS_OPT opt, OS_ERR *p_err);
```

`OSFlagPend` 的 opt 是精髓（教材 16.2 节源码注释）：

- **等待条件**：`OS_OPT_PEND_FLAG_SET_ALL`（所有指定位置 1 才唤醒，与）、`OS_OPT_PEND_FLAG_SET_ANY`（任意一个置 1 就唤醒，或）；对应还有 `CLR_ALL` / `CLR_ANY`（等待标志被清 0）。
- **消费模式**：组合 `OS_OPT_PEND_FLAG_CONSUME`——等待成功后自动把相关标志位清零（一次性事件）；不加则标志留着（电平型事件）。
- 再加 `OS_OPT_PEND_BLOCKING` / `OS_OPT_PEND_NON_BLOCKING` 决定没等到时挂不挂起。

教材 16.3 节实验：task1 按 KEY0 置位"事件 0"、按 KEY1 置位"事件 1"；task2 用 `SET_ALL | CONSUME | BLOCKING` 等两个事件**都**发生才刷屏；task3 每 10 tick 把 `flag.Flags` 实时显示到 LCD（任务间访问 LCD 记得放临界区）：

```c
#define FLAGBIT_0   ((OS_FLAGS)0x01)    /* 事件标志 0 */
#define FLAGBIT_1   ((OS_FLAGS)0x02)    /* 事件标志 1 */
#define FLAGBIT_ALL ((OS_FLAGS)(FLAGBIT_0 | FLAGBIT_1))

OS_FLAG_GRP flag;   /* 事件标志组对象 */

/* start_task：创建事件标志组，初始全 0 */
OSFlagCreate((OS_FLAG_GRP *)&flag, (CPU_CHAR *)"flag",
             (OS_FLAGS)0, (OS_ERR *)&err);

/* task1：按键置位对应事件 */
void task1(void *p_arg)
{
    OS_ERR err;
    uint8_t key;

    while (1)
    {
        key = key_scan(0);
        switch (key)
        {
            case KEY0_PRES:
                OSFlagPost((OS_FLAG_GRP *)&flag, (OS_FLAGS)FLAGBIT_0,
                           (OS_OPT)OS_OPT_POST_FLAG_SET, (OS_ERR *)&err);
                break;
            case KEY1_PRES:
                OSFlagPost((OS_FLAG_GRP *)&flag, (OS_FLAGS)FLAGBIT_1,
                           (OS_OPT)OS_OPT_POST_FLAG_SET, (OS_ERR *)&err);
                break;
        }
        OSTimeDly(10, OS_OPT_TIME_DLY, &err);
    }
}

/* task2：两个事件都发生才执行，执行后消费（清零） */
void task2(void *p_arg)
{
    OS_ERR err;

    while (1)
    {
        OSFlagPend((OS_FLAG_GRP *)&flag, (OS_FLAGS)FLAGBIT_ALL,
                   (OS_TICK)0,
                   (OS_OPT)(OS_OPT_PEND_FLAG_SET_ALL |   /* 与：全 1 */
                            OS_OPT_PEND_FLAG_CONSUME |   /* 消费：等待后清零 */
                            OS_OPT_PEND_BLOCKING),
                   (CPU_TS *)0, (OS_ERR *)&err);
        CPU_CRITICAL_ENTER();
        lcd_fill(6, 131, 233, 313, lcd_discolor[++task2_num % 11]);
        CPU_CRITICAL_EXIT();
    }
}
```

现象：只按 KEY0 或只按 KEY1，task2 不动；两个都按过，task2 刷新一次且标志被清零（再按一次 KEY0 不会重复触发）。把 `SET_ALL` 改成 `SET_ANY` 再试，逻辑立刻变成"任一个事件就唤醒"。

> ⚠️ 事件标志组的标志位是"公共资源"：任何一个任务 Post 都会改动整组的 32 位，消费模式（CONSUME）还会清零。多个任务各自用"不同 bit"互不干扰没问题；但如果两个任务等同一个 bit、又都开了 CONSUME，会出现"一个任务消费、另一个空等"的竞态。bit 位的分配要想清楚，别让两个任务共用同一个事件位做不同的事。

## 5. 对比 FreeRTOS：内嵌对象 vs 任务通知

| 维度 | µC/OS-III（本课） | FreeRTOS（已学） |
|------|------|------|
| 消息传输 | 传**指针**（OS_MSG 节点 + 全局消息池），消息大小不限 | 队列**拷贝定长项目**（Queue_t 自带存储区） |
| 1对1同步 | **任务内嵌信号量**（OSTaskSemPend/Post，TCB 内置） | **任务通知**（xTaskNotifyGive/ulTaskNotifyTake） |
| 1对1传数据 | **任务内嵌消息队列**（OSTaskQPend/Post） | 任务通知带值（xTaskNotify(xTaskGetCurrentTaskHandle(), val, eSetValueWithOverwrite)） |
| 语义清晰度 | 就是标准信号量/队列，语义与独立对象完全一致，无学习成本 | 32 位通知值可当计数/位掩码/带值/覆盖用，灵活但要在 4 种行为里选 |
| 适用场景 | 明确的任务间同步/传数据，1 对 1 | 同上；FreeRTOS 任务通知还能传位掩码（等价于轻量事件组） |
| 多事件同步 | 事件标志组 OSFlagPend（32 位，SET_ALL/ANY + CONSUME） | 事件组 xEventGroupWaitBits（24 位用户位，ALL/ANY + 清除） |

一句话：**UCOS 把"内嵌"做成了一等公民——每任务天生带信号量和消息队列，API 和独立对象同构，学一次用两处；FreeRTOS 把同样能力揉进任务通知的一个 32 位寄存器，更紧凑但需要你根据场景选行为**。对照 FreeRTOS 第 12 课（任务通知）你会发现：UCOS 的内嵌信号量 ≈ 通知值的"计数型"用法，内嵌消息队列 ≈ 通知值不够用时的升级版——只是 UCOS 把它拆成了两个清晰的 API 家族。

## 动手练习（约 45 分钟）

### 练习 15.1：消息队列实验（生产者-消费者）

- 1️⃣ 按教材 13.3 节搭最小版：start_task 里 `OSQCreate`（max_qty 取 5），task1 扫按键把键值 `OSQPost` 进队列，task2 `OSQPend` 收消息刷屏/打印。
- 2️⃣ 验证 LIFO 插队：把 task1 的 `OS_OPT_POST_FIFO` 改成 `OS_OPT_POST_LIFO`，连按 KEY0、KEY1、KEY2，观察 task2 收到的顺序——后发的先到。再想想：紧急消息插队该用哪种？
- 3️⃣ 加一个"消费者"：创建 task3 也 `OSQPend` 同一个队列，发一条消息观察谁被唤醒（提示：教材说按等待任务优先级挑，翻翻 13.1 节确认）。再查 `OS_CFG_MSG_POOL_SIZE` 当前值，把池子调小到 1 再连发消息，看会不会 `OS_ERR_Q_MAX` / 消息池耗尽。
- 4️⃣ 验收标准：能画出"消息节点从池里取、进队、出队、还回池"的数据流，并解释为什么 Post 的是 `&key` 的地址而 task2 打印 `*key`。

### 练习 15.2：事件标志同步多任务实验

- 1️⃣ 按教材 16.3 节搭事件标志实验：task1 按 KEY0 置 FLAGBIT_0、按 KEY1 置 FLAGBIT_1，task2 用 `SET_ALL | CONSUME | BLOCKING` 等待，task3 实时显示 `flag.Flags`。
- 2️⃣ 验证与/或差异：先只按 KEY0（task2 不动），再按 KEY1（task2 触发）；把 opt 改成 `OS_OPT_PEND_FLAG_SET_ANY`，重跑——任一个键都能触发。把 CONSUME 去掉再跑：触发后标志不清零，再次按键会怎样？
- 3️⃣ 对照 FreeRTOS 第 11 课（事件组）：在 FreeRTOS 分支工程里用 `xEventGroupSetBits` / `xEventGroupWaitBits` 复刻同一场景，比较两者的 API 形态和 CONSUME/清除选项的对应关系。
- 4️⃣ 验收标准：能写出两种"等待条件 × 是否消费"组合的完整行为表，并说出 UCOS 事件标志组最多容纳几个事件、为什么。

## 自测（答完再点答案）

### 随堂小测

Q1. OS_MSG 消息结构中 MsgPtr 成员的作用是？

- A. 存储消息数据的拷贝副本
- B. 指向消息内容的万能指针
- C. 记录消息在池中的编号
- D. 指向下一个等待任务

<details>
<summary>查看答案</summary>

B。MsgPtr 是 void* 万能指针，可指向任意数据甚至函数；消息传输只传指针不拷数据，收发双方要约定格式（PDF p.283）。

</details>

Q2. 任务内嵌信号量与独立信号量的最大区别是？

- A. 内嵌信号量不能用于中断
- B. 内嵌信号量内置于 TCB，只能本任务 Pend
- C. 内嵌信号量只能由创建它的任务使用
- D. 内嵌信号量的资源数固定为 1

<details>
<summary>查看答案</summary>

B。内嵌信号量分配在每个任务的 TCB 中，创建任务时即创建；只能被该任务获取，但可由其他任务/中断释放，效率更高（PDF p.314）。

</details>

Q3. OSFlagPend 加 OS_OPT_PEND_FLAG_CONSUME 的效果是？

- A. 事件标志组被删除后自动重建
- B. 等待超时后强制消费一次
- C. 等待成功后清零相关事件标志
- D. 唤醒所有等待同一事件的任务

<details>
<summary>查看答案</summary>

C。CONSUME（消费）使任务成功等到事件后自动清零相关标志位，把事件变成"一次性"；不加则标志保持置位（PDF p.369~370）。

</details>

Q4. µC/OS-III 事件标志组在 32 位 MCU 上最多容纳几个事件？

- A. 8 个，受 OS_FLAGS 低 8 位限制
- B. 16 个，高 16 位保留给内核
- C. 24 个，高 8 位用于控制
- D. 32 个，每一位对应一个事件

<details>
<summary>查看答案</summary>

D。OS_FLAGS 在 32 位 MCU 上是 32 位无符号数，Flags 的每一比特存储一个事件标志（PDF p.354）。FreeRTOS 事件组因高 8 位保留给控制只有 24 位用户位——又是一个差异点。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 13 章消息队列（PDF p.283~313）、第 14 章任务内嵌信号量（PDF p.314~333）、第 15 章任务内嵌消息队列（PDF p.334~353）、第 16 章事件标志（PDF p.354~392）——本课全部依据
- 🌐 [Weston Embedded µC/OS-III 官方资料](https://weston-embedded.com/uc-os-iii)——OS_MSG/OS_Q/OS_FLAG_GRP 官方结构与消息池源码
- 📕 [《µC/OS-III: The Real-Time Kernel》](https://weston-embedded.com/uc-os-iii)——第 12 章 Message Queues 与第 14 章 Event Flags 深入论述
- 🔁 对照：[FreeRTOS 课程第 8 课（队列）](/my-blog/posts/freertos/0008-queues/)、[第 11 课（事件组）](/my-blog/posts/freertos/0011-event-groups/)、[第 12 课（任务通知）](/my-blog/posts/freertos/0012-task-notifications/)——本课对比基准

## 下一步

通信全家桶到此齐了：信号量、互斥量、消息队列、任务内嵌双雄、事件标志。下一课预告：第 16 课——软件定时器、内存分区管理、时间戳，以及本课程的收官大戏：MiniOS vs µC/OS-III vs FreeRTOS 三内核总结。

| [← 上一课](/my-blog/posts/ucosiii/0014-semaphores-and-mutexes/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0016-timers-memory-and-summary/) |