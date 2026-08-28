---
title: 软件定时器、内存管理与三内核总结
published: 2026-08-28
description: 收官一课——软件定时器（定时器任务 + 回调）、固定分区内存管理、时间戳测时、时间管理 API 补课，最后交出 MiniOS vs µC/OS-III vs FreeRTOS 三内核对比总表与选型建议。
tags: [UCOSIII, 嵌入式, RTOS, 软件定时器, 内存管理, 时间戳]
category: UCOSIII
draft: false
prevTitle: ""
prevSlug: ""
nextTitle: 消息队列与事件标志
nextSlug: "ucosiii/0015-queues-and-event-flags"
---

# 软件定时器、内存管理与三内核总结

收官一课——补完定时/内存/计时三块拼图，然后让 MiniOS、µC/OS-III、FreeRTOS 三个内核同台接受检阅。**本课目标：**这是 16 课长跑的终点（教材第 17~19 章，(PDF p.394~460)）。学完你能：① 用 `OSTmrCreate/OSTmrStart/OSTmrStop` 玩转单次/周期软件定时器，并说清"定时器任务 + 回调"的机制；② 用 `OSMemCreate/OSMemGet/OSMemPut` 管理固定大小内存分区，明白它和 FreeRTOS heap_4 是两种哲学；③ 用 `OS_TS_GET()` 给任意代码段测时；④ 补齐 `OSTimeDly/OSTimeDlyHMSM/OSTimeDlyResume` 时间管理 API；⑤ ⭐ 最终交出三内核对比总表与选型建议——这是你学完两个课程、手写过内核之后的毕业答辩。

## 1. 软件定时器：给周期动作找个专职保姆（第 17 章，(PDF p.394)）

硬件定时器是外设资源，数量有限、还要配置中断；软件定时器则是**纯软件实现的向下计数器**——每过一个系统时钟节拍计数值减一，减到 0 就自动调用你注册的**超时回调函数**（教材 17.1.1 节）。它不占任何硬件定时器，想建多少建多少，代价是精度受系统节拍限制。

软件定时器的控制块 `OS_TMR` 定义在 os.h，核心成员就这几个（教材 17.1.1 节）：

```c
struct os_tmr
{
    OS_OBJ_TYPE            Type;          /* 对象类型：OS_OBJ_TYPE_TMR */
    CPU_CHAR              *NamePtr;       /* 定时器名字（调试用） */
    OS_TMR_CALLBACK_PTR    CallbackPtr;   /* 超时回调函数指针 */
    void                  *CallbackPtrArg;/* 回调函数参数 */
    OS_TMR                *NextPtr;       /* 定时器链表：下一个 */
    OS_TMR                *PrevPtr;       /* 定时器链表：上一个 */
    OS_TICK                Remain;        /* 剩余超时时间（每 tick 减一） */
    OS_TICK                Dly;           /* 开启延时时间 */
    OS_TICK                Period;        /* 周期（仅周期定时器用） */
    OS_OPT                 Opt;           /* 单次 or 周期 */
    OS_STATE               State;         /* 四种状态之一 */
};
```

### 1.1 单次与周期，四种状态

`OS_OPT_TMR_ONE_SHOT` 是**单次定时器**：超时一次就停，想再来一次必须重新 `OSTmrStart`；`OS_OPT_TMR_PERIODIC` 是**周期定时器**：超时后自动按 Period 重启，直到你喊停（教材 17.1.3 节）。定时器共有**未使用 / 停止 / 运行 / 完成**四种状态：创建前是未使用态，创建后停在停止态，Start 后进运行态，单次定时器超时后进完成态（教材 17.1.4 节）。

### 1.2 定时器任务：谁在背后干活

软件定时器的"保姆"是一个**专职内核任务 `OS_TmrTask`**（教材 17.1.5 节）：它在 `OSInit()` 时由 `OS_TmrInit()` 创建，优先级与栈大小在 os_cfg_app.h 里配置（`OSCfg_TmrTaskPrio`、`OSCfg_TmrTaskStkSize`）。它按 `OSCfg_TmrTaskRate_Hz` 的频率醒来，遍历定时器链表给每个 `Remain` 减计数，减到 0 就执行回调。由于系统节拍和定时器任务频率不一定相同，内核用系数 `OSTmrToTicksMult = OSCfg_TickRate_Hz / OSCfg_TmrTaskRate_Hz` 把 dly/period 换算成节拍数。

