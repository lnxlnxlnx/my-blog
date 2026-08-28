---
title: 系统启动流程源码解析
published: 2026-08-17
description: FreeRTOS 系列课程第 6 课（全书最硬一课）：从 vTaskStartScheduler() 到第一个任务跑起来，逐函数、逐条汇编拆解 vTaskStartScheduler / xPortStartScheduler / prvStartFirstTask / vPortSVCHandler / xTaskCreate 全链路与空闲任务。
tags: [FreeRTOS, 嵌入式, RTOS, 启动流程, 源码解析, SVC, 任务栈]
category: FreeRTOS
draft: false
prevTitle: 任务切换原理：PendSV
prevSlug: "freertos/0007-task-switching-pendsv"
nextTitle: 列表与列表项
nextSlug: "freertos/0005-lists-and-list-items"
---

# 系统启动流程源码解析

这是 FreeRTOS 系列课程笔记的第 6 课：从 vTaskStartScheduler() 到第一个任务跑起来，逐函数、逐条汇编走一遍。**本课目标：**这是全书最硬的一课（教材第 8 章，PDF p.129~167）。学完你能在白板上画出启动全链路：`vTaskStartScheduler()` → `xPortStartScheduler()` → `prvStartFirstTask()` → `vPortSVCHandler()` → 第一个任务函数；能说清 TCB 第一个成员为什么必须是栈顶指针；能画出 `pxPortInitialiseStack()` 初始化出的栈帧布局。真正的"原理深入"就从这里开始。

## 1. 启动全景：一条不归路

你分支工程里的 FreeRTOS 例程，入口几乎都是这个套路：先创建 `start_task` 任务，然后调用 `vTaskStartScheduler()`（PDF p.129）：

```c
void freertos_demo(void)
{
    lcd_show_string(10, 10, 220, 32, 32, "STM32", RED);
    lcd_show_string(10, 47, 220, 24, 24, "FreeRTOS Porting", RED);

    /* 创建 start_task 任务 */
    xTaskCreate( (TaskFunction_t )start_task,      /* 任务函数 */
                (const char*    )"start_task",     /* 任务名称 */
                (uint16_t       )START_STK_SIZE,   /* 任务堆栈大小 */
                (void*          )NULL,             /* 传给任务函数的参数 */
                (UBaseType_t    )START_TASK_PRIO,  /* 任务优先级 */
                (TaskHandle_t*  )&StartTask_Handler); /* 任务句柄 */
    vTaskStartScheduler();                         /* 启动任务调度器 */
}
```

关键认知：**vTaskStartScheduler() 是一条不归路**。它启动调度器后，除非调用 `xTaskEndScheduler()`（本课程基本用不到），否则永远不会返回。它后面的代码一行都不会执行。整个启动链路是这样的：

1. `vTaskStartScheduler()`：创建空闲任务（+可选的定时器服务任务）→ 关中断 → 初始化全局变量 → 调 `xPortStartScheduler()`
2. `xPortStartScheduler()`（移植层，port.c）：设置 PendSV/SysTick 优先级 → 配置 SysTick → 使能 FPU → 调 `prvStartFirstTask()`
3. `prvStartFirstTask()`（汇编）：重设 MSP → 开全局中断 → `svc 0` 触发 SVC 异常
4. `vPortSVCHandler()`（汇编，SVC 中断服务函数）：从 `pxCurrentTCB` 取第一个任务 → 恢复任务现场 → 异常返回跳进任务函数

下面把这四个环节逐个拆开。中间穿插 `xTaskCreate()` 的源码——毕竟没有任务，调度器也没东西可调。

## 2. vTaskStartScheduler()：调度器的"开门仪式"

这个函数在 task.c 里，做了六件事（PDF p.132）：创建空闲任务、创建定时器服务任务（可选）、关闭中断、初始化全局变量、初始化运行时间统计时基、调用 `xPortStartScheduler()`。关键代码如下：

