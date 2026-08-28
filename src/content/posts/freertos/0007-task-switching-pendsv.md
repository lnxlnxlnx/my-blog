---
title: 任务切换原理：PendSV
published: 2026-08-18
description: FreeRTOS 系列课程第 7 课：为什么任务切换必须放在 PendSV、xPortPendSVHandler 逐段汇编拆解（保存现场/选任务/恢复现场）、vTaskSwitchContext 与最高优先级选择算法（位图 + CLZ）、PendSV 三种触发场景与时间片调度实验。
tags: [FreeRTOS, 嵌入式, RTOS, 任务切换, PendSV, 调度, 时间片]
category: FreeRTOS
draft: false
prevTitle: 队列
prevSlug: "freertos/0008-queues"
nextTitle: 系统启动流程源码解析
nextSlug: "freertos/0006-scheduler-startup"
---

# 任务切换原理（PendSV）

这是 FreeRTOS 系列课程笔记的第 7 课：PendSV 异常、xPortPendSVHandler 逐段汇编、选任务算法与时间片调度。**本课目标：**上一课我们学会了"怎么跑起第一个任务"，这一课解决"怎么从一个任务切到另一个任务"（教材第 9 章，PDF p.168~182）。学完你能回答三个问题：为什么任务切换必须放在 PendSV 里、`xPortPendSVHandler()` 每一行汇编在干什么、`vTaskSwitchContext()` 凭什么总能选到最高优先级任务。最后用时间片实验亲眼看到切换。

## 1. PendSV 异常：为什么任务切换必须用它

PendSV（Pended Service Call，可挂起服务调用）是 Cortex-M 内核自带的一个系统异常。两个关键特性（PDF p.168）：

- **可编程优先级**：优先级由用户配置，FreeRTOS 把它设为**最低优先级**。
- **可挂起（pend）**：把 ICSR 寄存器的 PENDSVSET 位（bit 28）置 1 即可挂起它。它与 SVC 不同——**PendSV 是"非实时"的**：即使在高优先级中断里被挂起，也要等所有更高优先级中断处理完才真正执行。

为什么 RTOS 需要这种"拖延症"？设想直接在 SysTick 中断里做上下文切换（早期 RTOS 的做法），会踩两个坑（PDF p.168~169）：

1. **中断被延迟**：如果某个 IRQ 恰好在 SysTick 之前产生，SysTick 会抢占它，导致这个中断被推迟——实时系统不允许。
2. **用法错误异常**：SysTick 切完任务准备返回线程模式时，如果还有中断在挂起，Cortex-M 不允许此时返回线程模式，会触发 Usage Fault。

PendSV 把这两个问题一起解决：**把"切换动作"从 SysTick 里挪出来，挂起到 PendSV 中执行**。SysTick 只负责"判断要不要切"（`xTaskIncrementTick()`），要切就置 PendSV 挂起位；PendSV 因为优先级最低，会等所有中断（包括 SysTick 自己）都处理完才运行，然后在里面干净利落地完成切换。这就是 FreeRTOS 的切换模型：

| 触发源 | 做什么 | 切换发生在哪 |
|------|------|------|
| SysTick 节拍中断 | 更新 tick、检查是否要切换 | 挂起 PendSV，切到 PendSV 里做 |
| 更高优先级中断（如串口） | 调用 FromISR API 唤醒任务 | 中断退出后由 PendSV 完成切换 |
| 任务主动让出（阻塞、yield） | 调 portYIELD() 挂起 PendSV | 同样在 PendSV 里切 |

> 💡 一句话记忆：SysTick 是"裁判员"（决定要不要换人），PendSV 是"换人区"（真正完成交接）。裁判吹哨可以随时吹，但换人必须等全场（所有中断）停下来。

## 2. xPortPendSVHandler()：逐段拆解切换汇编

任务切换在 PendSV 的中断服务函数 `xPortPendSVHandler()` 里完成（port.c）。以你的 STM32F407（CM4F 内核）对应版本为例，完整汇编如下（PDF p.171，修正了原文的个别笔误）：