> ⚠️ 回调函数铁律：超时回调运行在**软件定时器任务**的上下文中，所以绝对不能在回调里调用任何会让任务阻塞、挂起或删除的函数——`OSTimeDly()`、`OSTimeDlyHMSM()`、`OSxxxPend()` 全都不行（教材 17.1.2 节）。回调应该"短平快"：翻个 LED、置个标志、Post 个信号量，把重活交给普通任务。多任务共用一个回调时，用 `p_tmr` 参数区分是谁超时了。

### 1.3 API 全家桶

| 函数 | 作用 |
|------|------|
| `OSTmrCreate()` | 创建软件定时器（需 `OS_CFG_TMR_EN` 置 1） |
| `OSTmrStart()` | 开启/重新开启定时 |
| `OSTmrStop()` | 停止定时（opt 可带"停止时顺便执行一次回调"） |
| `OSTmrDel()` | 删除定时器（需 `OS_CFG_TMR_DEL_EN`） |
| `OSTmrRemainGet()` | 查询剩余超时时间 |
| `OSTmrStateGet()` | 查询当前状态 |
| `OSTmrSet()` | 修改延时/周期/回调函数及参数 |

```c
/* 三个核心 API 原型（os_tmr.c，教材 17.2 节） */

void OSTmrCreate(OS_TMR *p_tmr, CPU_CHAR *p_name,
                 OS_TICK dly, OS_TICK period, OS_OPT opt,
                 OS_TMR_CALLBACK_PTR p_callback, void *p_callback_arg,
                 OS_ERR *p_err);
/*  opt: OS_OPT_TMR_ONE_SHOT（单次）或 OS_OPT_TMR_PERIODIC（周期） */

CPU_BOOLEAN OSTmrStart(OS_TMR *p_tmr, OS_ERR *p_err);

CPU_BOOLEAN OSTmrStop(OS_TMR *p_tmr, OS_OPT opt,
                      void *p_callback_arg, OS_ERR *p_err);
/*  opt: OS_OPT_TMR_NONE（仅停止）/
 *       OS_OPT_TMR_CALLBACK（停止时执行回调）/
 *       OS_OPT_TMR_CALLBACK_ARG（停止时执行回调并换参数） */
```

### 1.4 实验 17.3：按键启停两个定时器

教材 17.3 节实验设计了两个定时器共用一个回调：**Timer1 单次（dly=10）**、**Timer2 周期（period=10）**，task1 扫按键——KEY0 同时启动两个定时器，KEY1 同时停止。按下 KEY0 后：Timer2 周期性地刷新 LCD 区域并计数，而 Timer1 只刷一次就停；再按 KEY0 才重新触发 Timer1。现象对比一目了然：**一个"响一次"，一个"一直响"**。

```c
OS_TMR Timer1;   /* 单次定时器 */
OS_TMR Timer2;   /* 周期定时器 */

/* 超时回调：两个定时器共用，用 p_tmr 区分是谁超时 */
void timer_cb(void *p_tmr, void *p_arg)
{
    static uint32_t timer1_num = 0;
    static uint32_t timer2_num = 0;

    if (p_tmr == &Timer1)
    {
        lcd_fill(6, 131, 114, 313, lcd_discolor[++timer1_num % 11]);
    }
    else if (p_tmr == &Timer2)
    {
        lcd_fill(126, 131, 233, 313, lcd_discolor[++timer2_num % 11]);
    }
}

/* start_task 中创建两个定时器 */
void start_task(void *p_arg)
{
    OS_ERR err;

    /* 单次定时器：dly=10，period=0 */
    OSTmrCreate((OS_TMR *)&Timer1, (CPU_CHAR *)"Timer1",
                (OS_TICK)10, (OS_TICK)0,
                (OS_OPT)OS_OPT_TMR_ONE_SHOT,
                (OS_TMR_CALLBACK_PTR)timer_cb, (void *)0, (OS_ERR *)&err);

    /* 周期定时器：dly=0，period=10，超时后自动重启 */
    OSTmrCreate((OS_TMR *)&Timer2, (CPU_CHAR *)"Timer2",
                (OS_TICK)0, (OS_TICK)10,
                (OS_OPT)OS_OPT_TMR_PERIODIC,
                (OS_TMR_CALLBACK_PTR)timer_cb, (void *)0, (OS_ERR *)&err);

    /* ……创建 task1、删除 start_task 等，见第 13 课模板 */
}

/* task1：KEY0 启动，KEY1 停止 */
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
                OSTmrStart(&Timer1, &err);
                OSTmrStart(&Timer2, &err);
                break;
            case KEY1_PRES:
                OSTmrStop(&Timer1, OS_OPT_TMR_NONE, (void *)0, &err);
                OSTmrStop(&Timer2, OS_OPT_TMR_NONE, (void *)0, &err);
                break;
            default:
                break;
        }
        OSTimeDly(10, OS_OPT_TIME_DLY, &err);
    }
}
```