```c
void vTaskStartScheduler( void )
{
    BaseType_t xReturn;

    /* ① 创建空闲任务：支持静态分配则用静态方式，否则动态方式 */
    xReturn = xTaskCreate( prvIdleTask,           /* 空闲任务函数 */
                           configIDLE_TASK_NAME,  /* 任务名 "IDLE" */
                           configMINIMAL_STACK_SIZE,
                           ( void * ) NULL,
                           portPRIVILEGE_BIT,     /* 优先级 0，最低 */
                           &xIdleTaskHandle);

#if ( configUSE_TIMERS == 1 )
    /* ② 启用软件定时器时，创建定时器服务任务 */
    if( xReturn == pdPASS )
    {
        xReturn = xTimerCreateTimerTask();
    }
#endif

    if( xReturn == pdPASS )
    {
        /* ③ 关闭受 FreeRTOS 管理的中断：
         * 防止 SysTick 在调度器真正运行前产生中断，打乱初始化过程 */
        portDISABLE_INTERRUPTS();

        /* ④ 初始化全局变量 */
        xNextTaskUnblockTime = portMAX_DELAY;   /* 下一个任务解除阻塞的时间 */
        xSchedulerRunning = pdTRUE;             /* 调度器运行标志置位 */
        xTickCount = ( TickType_t ) configINITIAL_TICK_COUNT;  /* 系统节拍计数 */

        /* ⑤ 初始化任务运行时间统计的时基定时器（可选功能） */
        portCONFIGURE_TIMER_FOR_RUN_TIME_STATS();

        /* ⑥ 进入移植层，配置硬件并启动第一个任务（不再返回） */
        if( xPortStartScheduler() != pdFALSE )
        {
            /* 正常情况下到不了这里 */
        }
    }
}
```

> 💡 注意顺序的玄机：先创建空闲任务和定时器任务，再关中断。因为创建任务会用到就绪列表等内核数据结构，如果此时被 SysTick 中断插一脚，可能操作未初始化的列表——所以先建好任务、再关中断、再初始化全局变量。第一个任务跑起来时（SVC 里）会重新打开中断，见第 4 节。

## 3. xPortStartScheduler() 与 prvStartFirstTask()：硬件侧接力

`xPortStartScheduler()` 属于移植层（port.c），做的是"连接硬件"的活（PDF p.133）：

```c
BaseType_t xPortStartScheduler( void )
{
    /* ① 把 PendSV 和 SysTick 的中断优先级设为最低优先级 */
    /*    这样任务切换（PendSV）永远等所有中断处理完才执行 */
    portNVIC_SYSPRI2_REG |= portNVIC_PENDSV_PRI;   /* SHPR3 寄存器，0xE000ED20 */
    portNVIC_SYSPRI2_REG |= portNVIC_SYSTICK_PRI;

    /* ② 配置 SysTick：清计数值、按 configTICK_RATE_HZ 算重装载值、开启中断 */
    vPortSetupTimerInterrupt();

    /* ③ 临界区嵌套计数器归零（进临界区是允许嵌套的） */
    uxCriticalNesting = 0;

    /* ④ 使能 FPU（仅 Cortex-M4/M7 有这行） */
    prvEnableVFP();

    /* ⑤ FPCCR 置位 ASPEN/LSPEN：进出异常时自动保存/恢复 FPU 寄存器 */
    *( portFPCCR ) |= portASPEN_AND_LSPEN_BITS;

    /* ⑥ 启动第一个任务 */
    prvStartFirstTask();

    return 0;   /* 永远不会执行到这里 */
}
```

然后跳进汇编 `prvStartFirstTask()`（port.c）。这段汇编只有 8 条有效指令，但信息量极大（PDF p.134）：