```c
__asm void xPortPendSVHandler( void )
{
    extern uxCriticalNesting;
    extern pxCurrentTCB;
    extern vTaskSwitchContext;

    PRESERVE8

    /* ① 保存当前任务的现场 */
    mrs r0, psp                  /* r0 = 当前运行任务的 PSP（任务栈指针） */
    isb

    ldr r3, =pxCurrentTCB        /* r3 = pxCurrentTCB 变量地址 */
    ldr r2, [ r3 ]               /* r2 = 当前任务 TCB 首地址 */

    /* 判断任务是否用了浮点单元：EXC_RETURN 的 bit4 为 0 表示用了 FPU */
    tst r14, #0x10               /* 测试 EXC_RETURN 的 bit4 */
    it eq
    vstmdbeq r0!, { s16 - s31 }  /* 用了 FPU：把高位浮点寄存器压进任务栈 */

    /* 硬件不会自动保存 R4~R11（以及 R14=EXC_RETURN），手动压栈 */
    stmdb r0!, { r4 - r11, r14 } /* 压入任务栈 */
    str r0, [ r2 ]               /* 更新 TCB->pxTopOfStack = 新栈顶 */

    /* ② 选下一个任务（此处要用 MSP，先把手头的寄存器暂存起来） */
    stmdb sp!, { r0, r3 }        /* 把 r0、r3 压进系统栈（MSP） */
    mov r0, #configMAX_SYSCALL_INTERRUPT_PRIORITY
    msr basepri, r0              /* 屏蔽受 FreeRTOS 管理的中断 */
    dsb
    isb
    bl vTaskSwitchContext        /* 更新 pxCurrentTCB 指向最高优先级就绪任务 */
    mov r0, #0
    msr basepri, r0              /* 恢复中断 */
    ldmia sp!, { r0, r3 }        /* 从 MSP 取回 r0、r3 */

    /* ③ 恢复下一个任务的现场 */
    ldr r1, [ r3 ]               /* r1 = 新任务 TCB 地址（pxCurrentTCB 已更新） */
    ldr r0, [ r1 ]               /* r0 = 新任务栈顶 */
    ldmia r0!, { r4 - r11, r14 } /* 出栈 R4~R11 和 EXC_RETURN */

    tst r14, #0x10               /* 新任务用了 FPU 吗？ */
    it eq
    vldmiaeq r0!, { s16 - s31 }  /* 用了：恢复高位浮点寄存器 */

    msr psp, r0                  /* PSP 指向新任务栈 */
    isb

    bx r14                       /* 异常返回：硬件自动出栈剩余寄存器，进入新任务 */
}
```

逐段理解：

**① 保存现场（mrs psp → stmdb）**：进入 PendSV 时，硬件已经把 R0~R3、R12、LR、PC、xPSR 自动压进了当前任务栈（中断入栈用的正是任务栈），所以 PendSV 里只需手动保存 R4~R11——这就是为什么切换汇编里"只有"这几个寄存器。CM4F 版本多两件事：`tst r14,#0x10` 检查进入中断前的任务是否用了 FPU（EXC_RETURN bit4=0 即用了），用了就把 s16~s31 也压栈；同时把 r14（EXC_RETURN）也存进任务栈，因为恢复时还要靠它判断新任务用不用 FPU。最后 `str r0,[r2]` 把新栈顶写回 TCB——TCB 第一个成员此时更新为"切换后的栈顶"。

**② 选任务（stmdb sp!, {r0,r3} → bl vTaskSwitchContext）**：调用 C 函数会用到 r0~r3 和返回地址，而它们现在还没存进任何任务栈；但 `vTaskSwitchContext` 运行时用的是系统栈 MSP，所以先把 r0、r3 暂存到 MSP 栈上。调用前用 `msr basepri` 屏蔽低优先级中断，防止 vTaskSwitchContext 查列表时被 FromISR 类 API 插一脚。返回后立刻恢复。

**③ 恢复现场（ldr → ldmia → msr psp → bx r14）**：`pxCurrentTCB` 已被 vTaskSwitchContext 更新，重新取新 TCB、新栈顶，出栈 R4~R11 + EXC_RETURN，按 FPU 标志恢复 s16~s31，PSP 指向新任务栈。最后的 `bx r14` 是异常返回——硬件自动从新任务栈弹出 R0、R1、R2、R3、R12、LR、PC、xPSR，CPU 接着从 PC 位置继续执行：**新任务从上次被切走的那条指令接着跑**。

> ⚠️ 切换期间 BASEPRI 被临时拉高（屏蔽 FreeRTOS 管理的中断），这是临界区保护的一部分。如果你在中断服务函数里又调用 `vTaskSwitchContext` 或手动置 PendSV，会破坏"先存现场、再选任务、再恢复"的顺序，导致任务栈错乱——内核 API 里所有 `FromISR` 后缀函数都只负责"标记需要切换"，真正的切换永远在 PendSV 里，不要自己越权。

## 3. vTaskSwitchContext() 与选任务算法