> 💡 对照 FreeRTOS 第 10 课：FreeRTOS 的软件定时器由"定时器服务守护任务"（Timer Service Daemon）统一处理，回调同样不能阻塞；差别在于 FreeRTOS 的守护任务优先级默认为空闲任务+1，且定时器命令经队列投递，而 UCOS 的 `OS_TmrTask` 是独立配置优先级/频率的内核任务、定时器直接挂在链表上。另一句大实话：**软件定时器回调 ≈ 超级轻量的"伪任务"**——适合周期翻灯、按键消抖后的超时判定、心跳喂狗这类小动作，不适合大运算。

## 2. 内存管理：固定分区，向碎片说不（第 19 章，(PDF p.445)）

C 标准库的 `malloc()/free()` 随手就用，但教材 19.1 节直言：**嵌入式 RTOS 里一般不推荐用它**。原因就俩字——碎片：频繁申请/释放不同大小的内存，堆里会留下大量"单个很小、地址不连续"的空洞，最终明明空闲内存还很多，却再也申请不出一个大块。而且 malloc 内部可能持锁，实时性不可控。

µC/OS-III 的答案是**内存分区（Partition）**：把一块大内存切成**大小完全相同**的若干个内存块，申请就是"取一块"，释放就是"还一块"——**块大小固定，永远不会产生碎片**。可以创建多个分区，每个分区的块数量和块大小都自己定：小消息用小块分区，大帧用大块分区，各取所需。

### 2.1 空闲块链表：不点名的"内存账本"

分区控制块 `OS_MEM`（os.h，教材 19.1 节）的核心是 `FreeListPtr`——一条**空闲块链表**。创建分区时，内核把每个块的**起始 4 字节当指针**指向下一个空闲块，串成单向链表；`OSMemGet` 摘表头、`OSMemPut` 插表头，全程只动指针不动数据，快得离谱：

```c
struct os_mem
{
    OS_OBJ_TYPE   Type;          /* 对象类型：OS_OBJ_TYPE_MEM */
    CPU_CHAR     *NamePtr;       /* 分区名字 */
    void         *AddrPtr;       /* 内存区起始地址 */
    void         *FreeListPtr;   /* 空闲块链表头 */
    OS_MEM_SIZE   BlkSize;       /* 单个内存块大小（字节） */
    OS_MEM_QTY    NbrMax;        /* 内存块总数 */
    OS_MEM_QTY    NbrFree;       /* 当前空闲块数量 */
};
```

### 2.2 三个 API，两行账

```c
/* 创建分区：p_addr 指向内存区，n_blks 块 × blk_size 字节 */
/* 注意：n_blks >= 2，blk_size >= sizeof(void*)，且按 4 字节对齐 */
void OSMemCreate(OS_MEM *p_mem, CPU_CHAR *p_name,
                 void *p_addr, OS_MEM_QTY n_blks,
                 OS_MEM_SIZE blk_size, OS_ERR *p_err);

/* 申请一块：返回块地址；无空闲块返回 NULL + OS_ERR_MEM_NO_FREE_BLKS */
void *OSMemGet(OS_MEM *p_mem, OS_ERR *p_err);

/* 释放一块：插回空闲链表；全部归还时报 OS_ERR_MEM_FULL */
void OSMemPut(OS_MEM *p_mem, void *p_blk, OS_ERR *p_err);
```

> 💡 哲学对照：**内存分区 vs FreeRTOS heap_4**——这是两套完全相反的设计。UCOS 分区是"**预留式**"：提前把内存切成固定大小块，无碎片、O(1) 申请、确定性强，但块大小按"最大需求"定，小请求也占一整块，可能浪费；FreeRTOS heap_4 是"**按需式**"：首次适配 + 合并空闲块，内存利用率高，但会产生碎片、执行时间不确定。哪个更好？看场景——数据报文固定长度、对实时性苛刻就选分区；请求大小差异大、RAM 紧张就选 heap_4。你的 MiniOS 第三方案是"静态数组直分"，最简单也最省心（本课练习 2 会让你真机对比）。