```c
__asm void prvStartFirstTask( void )
{
    PRESERVE8                    /* 保持 8 字节对齐（栈对齐要求） */

    ldr r0, =0xE000ED08          /* 0xE000ED08 是 VTOR（向量表偏移寄存器）地址 */
    ldr r0, [ r0 ]               /* 取出 VTOR 的值 = 向量表首地址 */
    ldr r0, [ r0 ]               /* 向量表第一个字 = 栈顶（MSP 初始值） */

    msr msp, r0                  /* 把 MSP 重设为栈底，丢弃之前的所有栈数据 */

    cpsie i                      /* 开全局中断（IRQ） */
    cpsie f                      /* 开全局中断（FIQ，M3/M4 上无实际意义） */
    dsb
    isb

    svc 0                        /* 触发 SVC 异常，进入 vPortSVCHandler */
    nop
    nop
}
```

三个要点：

- **MSP 和 PSP 的分工**：Cortex-M 内核有两个堆栈指针。MSP（主堆栈指针）给系统/中断用，PSP（进程堆栈指针）给任务用。FreeRTOS 里任务跑在 PSP 上，进中断后硬件自动切回 MSP。记住这个分工，第 4、5 节和下一课都会用到。
- **为什么要重设 MSP**：从复位到这里的栈数据（调用链、局部变量）都是"一次性"的，因为调度器启动后走的是任务栈。直接把 MSP 打回初始值，等于宣布"旧世界作废"。
- **为什么用 SVC**：Cortex-M 上不能直接"切到任务模式用 PSP 跑任意函数"，但可以通过异常返回机制实现。SVC 是软件可触发的同步异常，用它作为进入第一个任务的"跳板"。

> ⚠️ 向量表第一个字是初始栈顶指针，这个事实来自启动文件 start_stm32f407xx.s：`__Vectors DCD __initial_sp`。所以 `prvStartFirstTask` 三次 `ldr` 是"取 VTOR → 取向量表地址 → 取栈顶"的连环套。如果你改了向量表位置（比如放在外部 RAM），这段代码依然正确——因为它读的是 VTOR 而不是硬编码地址。

## 4. vPortSVCHandler()：伪造一次"中断返回"

`svc 0` 一执行，就进入了 SVC 的中断服务函数 `vPortSVCHandler()`（port.c）。它的任务：把第一个任务"看起来像刚从上下文切换回来一样"（PDF p.136）。以你板子用的 Cortex-M4F 移植为例：

```c
__asm void vPortSVCHandler( void )
{
    PRESERVE8

    /* ① 取第一个任务：pxCurrentTCB 指向最高优先级就绪任务 */
    ldr r3, =pxCurrentTCB        /* r3 = pxCurrentTCB 变量的地址 */
    ldr r1, [ r3 ]               /* r1 = TCB 首地址 */
    ldr r0, [ r1 ]               /* r0 = TCB 第一个成员 = 任务栈顶指针 */

    /* ② 模拟"出栈"：把任务栈里的 R4~R11、R14 恢复到 CPU 寄存器 */
    ldmia r0!, { r4 - r11, r14 }

    msr psp, r0                  /* ③ PSP 指向任务栈剩余部分 */
    isb

    /* ④ 允许所有中断（BASEPRI = 0） */
    mov r0, #0
    msr basepri, r0

    /* ⑤ 修改 EXC_RETURN 并返回：线程模式 + PSP */
    orr r14, #0xd                /* EXC_RETURN | 0x0D */
    bx r14                       /* 异常返回，硬件自动出栈剩余寄存器 */
}
```

这里藏着本课最核心的两个机制：

**机制一：为什么 TCB 第一个成员必须是栈顶指针？** 因为任务切换的本质就是"换栈"：谁在跑，SP 就指向谁的栈。TCB（任务控制块）的第一个成员 `pxTopOfStack` 就是任务当前栈顶，代码里 `ldr r0, [r1]` 直接取第一个字，零偏移。这个约定贯穿所有切换代码。

**机制二：EXC_RETURN 与"伪造返回"。** 进入异常时，LR（r14）会被硬件自动改写为 EXC_RETURN，它告诉 CPU 返回后进入什么模式、用哪个栈指针：