PendSV 里调用的 `vTaskSwitchContext()` 在 task.c 中，核心就是更新 `pxCurrentTCB`（PDF p.173~174）：

```c
void vTaskSwitchContext( void )
{
    if( uxSchedulerSuspended != ( UBaseType_t ) pdFALSE )
    {
        /* 调度器被挂起（vTaskSuspendAll 期间）不允许切换：
         * 记下"有切换请求"，等恢复时统一处理 */
        xYieldPending = pdTRUE;
    }
    else
    {
        xYieldPending = pdFALSE;
        traceTASK_SWITCHED_OUT();

        taskCHECK_FOR_STACK_OVERFLOW();   /* 可选：栈溢出检查 */

        /* 把 pxCurrentTCB 指向最高优先级就绪任务 */
        taskSELECT_HIGHEST_PRIORITY_TASK();

        traceTASK_SWITCHED_IN();
    }
}
```

真正的算法在宏 `taskSELECT_HIGHEST_PRIORITY_TASK()` 里（PDF p.175~176）。它回答"谁上场"这个问题，分两步：**第一步查位图找最高优先级，第二步从该优先级的就绪列表取任务**。

FreeRTOS 用一个整型变量 `uxTopReadyPriority` 以位图方式记录"哪些优先级上有就绪任务"：第 N 位置 1 表示优先级 N 有就绪任务。找最高优先级 = 找位图里最高位的 1。两种实现：

```c
/* 方式一：纯软件遍历（通用，所有 MCU 可用） */
#define taskSELECT_HIGHEST_PRIORITY_TASK()                                  \
{                                                                           \
    UBaseType_t uxTopPriority = uxTopReadyPriority;                         \
    /* 从记录的最高优先级往下找第一个非空就绪列表 */                            \
    while( listLIST_IS_EMPTY( &( pxReadyTasksLists[ uxTopPriority ] ) ) )   \
    {                                                                       \
        --uxTopPriority;                                                    \
    }                                                                       \
    /* 从该就绪列表中取下一个任务 */                                            \
    listGET_OWNER_OF_NEXT_ENTRY( pxCurrentTCB,                              \
                                 &( pxReadyTasksLists[ uxTopPriority ] ) );  \
    uxTopReadyPriority = uxTopPriority;                                     \
}

/* 方式二：硬件前导零指令（Cortex-M3/M4 可用，STM32 全部支持） */
#define taskSELECT_HIGHEST_PRIORITY_TASK()                                  \
{                                                                           \
    UBaseType_t uxTopPriority;                                              \
    /* 用 __clz 数前导零：31 - 前导零数 = 最高位 1 的位置 = 最高优先级 */        \
    portGET_HIGHEST_PRIORITY( uxTopPriority, uxTopReadyPriority );          \
    listGET_OWNER_OF_NEXT_ENTRY( pxCurrentTCB,                              \
                                 &( pxReadyTasksLists[ uxTopPriority ] ) );  \
}

/* portmacro.h 中硬件方式的核心 */
#define portGET_HIGHEST_PRIORITY( uxTopPriority, uxReadyPriorities )        \
    uxTopPriority = ( 31UL - ( uint32_t ) __clz( ( uxReadyPriorities ) ) )
```

硬件方式一行 `__clz`（CLZ 指令，数前导零）搞定"找最高位 1"，常数时间，这也是 FreeRTOS 支持的最大优先级是 32（0~31）的原因——位图只有一个 32 位整数。上一课第 5 节创建任务时调用的 `taskRECORD_READY_PRIORITY` 就是维护这张位图的。

第二个关键宏 `listGET_OWNER_OF_NEXT_ENTRY` 决定了**同优先级任务之间的轮转**：它把列表的当前索引（`pxIndex`）向后移一位再取列表项 owner——所以同优先级任务会"轮流"被选中，这就是时间片调度的基础（第 5 节实验会看到）。而 `vTaskSwitchContext` 的调度器挂起判断（`xYieldPending`）保证在 `vTaskSuspendAll()` 临界区内不切换、只记账。

> 💡 数学彩蛋：`31 - __clz(x)` 为什么能找最高位？比如 uxTopReadyPriority = 0b1010（优先级 3 和 1 有任务），前导零 28 个，31-28=3——正好是最高位的位置。一次指令 O(1) 出结果，比遍历列表快得多。

## 4. PendSV 何时触发：tick、抢占与 portYIELD

所有"请求切换"的宏最终都汇到 `portYIELD()`（PDF p.177~178）：