### 2.3 实验 19.3：申请、写、释放，一气呵成

教材 19.3 节实验：start_task 里把一块静态二维数组建成 5×32 字节的分区，task1 按 KEY0 申请一块内存、把块地址写进去再读出来显示（验证读写正常），按 KEY1 释放回分区。LCD 上的空闲块数会跟着 5 → 4 → 5 跳动，这就是分区管理的完整生命周期：

```c
OS_MEM mem;                                  /* 内存分区控制块 */
#define MEM_BLOCK_CNT   5                     /* 5 个内存块 */
#define MEM_BLOCK_SIZE  32                    /* 每块 32 字节 */
uint8_t memory[MEM_BLOCK_CNT][MEM_BLOCK_SIZE];/* 内存区实体：静态二维数组 */

/* start_task 中创建分区 */
OSMemCreate((OS_MEM *)&mem, (CPU_CHAR *)"mem",
            (void *)memory,
            (OS_MEM_QTY)MEM_BLOCK_CNT,
            (OS_MEM_SIZE)MEM_BLOCK_SIZE,
            (OS_ERR *)&err);

/* task1：KEY0 申请并测试读写，KEY1 释放 */
void task1(void *p_arg)
{
    OS_ERR err;
    uint8_t key;
    uint8_t *buf = NULL;

    while (1)
    {
        key = key_scan(0);
        switch (key)
        {
            case KEY0_PRES:                            /* 申请一块 */
                buf = OSMemGet((OS_MEM *)&mem, (OS_ERR *)&err);
                if (buf != NULL)
                {
                    sprintf((char *)buf, "0x%p", buf); /* 写入 */
                    lcd_show_string(158, 160, 200, 16, 16, (char *)buf, BLUE);
                }
                else
                {
                    lcd_show_string(158, 160, 200, 16, 16, "Failed!", RED);
                }
                break;
            case KEY1_PRES:                            /* 释放回分区 */
                if (buf != NULL)
                {
                    OSMemPut((OS_MEM *)&mem, (void *)buf, (OS_ERR *)&err);
                    buf = NULL;
                }
                break;
            default:
                break;
        }
        OSTimeDly(10, OS_OPT_TIME_DLY, &err);
    }
}
```

> ⚠️ 分区不是万能药：① 块大小按"该类数据最大情况"定，写超 `blk_size` 就是内存踩踏，编译器不会帮你查；② `OSMemPut` 必须还回**同一个分区**，别把 A 分区的块塞回 B 分区；③ 块被申请期间内容归你管，还回去后内核只清链表头指针、不清数据——敏感数据记得自己擦。分区的正确用法是"一类固定长度的数据配一个分区"。

## 3. 时间戳：用 CPU 周期给代码计时（第 18 章，(PDF p.437)）

想知道一段代码跑了多久？时间戳就是干这个的（教材 18.1 节）：**时间戳本质就是一个单调递增的"时钟读数"**，代码前取一个、代码后取一个，两个读数之差就是耗时——无需关心读数本身的绝对含义。

µC/OS-III 的时基来自 Cortex-M 内核自带的 **DWT 外设的 CYCCNT 寄存器**：一个 32 位向上计数器，**内核每走一个时钟就加一**，在探索者的 168MHz 主频下精度轻松到纳秒级（教材 18.1.1 节）。所以 `OS_TS_GET()` 读到的不是"时间"，而是"CPU 周期数"。

### 3.1 配置与初始化

- cpu_cfg.h 配置时基：`CPU_CFG_TS_32_EN` 置 `DEF_ENABLED`、`CPU_CFG_TS_TMR_SIZE` 置 `CPU_WORD_SIZE_32`（教材 18.1.2 节）。
- os_cfg.h 配置内核：`OS_CFG_TS_EN` 置 1（很多 API 的时间戳参数依赖它）。
- 初始化：start_task 里先调 `CPU_Init()`，它内部会走 `CPU_TS_TmrInit()` 使能 DWT 跟踪系统、清零并启动 CYCCNT（教材 18.1.3 节，bsp_cpu.c）。

### 3.2 两个 API，一个宏