| EXC_RETURN 值 | bit[4] FPU | bit[3] 模式 | bit[2] 栈指针 |
|------|------|------|------|
| 0xFFFFFFE1 / 0xFFFFFFF1 | 用 / 不用 | Handler 模式 | MSP |
| 0xFFFFFFE9 / 0xFFFFFFF9 | 用 / 不用 | 线程模式 | MSP |
| 0xFFFFFFED / 0xFFFFFFFD | 用 / 不用 | 线程模式 | **PSP** |

SVC 是从线程模式触发的，此时 r14 = 0xFFFFFFF9（线程模式 + MSP）。`orr r14, #0xd` 把 bit3、bit2 置 1：0xF9 | 0x0D = 0xFD —— **变成"线程模式 + PSP"**。于是 `bx r14` 执行异常返回时，CPU 从 PSP 指向的任务栈自动出栈 R0、R1、R2、R3、R12、LR、PC、xPSR，然后跳到 PC 指向的代码——也就是任务函数！任务函数入口地址早在创建任务时就写进了任务栈（第 5 节）。

> 💡 理解"异常返回 = 出栈 PC 并跳转"后，你会豁然开朗：任务的第一次运行和以后的每一次恢复，走的是同一条路——硬件从 PSP 栈上出栈 PC。区别只是第一次栈里是 `pxPortInitialiseStack` 预先埋好的值，之后是上次切换时 `xPortPendSVHandler` 存进去的值。

## 5. xTaskCreate() 全链路：TCB 与任务栈的诞生

启动链路看完了，回头补课：任务到底是怎么"造"出来的。此时 `start_task`、空闲任务、定时器任务都创建过了——SVC 里第一个跑的其实是优先级最高的定时器任务（31 级 > start_task 的 1 级 > 空闲任务的 0 级，见 PDF p.136 的表）。`xTaskCreate()` 的骨架（PDF p.138）：

```c
BaseType_t xTaskCreate( TaskFunction_t pxTaskCode,
                         const char * const pcName,
                         const configSTACK_DEPTH_TYPE usStackDepth,
                         void * const pvParameters,
                         UBaseType_t uxPriority,
                         TaskHandle_t * const pxCreatedTask )
{
    TCB_t * pxNewTCB;

    /* STM32 栈向下生长，portSTACK_GROWTH 为 -1，先申请任务栈 */
    pxStack = pvPortMallocStack( usStackDepth * sizeof( StackType_t ) );
    if( pxStack != NULL )
    {
        pxNewTCB = ( TCB_t * ) pvPortMalloc( sizeof( TCB_t ) );
        if( pxNewTCB != NULL )
        {
            pxNewTCB->pxStack = pxStack;   /* 记下任务栈地址 */
        }
        else
        {
            vPortFreeStack( pxStack );      /* TCB 申请失败则回滚栈 */
        }
    }

    if( pxNewTCB != NULL )
    {
        /* 初始化 TCB 的各个成员：名字、优先级、列表项、任务栈…… */
        prvInitialiseNewTask( pxTaskCode, pcName, usStackDepth,
                              pvParameters, uxPriority, pxCreatedTask,
                              pxNewTCB, NULL );
        /* 把任务挂进就绪列表，并更新 pxCurrentTCB */
        prvAddNewTaskToReadyList( pxNewTCB );
        xReturn = pdPASS;
    }
    return xReturn;
}
```

内存申请失败会"回滚"：栈失败就返回 NULL，TCB 失败就释放栈——保证不留内存泄漏。`prvInitialiseNewTask()`（PDF p.141）做的主要事情：把栈写满标记值（`tskSTACK_FILL_BYTE`，方便日后查栈溢出）、拷贝任务名、校验并保存优先级（同时保存 `uxBasePriority` 供互斥量优先级继承用）、初始化两个列表项（`xStateListItem`、`xEventListItem`）并登记 owner、然后调用今天的主角 `pxPortInitialiseStack()` 初始化任务栈。

STM32F407 是 CM4F 内核，对应带 FPU 支持的任务栈初始化（PDF p.149，与 CM3 版本的差别是多存了一个 EXC_RETURN）：

```c
StackType_t * pxPortInitialiseStack( StackType_t * pxTopOfStack,
                                     TaskFunction_t pxCode,
                                     void * pvParameters )
{
    /* 模拟一次上下文切换中断后的栈帧结构 */
    pxTopOfStack--;                    /* 硬件入栈前的栈顶偏移 */
    *pxTopOfStack = portINITIAL_XPSR;  /* xPSR = 0x01000000（Thumb 标志） */
    pxTopOfStack--;
    *pxTopOfStack = ( ( StackType_t ) pxCode ) & portSTART_ADDRESS_MASK;  /* PC = 任务函数入口 */
    pxTopOfStack--;
    *pxTopOfStack = ( StackType_t ) prvTaskExitError;  /* LR = 错误退出函数 */
    pxTopOfStack -= 5;                 /* 预留 R12、R3、R2、R1 */
    *pxTopOfStack = ( StackType_t ) pvParameters;      /* R0 = 任务参数 */
    pxTopOfStack--;
    *pxTopOfStack = portINITIAL_EXC_RETURN;            /* EXC_RETURN = 0xFFFFFFFD */
    pxTopOfStack -= 8;                 /* 预留 R11、R10、R9、R8、R7、R6、R5、R4 */

    return pxTopOfStack;               /* 新栈顶存入 TCB->pxTopOfStack */
}
```

初始化后的任务栈从高地址到低地址长这样（对照第 4 节，硬件出栈顺序正好相反）：

| 栈地址方向 | 内容 | 对应寄存器 |
|------|------|------|
| 高地址（栈底）↓低地址（栈顶） | 0x01000000 | xPSR（置 Thumb 位） |
|  | 任务函数地址 | PC |
|  | prvTaskExitError 地址 | LR |
|  | 预留 | R12、R3、R2、R1 |
|  | 任务参数 pvParameters | R0 |
|  | 0xFFFFFFFD | EXC_RETURN（线程模式+PSP） |
|  | 预留 | R11~R4 |
|  | ← pxTopOfStack 返回给 TCB | （从此处开始真正使用） |

最后 `prvAddNewTaskToReadyList()` 把任务挂进就绪列表（PDF p.151）：计数 `uxCurrentNumberOfTasks++`；如果 `pxCurrentTCB` 还是 NULL（第一个任务），顺手 `prvInitialiseTaskLists()` 初始化所有内核列表；调度器未运行时，新任务优先级 ≥ 当前 `pxCurrentTCB` 就替换之——所以创建顺序和优先级共同决定了谁第一个跑。然后通过宏 `prvAddTaskToReadyList` 把任务的状态列表项插到 `pxReadyTasksLists[优先级]` 末尾，同时用位图记录"这个优先级有任务"（`taskRECORD_READY_PRIORITY`），下一课选任务就靠这张位图。

## 6. 任务生命周期：删除、挂起、恢复与空闲任务

启动流程讲完，把任务管理剩下的几个函数过一遍（细节留到后续实验课验证）：

**vTaskDelete()**（PDF p.154）：传入 NULL 表示删除自己。关键分支——**任务无法删掉正在运行的自己**，于是把自己挂进 `xTasksWaitingTermination` 待删除列表，并让 `uxDeletedTasksWaitingCleanUp++`，由空闲任务来"收尸"；删别的任务就直接调用 `prvDeleteTCB()` 释放 TCB 和任务栈内存（`vPortFreeStack(pxTCB->pxStack)` + `vPortFree(pxTCB)`）。删除自己后必须立刻让出 CPU（`portYIELD_WITHIN_API()`），否则一个"不存在"的任务还在跑。

