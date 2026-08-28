---
title: 信号量
published: 2026-08-20
description: FreeRTOS 课程第 9 课：信号量是任务间同步与资源管理的经典机制——二值/计数型信号量、优先级翻转、互斥量与递归互斥量的原理、源码与实验。
tags: [FreeRTOS, 嵌入式, RTOS, 信号量, 互斥量, 优先级翻转]
category: FreeRTOS
draft: false
prevTitle: 软件定时器
prevSlug: "freertos/0010-software-timers"
nextTitle: 队列
nextSlug: "freertos/0008-queues"
---

# 信号量

这是 FreeRTOS 系列课程笔记的第 9 课：同步与互斥——二值/计数型信号量、优先级翻转、互斥量与递归互斥量。**本课目标：**信号量是任务间同步与资源管理的经典机制（教材第 14 章，PDF p.284~325）。学完你能说清：四种信号量各自是什么、什么时候用哪个；二值信号量为什么会导致优先级翻转、互斥量为什么能缓解它；以及中断如何安全地"通知"任务。这一课你会反复看到上一课的影子——信号量全家桶都是队列的变体。

---

## 1. 信号量是什么：队列的特例

信号量解决两类问题（PDF p.284）：**同步**（一个任务等另一个任务/中断完成某事再继续）和**有序访问**（多任务访问共享资源时排队）。教材用停车场打比方：空车位数量 = 信号量资源数，停车 = 获取（Take），开走 = 释放（Give）。

从源码看，信号量就是队列——上节课那个联合体 `u` 就是为它准备的（PDF p.232）：

| 信号量类型 | 本质 | 创建函数实际做的事 |
| --- | --- | --- |
| 二值信号量 | 队列长度为 1、项目大小为 0 的队列 | `xQueueGenericCreate(1, 0, queueQUEUE_TYPE_BINARY_SEMAPHORE)` |
| 计数型信号量 | 队列长度 = 最大资源数的队列 | `xQueueGenericCreate(uxMaxCount, 0, COUNTING)`，再设 `uxMessagesWaiting = uxInitialCount` |
| 互斥信号量 | 带优先级继承的二值信号量 | 创建后额外记录持有者（`xMutexHolder`） |
| 递归互斥信号量 | 持有者可重复获取的互斥量 | 额外维护 `uxRecursiveCallCount` 计数 |

所以信号量的"资源数"就是 `uxMessagesWaiting`，Take 就是"等队列有货"，Give 就是"往队列塞一个空消息"。下面逐个看。

---

## 2. 二值信号量：中断与任务的"传令兵"

二值信号量只有 0/1 两种状态，典型用途是**任务同步**：中断里 `xSemaphoreGiveFromISR`，任务里 `xSemaphoreTake` 阻塞等待——中断一发生，任务立刻被唤醒。API 全部是对队列函数的包装（PDF p.285~295）：

```c
/* 创建：就是创建一个长度 1、项目大小 0 的队列 */
#define xSemaphoreCreateBinary()                                          \
    xQueueGenericCreate( ( UBaseType_t ) 1,                               \
                         semSEMAPHORE_QUEUE_ITEM_LENGTH,                  \
                         queueQUEUE_TYPE_BINARY_SEMAPHORE )

/* 获取：uxMessagesWaiting > 0 则减 1 成功返回，否则阻塞 xBlockTime */
#define xSemaphoreTake( xSemaphore, xBlockTime )   \
    xQueueSemaphoreTake( ( xSemaphore ), ( xBlockTime ) )

/* 释放：往队列塞一个空消息，uxMessagesWaiting 加 1 */
#define xSemaphoreGive( xSemaphore )                \
    xQueueGenericSend( ( QueueHandle_t ) ( xSemaphore ),  \
                       NULL, semGIVE_BLOCK_TIME, queueSEND_TO_BACK )

/* 中断里释放：无阻塞，附"唤醒标志"输出 */
#define xSemaphoreGiveFromISR( xSemaphore, pxHigherPriorityTaskWoken ) \
    xQueueGiveFromISR( ( QueueHandle_t ) ( xSemaphore ),               \
                       ( pxHigherPriorityTaskWoken ) )
```