```c
#define portYIELD()                                      \
{                                                        \
    /* 往 ICSR（0xE000ED04）的 bit28（PENDSVSET）写 1，挂起 PendSV */ \
    portNVIC_INT_CTRL_REG = portNVIC_PENDSVSET_BIT;      \
    __dsb( portSY_FULL_READ_WRITE );                     \
    __isb( portSY_FULL_READ_WRITE );                     \
}

/* ICSR 地址与 PENDSVSET 位定义（portmacro.h） */
#define portNVIC_INT_CTRL_REG   ( *( ( volatile uint32_t * ) 0xE000ED04 ) )
#define portNVIC_PENDSVSET_BIT  ( 1UL << 28UL )
```

典型触发场景有三条（PDF p.177）：

1. **SysTick 节拍里**：`xTaskIncrementTick()` 发现"时间片用完"或"有更高优先级任务解除阻塞"，返回 pdTRUE，SysTick 中断末尾通过 `portYIELD_FROM_ISR(pdTRUE)`（即 `portEND_SWITCHING_ISR`）挂起 PendSV。
2. **其他中断里**：串口等中断调用 `xQueueSendFromISR()` 等 API 唤醒了更高优先级任务，API 把 `pxHigherPriorityTaskWoken` 置 pdTRUE，中断退出前同样挂起 PendSV——注意此时 PendSV 会等这个中断完全退出才运行，正好符合第 1 节的"换人区"设计。
3. **任务里主动让出**：调用 `taskYIELD()`，或各种阻塞 API（`vTaskDelay`、`xQueueReceive`、`xSemaphoreTake`…）内部走到"需要切换"分支时，通过 `portYIELD_WITHIN_API()` 触发。

```c
/* 中断末尾的标准写法：需要切换才挂起 PendSV */
#define portEND_SWITCHING_ISR( xSwitchRequired )     \
    do {                                             \
        if( xSwitchRequired != pdFALSE )             \
        {                                            \
            portYIELD();                             \
        }                                            \
    } while( 0 )

#define portYIELD_FROM_ISR( x )   portEND_SWITCHING_ISR( x )
```

## 5. 时间片调度实验：同优先级轮流转

前面都是原理，现在亲眼看看切换。教材 9.5 节实验（PDF p.179~182）设计两个**相同优先级**的任务，都不延时、死循环打印，看它们怎么轮流跑：

```c
/* task1 与 task2 优先级相同（如都是 2），均无阻塞，靠时间片轮流执行 */
void task1(void *pvParameters)
{
    uint32_t task1_num = 0;

    while (1)
    {
        taskENTER_CRITICAL();                       /* 串口是共享外设，进临界区 */
        printf("任务 1 运行次数: %d\r\n", ++task1_num);
        taskEXIT_CRITICAL();
    }
}

void task2(void *pvParameters)
{
    uint32_t task2_num = 0;

    while (1)
    {
        taskENTER_CRITICAL();
        printf("任务 2 运行次数: %d\r\n", ++task2_num);
        taskEXIT_CRITICAL();
    }
}
```

原理串起来：`configUSE_TIME_SLICING`（默认 1）开启时间片轮转，`configUSE_PREEMPTION`（默认 1）开启抢占。tick 中断里 `xTaskIncrementTick()` 检测到当前任务的时间片用完且同优先级还有其他就绪任务，就请求切换；PendSV 里 `listGET_OWNER_OF_NEXT_ENTRY` 从同优先级就绪列表"取下一位"，于是 task1 和 task2 每隔一个时间片（默认 1 个 tick）互换一次。串口打印放临界区是为了防止两个任务"同时"抢同一个外设（PDF p.181）。

> ⚠️ 别把 `configUSE_TIME_SLICING` 和 `configUSE_PREEMPTION` 搞混：抢占（preemption）解决"不同优先级"——高优先级随时打断低优先级；时间片（time slicing）解决"同优先级"——大家轮流用 CPU。关掉 TIME_SLICING 后，同优先级任务要自己 `taskYIELD()` 或阻塞才会让出 CPU。

## 动手练习（约 20 分钟）

### 练习 7.1：单步走 PendSV 汇编

- 1️⃣ 在你的 FreeRTOS 分支工程里，给 `xPortPendSVHandler` 打断点（第一次触发就是 SysTick 到达后的首次切换），全速运行直到命中。
- 2️⃣ 单步执行每一条汇编（Disassembly 窗口），在 Watch 里盯着 `pxCurrentTCB` 和 `r0`（PSP 值）：确认 `str r0,[r2]` 前后，TCB 第一个成员的值变化；确认 `bl vTaskSwitchContext` 前后 pxCurrentTCB 指向的任务变了。
- 3️⃣ 连续按几次 F10 观察 `ldmia r0!,{r4-r11,r14}` 与 `msr psp,r0`：新任务的栈顶是从哪个地址开始出栈的？它和切换前 `str r0,[r2]` 存的地址有什么关系？
- 4️⃣ 验收标准：能口头复述"保存现场 → 选任务 → 恢复现场"三步，并指出每一步对应哪些汇编行。