```c
void vTaskDelete( TaskHandle_t xTaskToDelete )
{
    pxTCB = prvGetTCBFromHandle( xTaskToDelete );  /* NULL = 自己 */
    taskENTER_CRITICAL();

    uxListRemove( &( pxTCB->xStateListItem ) );   /* 移出原状态列表 */
    if( listLIST_ITEM_CONTAINER( &( pxTCB->xEventListItem ) ) != NULL )
    {
        uxListRemove( &( pxTCB->xEventListItem ) ); /* 还在等事件？一并移除 */
    }

    if( pxTCB == pxCurrentTCB )
    {
        /* 删自己：挂进待删除列表，等空闲任务清理 */
        vListInsertEnd( &xTasksWaitingTermination, &( pxTCB->xStateListItem ) );
        ++uxDeletedTasksWaitingCleanUp;
    }
    else
    {
        --uxCurrentNumberOfTasks;
        prvResetNextTaskUnblockTime();
    }
    taskEXIT_CRITICAL();

    if( pxTCB != pxCurrentTCB )
    {
        prvDeleteTCB( pxTCB );                    /* 删别人：直接释放内存 */
    }
    else if( xSchedulerRunning != pdFALSE )
    {
        portYIELD_WITHIN_API();                   /* 删自己：立刻切换任务 */
    }
}
```

**vTaskSuspend() / vTaskResume()**（PDF p.158）：挂起就是把任务从就绪/阻塞列表移到 `xSuspendedTaskList`（挂起列表），恢复时再移回就绪列表。挂起自己同样要立刻切换。两个函数都要处理"下一个解除阻塞任务"的更新，避免算错休眠时间。

**vTaskSwitchContext()**（PDF p.161）：内核里负责更新 `pxCurrentTCB` 指向最高优先级就绪任务的函数，核心是宏 `taskSELECT_HIGHEST_PRIORITY_TASK()`。本课先留个印象——它就是"查位图找最高优先级 → 从对应就绪列表取下一个任务"，真正的上下文切换发生在 PendSV 里，下一课逐条汇编分析。

**空闲任务 prvIdleTask()**（PDF p.165）：优先级 0，永不停歇的"管家"，主要干三件事：

```c
static portTASK_FUNCTION( prvIdleTask, pvParameters )
{
    for( ; ; )
    {
        /* ① 清理待删除列表：执行真正被"删除自己"的任务收尾 */
        prvCheckTasksWaitingTermination();

#if ( ( configUSE_PREEMPTION == 1 ) && ( configIDLE_SHOULD_YIELD == 1 ) )
        /* ② 有同优先级（0 级）任务就绪时让出 CPU，避免饿死它们 */
        if( listCURRENT_LIST_LENGTH( &( pxReadyTasksLists[ tskIDLE_PRIORITY ] ) ) > 1 )
        {
            taskYIELD();
        }
#endif

#if ( configUSE_IDLE_HOOK == 1 )
        vApplicationIdleHook();   /* ③ 用户钩子：低功耗、喂狗等放这里 */
#endif
    }
}
```

## 动手练习（约 25 分钟）

### 练习 6.1：断点走一遍启动流程

- 1️⃣ 打开你的 FreeRTOS 分支工程，在 `freertos_demo()` 调用 `vTaskStartScheduler()` 那行打断点，单步进入（F11 需要先关掉"跳过系统库"选项，或直接 Ctrl+F11 进汇编）。
- 2️⃣ 依次在 `xPortStartScheduler()`、`prvStartFirstTask()`、`vPortSVCHandler()` 入口打断点，观察：进入 `prvStartFirstTask` 前后 MSP 的值怎么变？`svc 0` 单步后 SP 是否变成了 PSP 的值？
- 3️⃣ 在 Watch 窗口添加 `pxCurrentTCB`，等 vPortSVCHandler 执行完，确认它指向的是定时器服务任务（优先级 31 最高）；在任务函数入口打断点，确认跳进的就是它。
- 4️⃣ 验收标准：能说出"从复位到第一个任务运行"经过了哪 4 个关键函数，以及每步 SP 在 MSP/PSP 之间如何切换。

### 练习 6.2：画出 pxPortInitialiseStack 的栈帧