```c
/* 获取时间戳：本质上读 DWT->CYCCNT */
#define OS_TS_GET()  (CPU_TS)CPU_TS_TmrRd()

/* 把时间戳差值换算成微秒（用主频除一下） */
CPU_INT64U CPU_TS32_to_uSec(CPU_TS32 ts_cnts);
```

### 3.3 实验 18.3：给 LCD 刷屏计时

教材 18.3 节实验：按 KEY0 时，在 `lcd_fill` 前后各取一次时间戳，差值换算成微秒显示在 LCD 上。同样的套路可以套在任何代码段上——这是 RTOS 世界里最朴素的性能分析工具：

```c
/* 用时间戳测量 LCD 刷屏耗时（教材 18.3 节） */
void task1(void *p_arg)
{
    OS_ERR err;
    uint8_t key;
    CPU_TS_TMR start_ts, end_ts, delta_ts;
    CPU_INT64U delta_us;
    uint32_t task1_num = 0;

    while (1)
    {
        key = key_scan(0);
        if (key == KEY0_PRES)
        {
            start_ts = OS_TS_GET();                 /* 起点时间戳 */
            lcd_fill(6, 131, 233, 313, lcd_discolor[++task1_num % 11]);
            end_ts = OS_TS_GET();                   /* 终点时间戳 */
            delta_ts = end_ts - start_ts;           /* 差值 = 耗时（周期数） */
            delta_us = CPU_TS32_to_uSec(delta_ts);  /* 周期数 -> 微秒 */
            printf("LCD fill: %u us\r\n", (unsigned)delta_us);
        }
        OSTimeDly(10, OS_OPT_TIME_DLY, &err);
    }
}
```

顺带一提：UCOS 内核自己也大量用时间戳——消息发送时刻 `MsgTS`、进入临界区的耗时、任务启动时刻 `CyclesStart`……这些字段在 os.h 里随处可见，全都是同一个 `OS_TS_GET()` 供出来的。它同时也是[第 15 课](/my-blog/posts/ucosiii/0015-queues-and-event-flags/)那些 `p_ts` 参数背后的硬件依赖——这也是教材移植章节反复叮嘱"先配好时间戳"的原因。

## 4. 时间管理 API 补课：延时三兄弟（第 10 章，(PDF p.186)）

前面所有实验都用了 `OSTimeDly`，这节把时间管理 API 一次补齐（教材 10.2 节）。它们的本质在第 10 课讲过：**把当前任务挂到 Tick 延时链表上并指定超时时间，时间到了由 SysTick 唤醒**——你在 MiniOS 第 4 步亲手实现过一模一样的机制。

```c
/* 1. 按系统节拍延时：dly 个 tick */
void OSTimeDly(OS_TICK dly, OS_OPT opt, OS_ERR *p_err);
/*  opt 常用值：
 *   OS_OPT_TIME_DLY      延时到"当前节拍数 + dly"（相对延时）
 *   OS_OPT_TIME_PERIODIC 按固定周期运行（相对上次唤醒时刻，防漂移） */

/* 2. 按 时:分:秒:毫秒 延时（内部换算成 tick 后同 OSTimeDly） */
void OSTimeDlyHMSM(CPU_INT16U hours, CPU_INT16U minutes,
                   CPU_INT16U seconds, CPU_INT32U milli,
                   OS_OPT opt, OS_ERR *p_err);

/* 3. 强行唤醒正在延时的任务（需 OS_CFG_TIME_DLY_RESUME_EN 置 1） */
void OSTimeDlyResume(OS_TCB *p_tcb, OS_ERR *p_err);
```

| 维度 | µC/OS-III | FreeRTOS（已学） |
|------|------|------|
| 相对延时（tick） | `OSTimeDly(dly, OS_OPT_TIME_DLY, &err)` | `vTaskDelay(ticks)` |
| 绝对/周期延时（防漂移） | `OSTimeDly(dly, OS_OPT_TIME_PERIODIC, &err)` | `vTaskDelayUntil(&xLastWakeTime, xFrequency)` |
| 时分秒毫秒延时 | `OSTimeDlyHMSM(时,分,秒,毫秒, opt, &err)` | 无，需自行换算成 tick |
| 提前唤醒 | `OSTimeDlyResume(&TaskTCB, &err)` | `vTaskAbortDelay()` |
| 与软件定时器的分工 | 延时=当前任务"睡觉"；定时器=别的任务"到点干活"，互不阻塞 | 同左 |