教材 14.3 节实验是标准模板（PDF p.297~299）：task1 扫按键，按 KEY0 就 `xSemaphoreGive`；task2 `xSemaphoreTake` 阻塞等待，拿到就刷屏。把 task1 换成中断就是"中断同步任务"的完整形态：

```c
/* task2：阻塞等信号量，拿到才干活 */
void task2(void *pvParameters)
{
    uint32_t task2_num = 0;

    while (1)
    {
        xSemaphoreTake(BinarySemaphore, portMAX_DELAY);  /* 没信号就睡觉 */
        lcd_fill(6, 131, 233, 313, lcd_discolor[++task2_num % 11]);
    }
}

/* 外部中断里：给信号，唤醒 task2 */
void EXTI0_IRQHandler(void)
{
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;

    if (EXTI_GetITStatus(EXTI_Line0) != RESET)
    {
        EXTI_ClearITPendingBit(EXTI_Line0);
        xSemaphoreGiveFromISR(BinarySemaphore, &xHigherPriorityTaskWoken);
    }
    portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
}
```

> 💡 同步语义的要点：二值信号量的 Give 和 Take 不必成对——连续给两次，任务只被唤醒一次（第二次给时信号量已满，直接丢弃）。它表达的是"事件发生过"这个事实，不是"事件次数"。要计数，用计数型信号量。

---

## 3. 计数型信号量：数资源、数事件

创建函数多了两个参数（PDF p.301~302）：

```c
#define xSemaphoreCreateCounting( uxMaxCount, uxInitialCount )  \
    xQueueCreateCountingSemaphore( ( uxMaxCount ), ( uxInitialCount ) )

QueueHandle_t xQueueCreateCountingSemaphore( const UBaseType_t uxMaxCount,
                                             const UBaseType_t uxInitialCount )
{
    if( ( uxMaxCount != 0 ) && ( uxInitialCount <= uxMaxCount ) )
    {
        /* 队列长度 = 最大资源数；初始资源数直接写进 uxMessagesWaiting */
        xHandle = xQueueGenericCreate( uxMaxCount,
                                       queueSEMAPHORE_QUEUE_ITEM_LENGTH,
                                       queueQUEUE_TYPE_COUNTING_SEMAPHORE );
        if( xHandle != NULL )
        {
            ( ( Queue_t * ) xHandle )->uxMessagesWaiting = uxInitialCount;
        }
    }
    return xHandle;
}
```

两种经典用法（PDF p.300~301）：

- **事件计数**：初始 0，每次事件 Give +1，任务 Take 消费——事件比任务快也不丢，攒着慢慢处理。
- **资源管理**：初始 = 资源总数，每个任务 Take 前"占坑"、用完 Give 归还——比如 3 个 DMA 通道，最多 3 个任务同时用。

教材 14.5 节实验：task1 连按 5 次 KEY0（`xSemaphoreGive` 五次），task2 每 1000 tick 才 `xSemaphoreTake` 一次并刷屏（PDF p.304~306）——串口/LCD 上你会看到资源数先涨到 5，再被 task2 每 1000 tick 吃掉一个。这个"积攒-消费"节奏就是事件计数的直观演示。

---

## 4. 优先级翻转：三个任务的一出悲剧

二值/计数型信号量有个著名副作用——**优先级翻转**（PDF p.307~308）。场景三个任务：H（最高）、M（中等）、L（最低），共享一个被信号量保护的资源：

1. 任务 L 正在运行，拿到信号量开始访问共享资源。
2. 任务 H 就绪，抢占 L，也想拿信号量——但信号量在 L 手里，H 只能阻塞等待。
3. 此时任务 M 就绪（它不需要信号量），把 L 抢占——L 被堵住，迟迟无法释放信号量。
4. 结果：优先级最高的 H 要等 M 跑完、再等 L 跑完才能拿到资源。最高优先级反而最后执行！

教材 14.7 节实验把这一幕演给你看（PDF p.309~312）：

```c
/* 三个任务优先级：task1(最高) > task2(中) > task3(低) */
void task1(void *pvParameters)      /* 高优先级：等信号量 */
{
    vTaskDelay(500);                /* 让低优先级先拿到信号量 */
    while (1)
    {
        printf("task1 ready to take semaphore\r\n");
        xSemaphoreTake(Semaphore, portMAX_DELAY);
        printf("task1 has taked semaphore\r\n");
        printf("task1 give semaphore\r\n");
        xSemaphoreGive(Semaphore);
        vTaskDelay(100);
    }
}

void task2(void *pvParameters)      /* 中优先级：纯捣乱，不用信号量 */
{
    uint32_t task2_num = 0;
    vTaskDelay(200);
    while (1)
    {
        for (task2_num=0; task2_num<5; task2_num++)
        {
            printf("task2 running\r\n");
            delay_ms(100);          /* 模拟运行，不触发任务调度 */
        }
        vTaskDelay(1000);
    }
}

void task3(void *pvParameters)      /* 低优先级：先拿信号量慢慢跑 */
{
    uint32_t task3_num = 0;
    while (1)
    {
        printf("task3 ready to take semaphore\r\n");
        xSemaphoreTake(Semaphore, portMAX_DELAY);
        for (task3_num=0; task3_num<5; task3_num++)
        {
            printf("task3 running\r\n");
            delay_ms(100);
        }
        printf("task3 give semaphore\r\n");
        xSemaphoreGive(Semaphore);
        vTaskDelay(1000);
    }
}
```

运行顺序你会看到：task3 拿信号量 → task2 抢占 → task1 抢占 task2 后拿不到信号量被阻塞 → task2 继续跑完 → task3 跑完释放 → task1 才拿到。串口输出顺序印证了"最高优先级最后才运行"（PDF p.312）。

> ⚠️ 优先级翻转在抢占式 RTOS 里是"合法的行为"但危害极大：它把高优先级任务的实时性拖成"取决于中优先级任务的脸色"，可能引发超时、丢数据甚至看门狗复位。二值信号量适合"同步"（第 2 节场景），**保护共享资源请用互斥信号量**——下一节就是它的解药。

---

## 5. 互斥信号量：优先级继承的解药

互斥信号量 = 拥有**优先级继承**机制的二值信号量（PDF p.313）。优先级继承的规则：当高优先级任务 H 因获取被 L 持有的互斥量而阻塞时，**L 的优先级被临时提升到与 H 相同**；L 释放互斥量后恢复原优先级。这样 M 就无法再插队——因为 L 此刻的优先级比 M 高，H 的等待时间从"M+L"缩短为"只有 L"。

源码佐证：`xQueueSemaphoreTake()` 里对互斥量类型的队列会调用 `xTaskPriorityInherit(xMutexHolder)`（PDF p.289）；`xSemaphoreGive` 释放时会检查并恢复持有者的原始优先级（`uxBasePriority`，创建任务时就存好了，第 6 课见过）。创建互斥量时还会额外初始化持有者并"预先给一次"，保证初始有资源（PDF p.314）：

```c
#define xSemaphoreCreateMutex()   xQueueCreateMutex( queueQUEUE_TYPE_MUTEX )

static void prvInitialiseMutex( Queue_t * pxNewQueue )
{
    if( pxNewQueue != NULL )
    {
        pxNewQueue->u.xSemaphore.xMutexHolder = NULL;   /* 持有者清空 */
        pxNewQueue->uxQueueType = queueQUEUE_IS_MUTEX;  /* 标记互斥类型 */
        pxNewQueue->u.xSemaphore.uxRecursiveCallCount = 0;
        /* 预置一个资源：新互斥量创建后是"有货"的 */
        ( void ) xQueueGenericSend( pxNewQueue, NULL, 0, queueSEND_TO_BACK );
    }
}
```

教材 14.9 节实验就是把 14.7 节的计数型信号量换成互斥信号量，其余代码几乎不变（PDF p.316~319）。串口输出对比：task1 阻塞后，task3 的优先级被提到 task1 水平，**task2 抢不动了**——task3 一口气跑完释放，task1 立刻接手。同一套任务代码，换一个创建函数，行为天差地别。

两个硬性限制（PDF p.313）：互斥信号量**不能用于中断**——中断不是任务、没有优先级可继承；且中断里不能阻塞等待。递归互斥量同理。

> 💡 注意措辞：优先级继承只是"缓解"优先级翻转，不是"消除"。它把影响从"所有中间优先级任务"缩小为"持锁者本人"，但持锁者若被更高优先级任务抢占，H 还是要等。真正的根治是在设计上缩短持锁时间、避免高优先级任务等锁。教材原话：实时应用应在设计之初就要避免优先级翻转的发生（PDF p.313）。

---

## 6. 递归互斥信号量：可以重复上锁的锁

场景：任务 A 的函数 f1 获取互斥量，f1 又调用 f2，f2 也要获取同一个互斥量——普通互斥量会把自己锁死（持有者再次 Take 会阻塞）。递归互斥信号量解决这个问题：**持有者可以重复获取**，内部用 `uxRecursiveCallCount` 记录获取次数，释放次数必须等于获取次数才算真正释放（PDF p.320~323）。

```c
#define xSemaphoreCreateRecursiveMutex()  xQueueCreateMutex( queueQUEUE_TYPE_RECURSIVE_MUTEX )

/* 获取：持有者本人重复获取直接计数 +1，不阻塞 */
BaseType_t xQueueTakeMutexRecursive( QueueHandle_t xMutex, TickType_t xTicksToWait )
{
    if( pxMutex->u.xSemaphore.xMutexHolder == xTaskGetCurrentTaskHandle() )
    {
        ( pxMutex->u.xSemaphore.uxRecursiveCallCount )++;  /* 再取一次，计数加一 */
        xReturn = pdPASS;
    }
    else
    {
        xReturn = xQueueSemaphoreTake( pxMutex, xTicksToWait );  /* 非持有者：正常拿 */
        if( xReturn != pdFAIL )
        {
            ( pxMutex->u.xSemaphore.uxRecursiveCallCount )++;
        }
    }
    return xReturn;
}

/* 释放：每 Give 一次计数减一，减到 0 才真正释放给其他任务 */
BaseType_t xQueueGiveMutexRecursive( QueueHandle_t xMutex )
{
    if( pxMutex->u.xSemaphore.xMutexHolder == xTaskGetCurrentTaskHandle() )
    {
        ( pxMutex->u.xSemaphore.uxRecursiveCallCount )--;
        if( pxMutex->u.xSemaphore.uxRecursiveCallCount == 0 )
        {
            ( void ) xQueueGenericSend( pxMutex, NULL,
                                        queueMUTEX_GIVE_BLOCK_TIME,
                                        queueSEND_TO_BACK );
        }
        xReturn = pdPASS;
    }
    else
    {
        xReturn = pdFAIL;   /* 非持有者释放 = 非法操作 */
    }
    return xReturn;
}
```

注意配套 API 不同名：`xSemaphoreTakeRecursive()` / `xSemaphoreGiveRecursive()`，别拿普通 Take/Give 混用。它也带优先级继承、也不能用于中断。使用场景比较窄（函数递归嵌套、可重入模块），了解机制即可，不必特意做实验。

---

## 动手练习

### 练习 9.1：二值信号量中断同步实验

- 1️⃣ 在你的 FreeRTOS 分支工程里，仿照第 2 节：task2 `xSemaphoreTake(BinarySemaphore, portMAX_DELAY)` 阻塞等信号，把按键扫描任务换成"中断给信号"（用探索者的一个外部中断或定时器中断调用 `xSemaphoreGiveFromISR`）。
- 2️⃣ 验证同步语义：连续快速触发两次中断，LCD 只刷新一次（信号量满时 Give 被丢弃）；把 `xSemaphoreTakeFromISR` 也加进中断里读一下资源，观察计数变化。
- 3️⃣ 在 Watch 窗口盯着二值信号量句柄指向的 `uxMessagesWaiting`：中断触发前/后、task2 Take 后，它分别在什么值？和"队列长度为 1"的认知对照。
- 4️⃣ 验收标准：能画出"中断 → GiveFromISR → 唤醒 task2 → Take"的时序，并解释 `pxHigherPriorityTaskWoken` 在整个链路里的作用。

### 练习 9.2：优先级翻转 vs 互斥量对比实验

- 1️⃣ 把第 4 节的三个任务代码搬进工程（task1 高、task2 中、task3 低），先用 `xSemaphoreCreateCounting(1, 1)` 创建信号量，下载运行，记录串口输出顺序——确认出现优先级翻转（最高优先级最后运行）。
- 2️⃣ 只改一行：换成 `xSemaphoreCreateMutex()`，重新下载运行，对比串口输出。任务执行顺序哪里变了？为什么？
- 3️⃣ 在 `xTaskPriorityInherit()`（tasks.c）打断点，观察 task1 阻塞时，task3 的 `uxPriority` 和 `uxBasePriority` 如何被临时改变、释放后又如何恢复。
- 4️⃣ 验收标准：能用一张时间轴画出两种场景下三个任务的运行区间，并说出互斥量"临时提升持有者优先级"这一步发生在哪个函数里。

---

## 自测

### 随堂小测 1

二值信号量在 FreeRTOS 源码中的本质是？

- A. 一个长度为 1 的特殊队列
- B. 一个独立的计数器结构体
- C. 一个受保护的全局变量
- D. 一个硬件定时器的中断标志

<details>
<summary>查看答案</summary>

A。xSemaphoreCreateBinary 实际调用 xQueueGenericCreate(1, 0, BINARY)——长度为 1、项目大小为 0 的队列，uxMessagesWaiting 即资源数（PDF p.285）。
</details>

### 随堂小测 2

计数型信号量的初始资源数存储在哪个成员？

- A. uxLength 队列长度字段
- B. uxMessagesWaiting 非空闲项目数
- C. uxItemSize 项目大小字段
- D. uxRecursiveCallCount 递归计数

<details>
<summary>查看答案</summary>

B。xQueueCreateCountingSemaphore 创建队列后直接写 uxMessagesWaiting = uxInitialCount（PDF p.302），Give/Take 就是对这个数的加减。
</details>

### 随堂小测 3

优先级继承机制的具体行为是？

- A. 高优先级任务主动降低自己的优先级
- B. 高优先级任务临时提升持锁低优先级任务的优先级
- C. 低优先级任务复制高优先级任务的代码段
- D. 调度器按任务年龄轮流分配优先级

<details>
<summary>查看答案</summary>

B。H 因等待被 L 持有的互斥量而阻塞时，L 被临时提升到 H 的优先级（xTaskPriorityInherit），释放后恢复 uxBasePriority，从而压缩 H 的等待时间（PDF p.313）。
</details>

### 随堂小测 4

递归互斥信号量真正释放给其他任务的条件是？

- A. 持有者调用一次 xSemaphoreGiveRecursive
- B. 释放次数与获取次数相等且均为持有者
- C. 任意任务调用一次 xSemaphoreGive
- D. 持有者任务被删除或挂起

<details>
<summary>查看答案</summary>

B。uxRecursiveCallCount 记录获取次数，GiveRecursive 每次减一，减到 0 才真正把资源交还（PDF p.322）；非持有者释放直接返回 pdFAIL。
</details>

---

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 14 章（PDF p.284~325）——本课全部依据，14.6 节的优先级翻转示意图值得反复对照实验现象
- 🌐 [FreeRTOS 官方信号量文档](https://www.freertos.org/Embedded-RTOS-Binary-Semaphores.html)——二值/计数/互斥/递归四种信号量的官方讲解与示例
- 📕 [Mastering the FreeRTOS™ Real Time Kernel](https://www.freertos.org/Documentation/RTOS_book.html) 第 6 章（Semaphores & Mutexes）——官方书对优先级翻转与继承的深入论述

---

## 下一步

到这里，任务间通信的两大支柱（队列 + 信号量）已经立起来了。下一课预告：第 10 课——软件定时器，看看 FreeRTOS 怎么用"一个定时器服务任务"统一管理所有定时器，以及它和硬件定时器的区别。

| [← 上一课](/my-blog/posts/freertos/0008-queues/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0010-software-timers/) |
| --- | --- | --- |