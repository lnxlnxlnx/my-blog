---
title: 队列
published: 2026-08-19
description: FreeRTOS 系列课程第 8 课：任务间通信的管道——Queue_t 结构体逐字段、xQueueCreate 内部原理、发送/接收的阻塞语义与队列锁、队列集让一个任务监听多个队列，信号量全家桶的基石。
tags: [FreeRTOS, 嵌入式, RTOS, 队列, 任务通信, 阻塞, 队列集]
category: FreeRTOS
draft: false
prevTitle: ""
prevSlug: ""
nextTitle: 任务切换原理：PendSV
nextSlug: "freertos/0007-task-switching-pendsv"
---

# 队列

这是 FreeRTOS 系列课程笔记的第 8 课：任务间通信的管道：Queue_t 结构体、创建/发送/接收 API、阻塞语义与队列集。**本课目标：**前面五课把任务和调度搞明白了，但任务之间怎么"说话"？答案是队列（教材第 13 章，PDF p.230~283）。学完你能说清：队列的本质是什么、`xQueueSend` 阻塞时内核做了什么、为什么需要队列锁、以及队列集如何让一个任务"监听"多个队列。信号量全家桶都是队列的变体，这一课是第 9 课的地基。

## 1. 队列：任务间通信的"邮箱"

队列是**任务与任务、任务与中断之间传递数据**的机制（PDF p.230）。三个基本特性：

- **容量有限、项目定长**：创建时指定队列长度（能存几个项目）和项目大小（每个项目多少字节）。比如长度 5、项目大小 4 字节，就是能存 5 个 int 的队列。
- **FIFO 存储**：写入永远进队尾，读取永远出队头。也支持插队（写队头）和覆写。
- **不属于任何任务**：任何任务、任何中断都可以往里写、往外读。

最重要的语义是**阻塞**（PDF p.230~231）：

| 场景 | 行为 |
|------|------|
| 读空队列 | 任务阻塞，等队列有消息；超时到还没消息，自动回就绪态但拿不到数据 |
| 写满队列 | 任务阻塞，等队列有空位；超时到还没空位，自动回就绪态但数据没写进去 |
| 多个任务等同一个队列 | 有消息/空位时只唤醒一个，按阻塞先后 + 优先级决定 |

基于队列，FreeRTOS 实现了队列集、二值信号量、计数型信号量、互斥信号量、递归互斥信号量（PDF p.230）——所以这一课一定要吃透，第 9 课全是"队列的亲戚"。

## 2. Queue_t 结构体：队列的"身份档案"

队列控制块 `Queue_t` 定义在 queue.c（PDF p.232），核心成员：

```c
typedef struct QueueDefinition
{
    int8_t * pcHead;          /* 存储区域起始地址 */
    int8_t * pcWriteTo;       /* 下一个写入位置 */
    union
    {
        QueuePointers_t xQueue;      /* 队列专用：pcTail（存储区尾）、pcReadFrom（上次读取位置） */
        SemaphoreData_t xSemaphore;  /* 信号量专用：xMutexHolder（持有者）、uxRecursiveCallCount */
    } u;

    List_t xTasksWaitingToSend;      /* 写阻塞任务列表（队列满时等空位的任务） */
    List_t xTasksWaitingToReceive;   /* 读阻塞任务列表（队列空时等消息的任务） */

    volatile UBaseType_t uxMessagesWaiting;  /* 当前非空闲项目数 = 有效消息数 */
    UBaseType_t uxLength;            /* 队列长度（最多几个项目） */
    UBaseType_t uxItemSize;          /* 每个项目大小（字节） */

    volatile int8_t cRxLock;         /* 读取上锁计数器 */
    volatile int8_t cTxLock;         /* 写入上锁计数器 */

#if ( configUSE_QUEUE_SETS == 1 )
    struct QueueDefinition * pxQueueSetContainer;  /* 所属队列集（第 6 节） */
#endif
} Queue_t;
```

读懂这份"档案"，队列的秘密就揭开了一半：

- `uxMessagesWaiting` 是队列的灵魂——**有消息 / 没消息、有资源 / 没资源，全看它**。信号量就是靠它计数（第 9 课）。
- 存储区是环形缓冲区：`pcWriteTo` 负责写指针，`pcReadFrom` 负责读指针，`pcTail` 兜底环形回卷。写满、读空都是比较 `uxMessagesWaiting` 与 `uxLength`，不搬数据、只搬指针。
- 两个阻塞列表 + 两个锁计数器，是"阻塞唤醒"机制的载体，第 4、5 节展开。
- 联合体 `u` 让同一个结构体既能当队列又能当信号量——队列项目大小为 0 时 `pcHead` 甚至直接指向自己，根本不需要存储区（PDF p.236）。

> 💡 对照第 5 课的列表知识：`xTasksWaitingToSend` / `xTasksWaitingToReceive` 就是两个事件列表，阻塞任务通过 `vTaskPlaceOnEventList` 挂进去，被唤醒时通过 `xTaskRemoveFromEventList` 摘出来——事件列表项的值（与优先级成反比）决定了谁先被唤醒。

## 3. 创建队列：xQueueCreate 内部发生了什么

`xQueueCreate(uxQueueLength, uxItemSize)` 是个宏，真正干活的是 `xQueueGenericCreate()`（PDF p.234~235）：

```c
#define xQueueCreate( uxQueueLength, uxItemSize )  \
    xQueueGenericCreate( ( uxQueueLength ),        \
                         ( uxItemSize ),           \
                         ( queueQUEUE_TYPE_BASE ) )

QueueHandle_t xQueueGenericCreate( const UBaseType_t uxQueueLength,
                                   const UBaseType_t uxItemSize,
                                   const uint8_t ucQueueType )
{
    Queue_t * pxNewQueue = NULL;

    /* 参数检查：长度必须大于 0，且防止乘法溢出 */
    if( ( uxQueueLength > 0 ) &&
        ( ( SIZE_MAX / uxQueueLength ) >= uxItemSize ) &&
        ( ( SIZE_MAX - sizeof( Queue_t ) ) >= ( uxQueueLength * uxItemSize ) ) )
    {
        xQueueSizeInBytes = ( size_t ) ( uxQueueLength * uxItemSize );

        /* 一次申请：队列控制块 + 存储区，内存连续 */
        pxNewQueue = ( Queue_t * ) pvPortMalloc( sizeof( Queue_t ) +
                                                 xQueueSizeInBytes );
        if( pxNewQueue != NULL )
        {
            pucQueueStorage = ( uint8_t * ) pxNewQueue + sizeof( Queue_t );

            /* 初始化结构体成员，并调用 xQueueGenericReset 复位队列 */
            prvInitialiseNewQueue( uxQueueLength, uxItemSize,
                                   pucQueueStorage, ucQueueType, pxNewQueue );
        }
    }
    return pxNewQueue;   /* NULL = 失败；其他值 = 队列句柄 */
}
```

注意两个细节：

- **控制块和存储区一次性申请**（一块连续内存），比两次 malloc 更省堆开销、也更难泄漏。
- **队列类型**（`queueQUEUE_TYPE_BASE` 等 6 种）决定了这个"队列"将来是普通队列还是某种信号量——信号量创建函数就是换了个类型码调同一个函数（PDF p.235）。

至于 `xQueueCreateStatic()`：内存由你提供，其中控制块参数类型是 `StaticQueue_t`——它和 `Queue_t` 内存布局一一对应，但成员全叫 `ucDummyX`，明示"只许用来算大小，不许直接访问"（PDF p.240~241）。动态版够用，静态版了解即可。

## 4. 发送与接收：阻塞是怎么发生的

发送家族 `xQueueSend` / `xQueueSendToBack` / `xQueueSendToFront` / `xQueueOverwrite` 全是宏，殊途同归到 `xQueueGenericSend(xQueue, pvItemToQueue, xTicksToWait, xCopyPosition)`（PDF p.243~244）：

```c
#define xQueueSend( xQueue, pvItemToQueue, xTicksToWait )      \
    xQueueGenericSend( ( xQueue ), ( pvItemToQueue ),          \
                       ( xTicksToWait ), queueSEND_TO_BACK )

#define xQueueSendToFront( xQueue, pvItemToQueue, xTicksToWait ) \
    xQueueGenericSend( ( xQueue ), ( pvItemToQueue ),           \
                       ( xTicksToWait ), queueSEND_TO_FRONT )

/* queueSEND_TO_BACK=0（队尾）、queueSEND_TO_FRONT=1（队头）、queueOVERWRITE=2（覆写） */
```

`xQueueGenericSend` 的主流程（PDF p.245~250）可以浓缩成下面的伪代码逻辑：

```c
for( ; ; )
{
    taskENTER_CRITICAL();
    {
        /* 队列有空位，或允许覆写 → 直接写入 */
        if( ( uxMessagesWaiting < uxLength ) || ( xCopyPosition == queueOVERWRITE ) )
        {
            prvCopyDataToQueue( pxQueue, pvItemToQueue, xCopyPosition );
            /* 有任务在等消息？把等得最久/优先级最高的那个唤醒 */
            if( !listLIST_IS_EMPTY( &( pxQueue->xTasksWaitingToReceive ) ) )
            {
                if( xTaskRemoveFromEventList(
                        &( pxQueue->xTasksWaitingToReceive ) ) != pdFALSE )
                {
                    queueYIELD_IF_USING_PREEMPTION();  /* 唤醒的优先级更高？请求切换 */
                }
            }
            taskEXIT_CRITICAL();
            return pdPASS;
        }

        if( xTicksToWait == 0 )
        {
            taskEXIT_CRITICAL();
            return errQUEUE_FULL;      /* 不想等，直接失败 */
        }
        /* 记下超时起点（用于阻塞时间补偿） */
        vTaskInternalSetTimeOutState( &xTimeOut );
    }
    taskEXIT_CRITICAL();

    /* 队列满：挂起调度器 → 队列上锁 → 阻塞自己 → 解锁 → 恢复调度器 */
    vTaskSuspendAll();
    prvLockQueue( pxQueue );

    if( xTaskCheckForTimeOut( &xTimeOut, &xTicksToWait ) == pdFALSE )
    {
        if( prvIsQueueFull( pxQueue ) != pdFALSE )
        {
            /* 把自己挂进"写阻塞列表"，睡眠 xTicksToWait 个 tick */
            vTaskPlaceOnEventList( &( pxQueue->xTasksWaitingToSend ), xTicksToWait );
            prvUnlockQueue( pxQueue );
            if( xTaskResumeAll() == pdFALSE )
            {
                portYIELD_WITHIN_API();  /* 让别人先跑 */
            }
        }
    }
    /* 醒来了：回到循环顶部重试写入 */
}
```

接收侧对称：`xQueueReceive()`（读走，消息出队）和 `xQueuePeek()`（偷看，消息留在队里）都走 `xQueueGenericReceive()`，队列空时把任务挂进 `xTasksWaitingToReceive`。中断版本 `xQueueSendFromISR()` / `xQueueReceiveFromISR()` 有两点不同（PDF p.251、p.257）：**没有阻塞时间参数**（中断不能睡觉），改用 `pxHigherPriorityTaskWoken` 输出"我唤醒了一个高优先级任务"的标志，由你在中断末尾决定要不要 `portYIELD_FROM_ISR()`：

```c
/* 串口接收中断里：收一字节入队，若唤醒高优先级任务则请求切换 */
void USART1_IRQHandler(void)
{
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    uint8_t ch = 0;

    if (USART_GetITStatus(USART1, USART_IT_RXNE) != RESET)
    {
        ch = (uint8_t)USART_ReceiveData(USART1);
        xQueueSendFromISR( xRxQueue, &ch, &xHigherPriorityTaskWoken );
    }
    portYIELD_FROM_ISR( xHigherPriorityTaskWoken );
}
```

## 5. 队列锁：阻塞与解锁的缓冲地带

上节的伪代码里出现了 `prvLockQueue` / `prvUnlockQueue`，它们是什么？回忆第 3 节结构体里的 `cRxLock`、`cTxLock`（PDF p.258~261）：

- **作用**：任务因"队列满/空"即将阻塞的窗口期，把队列"锁住"——上锁期间消息照常读写，但**不立即去动阻塞列表**，只把 `cTxLock` / `cRxLock` 计数加一；解锁时再统一处理这段时间积压的唤醒。
- **为什么需要**：任务 A 检查队列"满了"→ 正要阻塞自己，这时中断往队列塞了条消息、还试图唤醒任务 A——如果 A 已经把自己挂进阻塞列表就没事，但 A 还没挂呢，唤醒动作就丢了。锁解决了这个竞态：中断发现队列上锁，就只把锁计数 +1，等 A 把自己挂好、解锁时，发现锁计数不为 0，就知道"刚才有人写过"，重新处理阻塞列表。
- **计数器语义**：`queueUNLOCKED`（-1）表示未上锁；上锁后初始为 `queueLOCKED_UNMODIFIED`（0），被写/读一次 +1，解锁时循环把阻塞任务逐个摘除，直到计数回到 0。

```c
/* 上锁：把两个锁计数器从 -1（UNLOCKED）置为 0（LOCKED_UNMODIFIED） */
#define prvLockQueue( pxQueue )                        \
    taskENTER_CRITICAL();                              \
    {                                                  \
        if( ( pxQueue )->cRxLock == queueUNLOCKED )    \
            ( pxQueue )->cRxLock = queueLOCKED_UNMODIFIED; \
        if( ( pxQueue )->cTxLock == queueUNLOCKED )    \
            ( pxQueue )->cTxLock = queueLOCKED_UNMODIFIED; \
    }                                                  \
    taskEXIT_CRITICAL()

/* 解锁：cTxLock > 0 说明上锁期间有人写入，逐个唤醒读阻塞任务，最后复位为 UNLOCKED */
static void prvUnlockQueue( Queue_t * const pxQueue )
{
    taskENTER_CRITICAL();
    {
        int8_t cTxLock = pxQueue->cTxLock;
        while( cTxLock > queueLOCKED_UNMODIFIED )
        {
            if( !listLIST_IS_EMPTY( &( pxQueue->xTasksWaitingToReceive ) ) )
            {
                if( xTaskRemoveFromEventList(
                        &( pxQueue->xTasksWaitingToReceive ) ) != pdFALSE )
                {
                    vTaskMissedYield();   /* 有高优先级任务被唤醒，记下需要切换 */
                }
            }
            else
            {
                break;
            }
            --cTxLock;
        }
        pxQueue->cTxLock = queueUNLOCKED;
    }
    taskEXIT_CRITICAL();
    /* 后半段对称处理 cRxLock（上锁期间被读走消息 → 唤醒写阻塞任务） */
}
```

> ⚠️ 队列锁不是给"多任务读写同一个队列"用的互斥锁！多个任务同时调 `xQueueSend` 是安全的，队列内部用临界区保证原子性。队列锁保护的是"阻塞/唤醒"这个时间窗口的内核数据结构一致性，是内核实现细节，你写应用代码时感知不到它——但理解它，面试和排障时就是降维打击。

## 6. 队列集：一个任务监听 N 个队列

场景：一个显示任务要接收"按键队列"和"串口队列"的消息，怎么同时等两个队列？轮询两个队列会浪费 CPU，且无法精确阻塞。队列集就是答案（PDF p.265）：

- `xQueueCreateSet(uxEventQueueLength)`：创建队列集。本质是一个**存指针的队列**——项目大小是 `sizeof(Queue_t *)`，每个"消息"就是一条"哪个队列有货"的通知（PDF p.266）。
- `xQueueAddToSet(queue, set)`：把队列加进集合。要求该队列当前**没有消息**（有货的不能入会）。
- `xQueueSelectFromSet(set, xTicksToWait)`：阻塞等待，返回"有消息的队列"的句柄；拿到后再对那个队列正常 `xQueueReceive`。

教材 13.6 节实验把两个队列和一个二值信号量塞进一个队列集（PDF p.272~276），任务 1 按不同按键向不同队列发消息，任务 2 只管 `xQueueSelectFromSet`：

```c
/* start_task 里：建集、建队、入会 */
xQueueSet = xQueueCreateSet( QUEUESET_LENGTH );
xQueue1   = xQueueCreate( QUEUE_LENGTH, QUEUE_ITEM_SIZE );
xQueue2   = xQueueCreate( QUEUE_LENGTH, QUEUE_ITEM_SIZE );
xQueueAddToSet( xQueue1, xQueueSet );
xQueueAddToSet( xQueue2, xQueueSet );

/* task2：一次阻塞监听整个集合，哪个有货读哪个 */
void task2(void *pvParameters)
{
    QueueSetMemberHandle_t activate_member = NULL;
    uint32_t queue_recv = 0;

    while (1)
    {
        /* 阻塞直到集合中任一队列有消息 */
        activate_member = xQueueSelectFromSet( xQueueSet, portMAX_DELAY );

        if (activate_member == xQueue1)          /* 是队列 1 有货 */
        {
            xQueueReceive( activate_member, &queue_recv, portMAX_DELAY );
            printf("接收到来自 xQueue1 的消息: %d\r\n", queue_recv);
        }
        else if (activate_member == xQueue2)     /* 是队列 2 有货 */
        {
            xQueueReceive( activate_member, &queue_recv, portMAX_DELAY );
            printf("接收到来自 xQueue2 的消息: %d\r\n", queue_recv);
        }
    }
}
```

消息写入时，队列会向集合"上报"（发送一个自身指针）；读取方从集合里取到指针再取数据，天然知道去哪读。教材 13.7 节还用队列集模拟了事件标志位（两个队列分别代表"事件 0/事件 1"，都收到过就触发刷新，PDF p.277~282）——值得自己动手复现一次。

## 动手练习（约 20 分钟）

### 练习 8.1：队列消息传递实验

- 1️⃣ 在你的 FreeRTOS 分支工程里，按教材 13.3 节设计三个任务：start_task 建队列（长度 5、项目 1 字节）、task1 扫描按键把键值 `xQueueSend` 进队列、task2 `xQueueReceive` 收消息并点灯/刷屏。
- 2️⃣ 验证阻塞：把 task2 的接收改成 `portMAX_DELAY`，运行中观察 task2 是否完全让出 CPU（它阻塞期间 LED 闪烁任务照常跑）。再临时把超时改成 500 tick，确认超时后 task2 返回 pdFALSE 而不是卡死。
- 3️⃣ 验证写满阻塞：连按按键超过队列长度（5 次）不消费，观察 task1 是否被阻塞、串口/LCD 是否停摆——然后让 task2 恢复消费，任务自动恢复。对照第 4 节伪代码，指出 task1 阻塞时挂在哪个列表。
- 4️⃣ 验收标准：能回答"读空阻塞、写满阻塞、超时返回"三种情形下任务分别处于什么状态，以及 `uxMessagesWaiting` 的值怎么变。

### 练习 8.2：队列集实验

- 1️⃣ 按教材 13.6 节搭队列集实验：两个队列 + 一个二值信号量入集，task1 按按键向不同成员发送，task2 用 `xQueueSelectFromSet` 统一处理。
- 2️⃣ 思考并验证：为什么 `xQueueAddToSet` 要求入会队列必须为空？如果先向队列 1 发一条消息再加入集合会怎样（返回什么）？
- 3️⃣ 在 `prvNotifyQueueSetContainer` 附近打断点（queue.c），看消息写入时队列是如何"通知"集合的：集合队列里存的"消息"是什么？
- 4️⃣ 验收标准：能画出"队列 → 集合 → 消费任务"的数据流向图，并说明 `xQueueSelectFromSet` 返回值是什么类型、为什么能直接和 xQueue1 比较。

## 自测（答完再点答案）

### 随堂小测 1

Q1. 队列存储与读取的基本规则是？

- A. 后进先出，读取最近写入的项目
- B. 先进先出，写入队尾读取队头
- C. 随机存取，按项目编号读取
- D. 写入覆盖旧数据，读取最新数据

<details>
<summary>查看答案</summary>

B。队列采用 FIFO 缓冲：写入永远进队尾，读取永远出队头；同时支持写队头（SendToFront）和覆写（Overwrite，仅限长度 1）（PDF p.230）。

</details>

### 随堂小测 2

Q2. Queue_t 中记录"当前有多少条有效消息"的成员是？

- A. uxLength 队列长度字段
- B. uxItemSize 项目大小字段
- C. uxMessagesWaiting 非空闲项目数
- D. cTxLock 写入上锁计数器

<details>
<summary>查看答案</summary>

C。uxMessagesWaiting 是非空闲项目数，队列判空/判满、信号量计资源都靠它（PDF p.232）；信号量的"资源数"就是它。

</details>

### 随堂小测 3

Q3. xQueueSendFromISR 的 pxHigherPriorityTaskWoken 参数作用是？

- A. 指定中断的优先级等级
- B. 标记是否唤醒了高优先级任务需要切换
- C. 传递消息数据的接收缓冲区
- D. 设置队列的阻塞超时时间

<details>
<summary>查看答案</summary>

B。中断里不能阻塞，ISR 版 API 通过该指针输出"唤醒更高优先级任务"标志，中断末尾用 portYIELD_FROM_ISR 决定是否挂起 PendSV 完成切换（PDF p.251~255）。

</details>

### 随堂小测 4

Q4. 队列锁（prvLockQueue）存在的意义是？

- A. 防止多个任务同时读写同一个队列
- B. 保护任务阻塞与中断唤醒之间的竞态窗口
- C. 让队列的读写操作整体原子化
- D. 提高队列存储空间的利用率

<details>
<summary>查看答案</summary>

B。任务即将阻塞、还未挂进阻塞列表的窗口期，中断写入无法唤醒它；上锁期间写入只累加锁计数，解锁时统一处理阻塞列表，避免唤醒丢失（PDF p.258）。

</details>

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 13 章（PDF p.230~283）——本课全部依据，13.1 节的图示（创建/写入/读取）值得反复看
- 🌐 [FreeRTOS 官方队列文档](https://www.freertos.org/Embedded-RTOS-Queues.html)——官方 API 与队列语义讲解
- 📕 [Mastering the FreeRTOS™ Real Time Kernel](https://www.freertos.org/Documentation/RTOS_book.html) 第 5 章（Queue Management）——官方书对队列阻塞语义的权威解释

## 下一步

队列讲完，你已握有 FreeRTOS 通信体系的钥匙。下一课预告：第 9 课——信号量。你会发现二值信号量就是"长度 1 的队列"，而优先级翻转、优先级继承这些经典戏码，全靠第 2 节那个联合体结构撑起来。

| [← 上一课](/my-blog/posts/freertos/0007-task-switching-pendsv/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0009-semaphores/) |