> 💡 选型提醒：需要"固定周期刷屏/采样"时优先 `OS_OPT_TIME_PERIODIC`——它基于上次唤醒时刻累加，不会因为中途被高优先级任务打断而逐渐漂移，等价于 FreeRTOS 的 `vTaskDelayUntil`（FreeRTOS 课第 14 课有专章）。

## 5. ⭐ 三内核总结：16 课的毕业答辩

从第 1 课的"为什么学第二个内核"，到第 12 课的架构验收，再到本课的收官——现在你有资格回答最初的问题了。**三个内核，三份对同一问题的答卷**：

| 维度 | MiniOS（手写） | µC/OS-III | FreeRTOS |
|------|------|------|------|
| 就绪表算法 | 位图 OSRdyGrp/OSRdyTbl，查表 O(1) | 位图 + 同优先级链表，O(1) | 纯链表，遍历 O(1)~O(n) |
| 调度点 | 任务主动让出 + tick（PendSV） | OSSched 内联 + 中断退出 OSIntExit | 任务让出 + tick + 中断退出（PendSV） |
| 临界区策略 | 关中断（PRIMASK/BASEPRI） | 锁调度器为主 + BASEPRI，关中断极短 | 关中断为主 + 挂起调度器 |
| 同步原语 | 信号量（1 个） | 信号量/互斥量/队列/事件标志/任务内嵌信号量+队列（全家桶） | 队列/信号量/互斥量/事件组/任务通知 |
| 内存管理 | 静态分配，无动态内存 | 内存分区：固定大小块，零碎片 | heap_4 动态堆：首次适配+合并，有碎片风险 |
| 代码量（同功能内核） | 几百行 / 约 2~4 KB ROM | 约 15~25 KB ROM（全功能三件套数万行） | 约 10~15 KB ROM（约一万行） |
| 适用场景 | 教学、极简可控的裸机升级 | 教学经典、工业认证、要求确定性内存 | 量产主流、生态大、上手快 |

**选型建议（一条直线）**：学内核原理、想彻底搞懂调度与切换 → 看 MiniOS（它就是你自己的）；做产品、追求实时确定性与丰富同步原语 → µC/OS-III（位图 O(1) 调度 + 零碎片内存分区 + 全套内核对象）；要社区生态、快速迭代、人好招 → FreeRTOS（普及率就是最大的生产力）。没有最好的内核，只有最合适的问题——而你现在三个都摸过、其中一个还亲手写过，这个选择题对你已经是送分题。

## 动手练习（约 60~90 分钟）

### 练习 16.1：软件定时器 + 时间戳联合作战

- 1️⃣ 按教材 17.3 节搭最小实验：Timer1 单次（dly=20）、Timer2 周期（period=10），共用回调在 LCD 上计数；KEY0 启动、KEY1 停止。验收：Timer2 每 10 个定时器 tick 刷一次且计数递增，Timer1 只刷一次。
- 2️⃣ 把 Timer1 的 `OS_OPT_TMR_ONE_SHOT` 改成 `OS_OPT_TMR_PERIODIC`，观察行为差异；再把 `OSCfg_TmrTaskRate_Hz` 调成系统节拍的一半，观察周期实际变化（提示：回顾 `OSTmrToTicksMult` 换算系数）。
- 3️⃣ 在回调里故意调用一次 `OSTimeDly(1, ...)`，编译运行观察后果（教材 17.1.2 节明令禁止的行为），写 2 行现象笔记——这个坑踩一次就记住了。
- 4️⃣ 按教材 18.3 节给 `lcd_fill` 计时：记录刷全屏耗时（微秒），再分别测 `OSMemGet` 和 `OSMemPut` 的单次耗时——用时间戳验证"分区申请是 O(1) 的"。验收标准：能解释时间戳为什么是"周期数"而不是"秒"。

### 练习 16.2：内存分区实验 + 三内核选型论证