- 1️⃣ 在你的工程里打开 `port.c`，找到 `pxPortInitialiseStack()`，对照本课第 5 节的表格逐行核对（注意你的工程可能是 CM4F 版本，有 EXC_RETURN 那行）。
- 2️⃣ 在 `prvInitialiseNewTask()` 调用 `pxPortInitialiseStack()` 之后打断点，在 Memory 窗口查看任务栈内容，验证：栈顶往下的第 4 个字（PC 位置）是不是任务函数地址？第 6 个字是不是 0xFFFFFFFD？
- 3️⃣ 修改 `portINITIAL_EXC_RETURN` 的注释内容，用一两句话解释：为什么任务第一次"跑起来"时，硬件自动出栈的顺序恰好和入栈顺序相反。
- 4️⃣ 验收标准：你能在白纸上默写这个栈帧布局（8 个区域），并指出 R0 里存的为什么是 `pvParameters`。

## 自测（答完再点答案）

### 随堂小测 1

Q1. vTaskStartScheduler() 中调用 portDISABLE_INTERRUPTS() 的目的是？

- A. 防止用户任务在调度器启动前抢占执行
- B. 防止 SysTick 在调度器开启前或过程中产生中断
- C. 让空闲任务优先获得 CPU 使用权
- D. 保护串口打印不被中断打断

<details>
<summary>查看答案</summary>

B。关闭受 FreeRTOS 管理的中断，防止 SysTick 在任务调度器开启前产生中断干扰初始化，第一个任务运行时（SVC 里 BASEPRI=0）会重新打开中断（PDF p.130~131）。

</details>

### 随堂小测 2

Q2. prvStartFirstTask() 里读取的 0xE000ED08 是什么寄存器？

- A. SysTick 控制和状态寄存器
- B. 中断控制状态寄存器（ICSR）
- C. 向量表偏移寄存器（VTOR）
- D. 应用程序中断和复位控制寄存器

<details>
<summary>查看答案</summary>

C。VTOR 保存向量表偏移地址；向量表第一个字就是初始栈顶指针（MSP 初始值），所以连续三次 ldr 取出栈顶（PDF p.134）。

</details>

### 随堂小测 3

Q3. vPortSVCHandler() 末尾 "orr r14, #0xd" 的作用是？

- A. 使能浮点单元并保存浮点寄存器
- B. 把 EXC_RETURN 改为"返回线程模式并使用 PSP"
- C. 触发 PendSV 异常以完成后续切换
- D. 将中断优先级设置为最低等级

<details>
<summary>查看答案</summary>

B。SVC 里 r14 是 EXC_RETURN（0xFFFFFFF9，线程模式+MSP），orr 0x0D 后变成 0xFFFFFFFD（线程模式+PSP），bx r14 时硬件从 PSP 任务栈自动出栈寄存器并跳进任务函数（PDF p.137）。

</details>

### 随堂小测 4

Q4. TCB 结构体的第一个成员为什么必须是栈顶指针？

- A. 因为编译器要求结构体首成员是栈指针
- B. 因为任务切换的本质是换栈，切换汇编零偏移取栈顶
- C. 为了方便统计任务栈的最大使用量
- D. 因为任务名数组必须排在栈指针后面

<details>
<summary>查看答案</summary>

B。谁在运行，SP 就指向谁的栈；切换时汇编用 ldr r0,[r1] 直接取 TCB 第一个字作为新任务的栈顶，零偏移最快（PDF p.136、p.170 等多处可见该约定）。

</details>

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 8 章（PDF p.129~167）——本课全部源码依据，建议配合工程逐函数读
- 🌐 [Mastering the FreeRTOS™ Real Time Kernel](https://www.freertos.org/Documentation/RTOS_book.html) 第 3 章（Task Management）——官方书对任务创建/删除的语义讲得更细
- 📄 [FreeRTOS API: xTaskCreate](https://www.freertos.org/xTaskCreate.html)——官方 API 参考，注意形参语义与源码一一对应

## 下一步

本课是全课程信息密度最大的一课，一次消化不了很正常，建议配合练习 6.1 的断点走查再读一遍源码。下一课预告：第 7 课——任务切换原理，把 PendSV 的每一行汇编和"选谁上场"的算法彻底拆开。

| [← 上一课](/my-blog/posts/freertos/0005-lists-and-list-items/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0007-task-switching-pendsv/) |