### 练习 7.2：时间片实验观察切换

- 1️⃣ 在工程里新建 task1/task2（相同优先级、无延时、死循环 printf），按第 5 节代码实现，下载运行。
- 2️⃣ 观察串口输出：两个任务的计数是否交替递增？把 `configUSE_TIME_SLICING` 改成 0，重新编译下载，现象有什么变化？为什么？（提示：同优先级不再自动轮转，1 号任务会霸占 CPU）
- 3️⃣ 把 task2 的优先级调高一级，再观察：高优先级任务是否把低优先级完全"饿死"？（提示：task1 永远轮不到——这正是抢占式调度的行为，也说明设计优先级要谨慎）
- 4️⃣ 验收标准：能解释三种配置（同优先级/关时间片/提优先级）下串口输出的差异，并能在源码里指出决定该行为的那一行宏。

## 自测（答完再点答案）

### 随堂小测 1

Q1. FreeRTOS 把 PendSV 的中断优先级设置为？

- A. 最高优先级，保证切换立即执行
- B. 最低优先级，等所有中断处理完再切换
- C. 与 SysTick 相同，二者轮流执行
- D. 不设置，由用户中断自行配置

<details>
<summary>查看答案</summary>

B。PendSV 设为最低优先级，切换被推迟到所有中断处理完成之后，避免 SysTick 里直接切换造成中断延迟和 Usage Fault（PDF p.168~169）。

</details>

### 随堂小测 2

Q2. PendSV 汇编里 stmdb 手动压栈的寄存器是？

- A. R0~R3、R12、LR、PC、xPSR
- B. R4~R11（CM4F 还有 R14 与 FPU 寄存器）
- C. 所有 32 个通用寄存器
- D. 仅 R0 和 R3 两个暂存寄存器

<details>
<summary>查看答案</summary>

B。进入异常时硬件已自动压栈 R0~R3、R12、LR、PC、xPSR，PendSV 只需补压硬件不保存的 R4~R11；CM4F 版本还要按 EXC_RETURN bit4 判断是否压 s16~s31 并保存 R14（PDF p.170~171）。

</details>

### 随堂小测 3

Q3. taskSELECT_HIGHEST_PRIORITY_TASK() 的硬件实现用 __clz 做什么？

- A. 清零 uxTopReadyPriority 位图
- B. 数前导零，定位位图中最高位的 1
- C. 计算就绪列表的长度
- D. 反转位图的比特顺序

<details>
<summary>查看答案</summary>

B。31 减去前导零数即最高位 1 的位置，也就是最高就绪优先级，O(1) 完成查找；这也决定了 FreeRTOS 最多 32 个优先级（PDF p.176）。

</details>

### 随堂小测 4

Q4. 时间片调度（configUSE_TIME_SLICING）针对什么场景？

- A. 不同优先级任务之间按比例分配时间
- B. 相同优先级任务轮流使用 CPU
- C. 空闲任务与其他任务之间的切换
- D. 中断服务函数之间的切换

<details>
<summary>查看答案</summary>

B。listGET_OWNER_OF_NEXT_ENTRY 从同优先级就绪列表"取下一位"，使同优先级任务每个时间片轮流执行；不同优先级靠抢占式调度（configUSE_PREEMPTION）（PDF p.179~181）。

</details>

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 9 章（PDF p.168~182）——本课全部依据，重点看图 9.1.1~9.1.3 的三张时序图
- 🌐 [Mastering the FreeRTOS™ Real Time Kernel](https://www.freertos.org/Documentation/RTOS_book.html) 第 2 章（Scheduling）——官方书对抢占与时间片调度的语义讲解
- 📄 [FreeRTOS 官方实现细节页](https://www.freertos.org/implementing-a-real-time-kernel.html)——任务切换与内核调度器的实现说明

## 下一步

到这里，任务机制的原理部分就全部打通了：创建（第 6 课）→ 切换（本课）→ 列表支撑（第 5 课）。下一课开始进入任务间通信的世界：队列——任务之间传递数据的管道，也是信号量等一切同步机制的基石。

| [← 上一课](/my-blog/posts/freertos/0006-scheduler-startup/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0008-queues/) |