- 1️⃣ 按教材 19.3 节搭内存分区实验：KEY0 申请并读写验证、KEY1 释放，LCD 显示空闲块数 5 → 4 → 5。把 `MEM_BLOCK_CNT` 改成 2 再连续按 KEY0，验证申请失败返回 NULL 的路径（`OS_ERR_MEM_NO_FREE_BLKS`）。
- 2️⃣ 对照实验（FreeRTOS 分支）：用 heap_4 的 `pvPortMalloc/pvPortFree` 复刻"申请-释放-申请"循环，交替申请 8/32/128 字节，观察 xPortGetFreeHeapSize 的变化；再用 UCOS 分区做同样模式，比较碎片情况。写 3 行结论：两种策略各自的浪费点在哪。
- 3️⃣ 毕业题：基于本课总结表，给一个"智能家居网关"（需要 8 个任务、固定长度报文通信、7×24 运行、功耗敏感）写一段选型论证（100 字内），从就绪表、内存管理、生态三方面给出结论。

## 自测（答完再点答案）

### 随堂小测

Q1. 软件定时器超时后，其超时回调函数由谁执行？

- A. SysTick 中断服务函数中执行
- B. 软件定时器任务 OS_TmrTask 中执行
- C. 创建该定时器的普通任务中执行
- D. 空闲任务空闲时再执行

<details>
<summary>查看答案</summary>

B。软件定时器任务（OS_TmrTask）维护定时器链表、递减计数并在超时时调用回调，所以回调里绝不能调用 OSTimeDly/OSxxxPend 等阻塞函数（PDF p.396~404）。

</details>

Q2. 单次定时器超时一次之后，处于什么状态？

- A. 停止态，并自动 OSTmrStart 重启
- B. 完成态，需手动 OSTmrStart 重启
- C. 未使用态，需重新 OSTmrCreate
- D. 运行态，按 Period 继续计时

<details>
<summary>查看答案</summary>

B。单次定时器超时后进入完成态并停止，不会自动重启；再次定时需调用 OSTmrStart()。周期定时器才会超时后自动重启（PDF p.396）。

</details>

Q3. µC/OS-III 内存分区相对 malloc/free 的核心优势是？

- A. 可以申请任意大小的内存块
- B. 释放内存时自动整理合并
- C. 固定大小块，完全无内存碎片
- D. 申请速度慢但内存利用率高

<details>
<summary>查看答案</summary>

C。分区内所有块大小固定，申请/释放只是摘/插空闲链表头，无碎片且 O(1)；代价是块大小按最大需求预留，可能浪费。这与 FreeRTOS heap_4 动态堆是相反哲学（PDF p.445）。

</details>

Q4. 在探索者（STM32F407）上，OS_TS_GET() 实际读取的是什么？

- A. SysTick 的当前计数值
- B. DWT 外设的 CYCCNT 寄存器
- C. RTC 实时时钟的时间值
- D. 定时器 TIM2 的计数值

<details>
<summary>查看答案</summary>

B。OS_TS_GET() 展开为 CPU_TS_TmrRd()，读取 DWT->CYCCNT——每内核时钟加一的 32 位计数器，差值即 CPU 周期数，可用 CPU_TS32_to_uSec() 转微秒（PDF p.437~440）。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 17 章软件定时器（PDF p.394~435）、第 18 章时间戳（PDF p.437~443）、第 19 章内存管理（PDF p.445~460）——本课全部依据
- 📖 教材第 10.2 节任务延时相关函数（PDF p.186~193）——OSTimeDly 三兄弟源码
- 🔁 对照：[FreeRTOS 课程第 10 课（软件定时器）](/my-blog/posts/freertos/0010-software-timers/)、[第 14 课（时间管理）](/my-blog/posts/freertos/0014-time-management/)、[第 15 课（内存管理）](/my-blog/posts/freertos/0015-memory-management/)——本课对比基准
- ⭐ 回顾：[本课程第 12 课：MiniOS⑥三内核验收对比](/my-blog/posts/ucosiii/0012-minios-6-kernel-review/)——MAP 文件实测数据可与本课总结表互相印证
- 🌐 [Weston Embedded µC/OS-III 官方资料](https://weston-embedded.com/uc-os-iii)——OS_TMR/OS_MEM/CPU_TS 官方结构与移植源码

## 下一步

恭喜，16 课全部完成！你手里现在有三样东西：一张看懂 RTOS 内核的完整地图、一个亲手写的 MiniOS、以及 µC/OS-III 全家桶的实战经验。别让笔记吃灰——把第 12 课的 MAP 实测表和本课的选型论证整理进你的课程记录，那会是你将来面试/答辩时最硬的谈资。有任何不清楚的地方，随时问我（Agent 就是你的老师）。

| [← 上一课](/my-blog/posts/ucosiii/0015-queues-and-event-flags/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | — |