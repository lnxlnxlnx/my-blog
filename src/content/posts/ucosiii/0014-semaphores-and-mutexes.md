---
title: 信号量与互斥量
published: 2026-08-26
description: 二值/计数/互斥三种信号量、优先级翻转与优先级继承——从"队列变体"到"结构体对象"，对比 UCOS 与 FreeRTOS 两种同步设计哲学。
tags: [UCOSIII, 嵌入式, RTOS, 信号量, 互斥量, 优先级继承]
category: UCOSIII
draft: false
prevTitle: 消息队列与事件标志
prevSlug: "ucosiii/0015-queues-and-event-flags"
nextTitle: 任务管理 API 实战
nextSlug: "ucosiii/0013-task-api-practice"
---

# 信号量与互斥量

二值/计数/互斥三种信号量、优先级翻转与优先级继承——从"队列变体"到"结构体对象"。**本课目标：**FreeRTOS 课里你已经见过信号量全家桶，这一课看 µC/OS-III 的版本（教材第 11/12 章，(PDF p.196~281)）。学完你能说清：µC/OS-III 的信号量为什么是"独立的结构体对象"而不是"队列变体"；`OSSemPend` 的 timeout=0 到底是什么意思；优先级翻转在 UCOS 实验里怎么复现；以及互斥信号量的优先级继承是如何用"位图跟踪所有权"实现的。

## 1. 信号量是结构体对象，不是队列变体

信号量解决两类问题（教材 11.1 节）：**同步**（一个任务等另一个任务/中断做完某件事再继续）和**有序访问**（多个任务排队访问共享资源）。教材用停车场打比方：空车位数量 = 信号量的资源数，停车 = 获取信号量，开走 = 释放信号量；资源不够时要么走人（获取失败），要么排队等（任务阻塞）。

但 µC/OS-III 和 FreeRTOS 的**实现哲学完全不同**：FreeRTOS 里信号量是"长度为 1、项目大小为 0 的队列"，一个 `Queue_t` 结构通吃；而 µC/OS-III 里信号量是**一个独立的内核对象**——`OS_SEM` 结构体，定义在 os.h，二值信号量与计数型信号量共用这一个结构体：

```c
/* os.h 中的信号量结构体（教材 11.2.1 节，简化版） */
struct os_sem
{
    OS_OBJ_TYPE   Type;        /* 对象类型，创建时设为 OS_OBJ_TYPE_SEM */
    CPU_CHAR     *NamePtr;     /* 信号量名字，方便调试 */
    OS_PEND_LIST  PendList;    /* 挂起等待链表：拿不到资源被挂起的任务排在这里 */
    OS_SEM_CTR    Ctr;         /* 资源计数器：还有几个资源，灵魂成员 */
#if (OS_CFG_TS_EN > 0u)
    CPU_TS        TS;          /* 时间戳，第 16 课展开 */
#endif
};
```

两个最重要的成员：`PendList`（等待任务链表）和 `Ctr`（资源计数器）。`Ctr > 0` 就有资源，Pend 直接减一；`Ctr == 0` 没资源，Pend 的任务被挂到 `PendList` 上睡觉。这个"计数器 + 等待链表"的结构，和 FreeRTOS 的"uxMessagesWaiting + 两个事件列表"是一一对应的——**本质相同，形式不同**。UCOS 把语义写在明面上，FreeRTOS 用联合体省代码，两种都是好设计。

> 💡 对照 FreeRTOS 第 9 课：FreeRTOS 的 `xSemaphoreCreateBinary()` 展开就是 `xQueueGenericCreate(1, 0, ...)`，资源数存在 `uxMessagesWaiting`；而 UCOS 的 `OSSemCreate()` 直接初始化一个 `OS_SEM` 对象。理解这个差异很重要：它意味着 UCOS 的信号量没有"队列"那些通用能力，但它更轻、语义更直白——UCOS 的队列和信号量是两类独立对象。

## 2. 二值信号量：一把钥匙

二值信号量只有"有资源 / 无资源"两种状态（教材 11.2 节）——资源数只能是 0 或 1，相当于只有一把钥匙的锁。经典用途是**任务同步**和**互斥访问**。API 三个核心函数：

```c
/* 创建信号量：cnt 是资源数初始值，cnt=1 即二值信号量 */
void OSSemCreate(OS_SEM *p_sem, CPU_CHAR *p_name, OS_SEM_CTR cnt, OS_ERR *p_err);

/* 获取（pend）信号量：返回更新后的资源数 */
OS_SEM_CTR OSSemPend(OS_SEM *p_sem, OS_TICK timeout, OS_OPT opt,
                     CPU_TS *p_ts, OS_ERR *p_err);

/* 释放（post）信号量：返回更新后的资源数 */
OS_SEM_CTR OSSemPost(OS_SEM *p_sem, OS_OPT opt, OS_ERR *p_err);
```

两个容易踩坑的细节（都和 FreeRTOS 习惯不同）：

- **timeout=0 是"无限等待"**！`OSSemPend` 的 timeout 参数传 0 且 opt 为 `OS_OPT_PEND_BLOCKING` 时，任务会一直等到资源出现（等价于 FreeRTOS 的 `portMAX_DELAY`）。想要"不等待、立刻返回"，用 `OS_OPT_PEND_NON_BLOCKING`，此时没资源直接返回错误码 `OS_ERR_PEND_WOULD_BLOCK`。超时未等到则返回 `OS_ERR_TIMEOUT`。
- **每个 API 都要传错误码指针** `OS_ERR *p_err`，创建/获取/释放后都要检查 `err == OS_ERR_NONE`。不像 FreeRTOS 返回 pdPASS/pdFAIL，UCOS 靠错误码区分十几种失败原因（如 `OS_ERR_SEM_OVF` 资源数溢出）。

教材 11.3 节先演示了"不用信号量"的后果：task1 和 task2 同时 `printf("This is taskX!\r\n")` 抢串口，输出会互相穿插变成乱码（共享资源冲突）。11.4 节加二值信号量后：访问串口前 Pend、访问完立即 Post，输出变得整整齐齐：

```c
OS_SEM binary_sem;   /* 定义一个信号量对象（结构体变量） */

/* start_task 中创建：资源数初始为 1，即"一把钥匙" */
OSSemCreate((OS_SEM *)&binary_sem, (CPU_CHAR *)"binary sem",
            (OS_SEM_CTR)1, (OS_ERR *)&err);

/* task1：先拿钥匙再进"房间"（访问串口），用完立刻还钥匙 */
void task1(void *p_arg)
{
    OS_ERR err;

    while (1)
    {
        /* timeout=0 + BLOCKING = 无限等待；没钥匙就一直挂起 */
        OSSemPend((OS_SEM *)&binary_sem, (OS_TICK)0,
                  (OS_OPT)OS_OPT_PEND_BLOCKING,
                  (CPU_TS *)0, (OS_ERR *)&err);

        printf("This is task1!\r\n");   /* 访问共享资源：串口 */

        OSSemPost((OS_SEM *)&binary_sem,   /* 释放：归还钥匙 */
                  (OS_OPT)OS_OPT_POST_1, (OS_ERR *)&err);
    }
}
```

## 3. 计数型信号量：数资源的计数器

计数型信号量（教材 11.5 节）和二值信号量共用同一套 API，唯一的区别是 `Ctr` 的取值：不限于 0/1，而是 0 ~ 最大值（`OS_SEM_CTR` 无符号整数）。**Post 一次资源数 +1（直到溢出返回 `OS_ERR_SEM_OVF`），Pend 一次 -1（直到 0）**。两种经典用法：

- **事件计数**：初始 0，每次事件 Post +1，任务 Pend 消费——事件来得比处理快也不丢，攒着慢慢处理。
- **资源管理**：初始 = 资源总数（比如 3 个 DMA 通道），任务拿资源前 Pend"占坑"，用完 Post 归还。

教材 11.6 节实验把"积攒-消费"节奏演给你看：task1 按一次 KEY0 就 Post 一次，连按 5 次资源数涨到 5；task2 每 1000 ticks 才 Pend 一次，串口/LCD 上能看到资源数先攒、后逐个被吃掉：

```c
OS_SEM count_sem;   /* 计数型信号量，与二值共用 OS_SEM 类型 */

/* start_task：初始资源数 0 */
OSSemCreate((OS_SEM *)&count_sem, (CPU_CHAR *)"count sem",
            (OS_SEM_CTR)0, (OS_ERR *)&err);

/* task1：按 KEY0 释放一个资源，连按 5 次 = 资源数涨到 5 */
void task1(void *p_arg)
{
    OS_ERR err;
    uint8_t key;

    while (1)
    {
        key = key_scan(0);
        if (key == KEY0_PRES)
        {
            OSSemPost((OS_SEM *)&count_sem, (OS_OPT)OS_OPT_POST_1, &err);
        }
        OSTimeDly(10, OS_OPT_TIME_DLY, &err);   /* 每 10 tick 扫一次键 */
    }
}

/* task2：每 1000 tick 才消费一个资源 */
void task2(void *p_arg)
{
    OS_ERR err;

    while (1)
    {
        OSSemPend((OS_SEM *)&count_sem, (OS_TICK)0,
                  (OS_OPT)OS_OPT_PEND_BLOCKING, (CPU_TS *)0, &err);
        lcd_fill(6, 131, 233, 313, lcd_discolor[++task2_num % 11]);
        OSTimeDly(1000, OS_OPT_TIME_DLY, &err);
    }
}
```

## 4. 优先级翻转：二值/计数信号量的"原罪"

二值信号量和计数型信号量都有个著名副作用——**优先级翻转**（教材 11.7 节）。FreeRTOS 课你已经看过现象，这里用 UCOS 的术语再走一遍原理。三个任务：H 最高、M 中等、L 最低，共享一个被信号量保护的资源：

1. 任务 L 正在运行，成功获取信号量，开始访问共享资源。
2. 任务 H 就绪，抢占 L 运行；H 也想拿信号量——但资源在 L 手里，H 被挂起到 `PendList` 等待。
3. 此时任务 M 就绪（它不需要信号量），把 L 抢占——L 被堵住，迟迟无法释放信号量。
4. 结果：最高优先级的 H 要等 M 跑完、再等 L 跑完，**最高优先级反而最后执行**。

教材 11.8 节实验把这一幕演出来。关键点是 start_task 里先 `OSSchedRoundRobinCfg(OS_TRUE, 0, &err)` 关闭时间片轮转，让纯优先级抢占主导一切；task1 延时 500 ticks 再 Pend（给 task3 留出拿锁时间），task2 延时 200 ticks 后开始"搅局"：

```c
/* 优先级：task1(最高) > task2(中) > task3(低)，数值越小优先级越高 */
OSSemCreate((OS_SEM *)&sem, (CPU_CHAR *)"sem", (OS_SEM_CTR)1, &err);

void task1(void *p_arg)      /* 高优先级：想拿锁，却被堵到最后 */
{
    OS_ERR err;
    OSTimeDly(500, OS_OPT_TIME_DLY, &err);      /* 先让 task3 把锁拿走 */
    OSSemPend((OS_SEM *)&sem, (OS_TICK)0, OS_OPT_PEND_BLOCKING,
              (CPU_TS *)0, &err);
    printf("task1 has taked semaphore\r\n");
    OSSemPost((OS_SEM *)&sem, OS_OPT_POST_1, &err);
    OSTimeDly(100, OS_OPT_TIME_DLY, &err);
}

void task2(void *p_arg)      /* 中优先级：不碰信号量，纯"搅局" */
{
    OS_ERR err;
    uint32_t num;
    OSTimeDly(200, OS_OPT_TIME_DLY, &err);
    for (num = 0; num < 5; num++)
    {
        printf("task2 running\r\n");
        delay_ms(100);        /* 模拟长时间运行，不触发任务调度 */
    }
    OSTimeDly(1000, OS_OPT_TIME_DLY, &err);
}

void task3(void *p_arg)      /* 低优先级：先拿锁，慢慢跑 */
{
    OS_ERR err;
    uint32_t num;
    OSSemPend((OS_SEM *)&sem, (OS_TICK)0, OS_OPT_PEND_BLOCKING,
              (CPU_TS *)0, &err);
    for (num = 0; num < 5; num++)
    {
        printf("task3 running\r\n");
        delay_ms(100);
    }
    OSSemPost((OS_SEM *)&sem, OS_OPT_POST_1, &err);
    OSTimeDly(1000, OS_OPT_TIME_DLY, &err);
}
```

串口输出顺序你会看到：task3 拿锁 → task2 抢占跑完 → task3 跑完释放 → task1 才拿到。优先级最高的任务最后才运行（教材 11.8.3 节）。

> ⚠️ 优先级翻转在抢占式 RTOS 里是"合法行为"，但危害极大：它把高优先级任务的实时性拖成了"取决于中优先级任务的脸色"，可能引发超时、丢数据甚至看门狗复位。二值信号量适合做**同步**（第 2 节场景），**保护共享资源请用互斥信号量**——它就是为治这个病而生的。

## 5. 互斥信号量：带优先级继承的锁

互斥信号量（教材 12.1 节）= 拥有**优先级继承**机制的二值信号量。规则一句话：**当高优先级任务 H 因获取被 L 持有的互斥量而阻塞时，L 的优先级被临时提升到与 H 相同**；L 释放互斥量后恢复原优先级。这样 M 就插不了队——因为此刻 L 的优先级比 M 高，H 的等待时间从"M + L"缩短为"只有 L"。三个 API：

```c
void OSMutexCreate(OS_MUTEX *p_mutex, CPU_CHAR *p_name, OS_ERR *p_err);
void OSMutexPend(OS_MUTEX *p_mutex, OS_TICK timeout, OS_OPT opt,
                 CPU_TS *p_ts, OS_ERR *p_err);
void OSMutexPost(OS_MUTEX *p_mutex, OS_OPT opt, OS_ERR *p_err);
```

OS_MUTEX 结构体相比 OS_SEM 多了三个"所有权"相关成员（教材 12.1 节）：

- `OwnerTCBPtr`：指向当前持有互斥量的任务的 TCB——锁属于谁，一目了然。
- `OwnerNestingCtr`：持有递归计数器。UCOS 的互斥量**内建递归能力**：同一个任务可以重复获取同一个互斥量（返回 `OS_ERR_MUTEX_OWNER` 之外……不，重复获取是合法的），但要释放相同次数才能真正让出；非持有者释放会得到 `OS_ERR_MUTEX_NOT_OWNER`。
- `MutexGrpNextPtr`：把互斥量挂进持有者的"互斥量组"。任务 TCB 里有一张**互斥量组位图（OS_MUTEX_GRP）**，记录这个任务拥有哪些互斥量——这是 UCOS 特有的所有权跟踪机制：释放互斥量时，内核通过位图知道该任务还持有多少个互斥量，决定优先级要不要恢复、恢复到多少。

> 💡 对照 FreeRTOS 第 9 课：FreeRTOS 的优先级继承靠 `xTaskPriorityInherit()` 直接改持有者的 `uxPriority`，并靠 `uxBasePriority` 记住"原始优先级"；UCOS 用位图记录每个任务持有哪些互斥量，实现同样目的但信息更全——一个任务同时持有 3 个互斥量、被 3 个不同优先级的任务等待时，位图能精确算出该提升到哪一级。这也是"位图"思想在内核里第二次登场（第一次是就绪表）。

教材 12.4 节实验就是"优化优先级翻转"：把 11.8 节实验代码里三处调用换成互斥量版本（`OSSemCreate` → `OSMutexCreate`，`OSSemPend` → `OSMutexPend`，`OSSemPost` → `OSMutexPost`），其余一行不改：

```c
OS_MUTEX mutex;   /* 互斥信号量对象 */

/* start_task：与 11.8 唯一的不同就这三行 */
OSMutexCreate((OS_MUTEX *)&mutex, (CPU_CHAR *)"mutex", (OS_ERR *)&err);

/* task3（低优先级）：先拿到互斥量 */
OSMutexPend((OS_MUTEX *)&mutex, (OS_TICK)0, (OS_OPT)OS_OPT_PEND_BLOCKING,
            (CPU_TS *)0, (OS_ERR *)&err);
printf("task3 runing\r\n");
delay_ms(100);   /* ……模拟访问共享资源 */
OSMutexPost((OS_MUTEX *)&mutex, (OS_OPT)OS_OPT_POST_NONE, (OS_ERR *)&err);

/* task1（高优先级）Pend 时，task3 被临时提升到 task1 的优先级，
 * task2 抢不动 task3，task3 一口气跑完释放，task1 立刻拿到锁 */
```

对比两轮串口输出：翻转版 task1 等得又长又乱（中间穿插 task2）；互斥版 task3 被提升后不再被 task2 打断，task1 的等待时间大幅缩短。

> ⚠️ 两个硬性限制：① 互斥量**不能用于中断**——中断不是任务、没有优先级可继承（`OSMutexPost` 在中断里调用返回 `OS_ERR_POST_ISR`）；② 优先级继承只是"缓解"翻转而不是"消除"——如果持锁者 L 本身又被更高优先级任务抢占，H 依然要等。真正的根治是设计上缩短持锁时间。教材原话：实时应用应在设计之初就要避免优先级翻转的发生（PDF p.248）。

## 6. 对比 FreeRTOS：一张表看懂两种设计

| 维度 | µC/OS-III（本课） | FreeRTOS（第 9 课已学） |
|------|------|------|
| 实现结构 | **独立内核对象** OS_SEM / OS_MUTEX（结构体变量） | 信号量是**队列的特例**（Queue_t + 类型码） |
| 创建方式 | `OSSemCreate(&s, "name", cnt, &err)`，对象+名字+错误码指针 | `xSemaphoreCreateBinary()` 返回句柄，出错返回 NULL |
| 阻塞语义 | timeout=0 + BLOCKING = **无限等待**；NON_BLOCKING 立即返回 | `portMAX_DELAY` 无限等待；0 是立即返回 |
| 错误报告 | 每个 API 带 `OS_ERR` 指针，十几种细分错误码 | 返回 pdPASS/pdFAIL 二元结果 |
| 互斥量 | 内建优先级继承，TCB 位图（OS_MUTEX_GRP）跟踪所有权，内建递归 | xMutexHolder + uxBasePriority 实现继承，递归需另用递归互斥量 |
| 中断使用 | `OSSemPost` 可在中断调用（互斥量不行） | `xSemaphoreGiveFromISR` 专用 ISR 版 |

一句话总结：**FreeRTOS 用"一个队列模型"统一了同步原语，省代码但抽象；µC/OS-III 为每种对象建一个结构体，多写代码但语义清楚、错误可诊断**。做产品两个都行；做研究，UCOS 的对象式设计更容易讲清"每个同步原语内部到底有什么"。

## 动手练习（约 40 分钟）

### 练习 14.1：二值信号量中断同步实验

- 1️⃣ 在你的 µC/OS-III 分支工程里，参照第 2 节代码：task2 用 `OSSemPend(&sync_sem, 0, OS_OPT_PEND_BLOCKING, 0, &err)` 无限等待信号，收到就刷新 LCD 并打印。
- 2️⃣ 把"按键任务给信号"改成"中断给信号"：在探索者的一个外部中断/定时器中断里调用 `OSSemPost(&sync_sem, OS_OPT_POST_1, &err)`（UCOS 的 Post 类函数在中断里可以直接调用，不需要 ISR 专用版）。
- 3️⃣ 验证语义：连续快速触发两次中断，任务只被唤醒处理一次（信号量满时 Post 丢弃）；在 Watch 窗口盯 `binary_sem.Ctr`：触发前 / 触发后 / task2 Pend 后分别是什么值？
- 4️⃣ 把 Pend 的 timeout 从 0 改成 1000 试试：不发信号时观察任务每 1 秒返回一次 `OS_ERR_TIMEOUT`。验收标准：能画出发信号 → 唤醒 → 消费的时序图，并说清 timeout=0 与 portMAX_DELAY 的对应关系。

### 练习 14.2：互斥量优化优先级翻转对比实验

- 1️⃣ 把第 4 节的三个任务代码搬进工程（task1 高、task2 中、task3 低），start_task 里先 `OSSchedRoundRobinCfg(OS_TRUE, 0, &err)` 关时间片，用 `OSSemCreate(cnt=1)` 创建信号量，记录串口输出顺序——确认出现优先级翻转。
- 2️⃣ 只改三处调用：换成 `OSMutexCreate` / `OSMutexPend` / `OSMutexPost`（Post 用 `OS_OPT_POST_NONE`），重新下载运行，对比两轮串口输出。task2 为什么不再插队了？
- 3️⃣ 在 Watch 窗口盯着 `mutex.OwnerTCBPtr->Prio`（或调试器里查 task3 的 TCB）：task1 Pend 期间 task3 的当前优先级被提到几？释放后恢复成几？如果 task3 同时持有两个互斥量，位图 OS_MUTEX_GRP 里是什么样子？
- 4️⃣ 验收标准：能用一张时间轴画出两种场景下三个任务的运行区间，并说出"优先级继承"这个动作发生在哪个 API 内部、UCOS 用什么数据结构跟踪所有权。

## 自测（答完再点答案）

### 随堂小测

Q1. µC/OS-III 信号量结构中，记录"还有几个资源"的成员是？

- A. PendList 挂起等待链表
- B. Ctr 资源计数器
- C. Type 对象类型标记
- D. NamePtr 名字指针

<details>
<summary>查看答案</summary>

B。Ctr 是资源计数器：大于 0 就有资源，Pend 减一、Post 加一；PendList 是被挂起等待的任务链表（PDF p.197）。

</details>

Q2. OSSemPend 传 timeout=0 且 OS_OPT_PEND_BLOCKING，含义是？

- A. 不等待，没资源立即返回错误
- B. 无限等待，直到获取到资源
- C. 等待 0 个 tick 后超时返回
- D. 非法参数，函数直接返回

<details>
<summary>查看答案</summary>

B。UCOS 语义：timeout=0 + BLOCKING = 无限等待（对应 FreeRTOS portMAX_DELAY）；立即返回要用 OS_OPT_PEND_NON_BLOCKING（返回 OS_ERR_PEND_WOULD_BLOCK）（PDF p.205）。

</details>

Q3. 互斥信号量的优先级继承机制表现为？

- A. 高优先级任务主动降低自己的优先级
- B. 持有者优先级临时提升到等待者的水平
- C. 调度器直接把资源从持有者手里抢走
- D. 中优先级任务被永久挂起直到释放

<details>
<summary>查看答案</summary>

B。高优先级 H 因获取被 L 持有的互斥量而阻塞时，L 的优先级被临时提升到与 H 相同，释放后恢复——这样中间优先级任务 M 就插不了队（PDF p.245~246）。

</details>

Q4. 关于互斥信号量，下列说法正确的是？

- A. 可以替代计数型信号量做事件计数
- B. 可以在中断服务函数中调用
- C. 非持有者释放会返回 OS_ERR_MUTEX_NOT_OWNER
- D. 能彻底消除优先级翻转问题

<details>
<summary>查看答案</summary>

C。互斥量有所有权概念：OwnerTCBPtr 记录持有者，非持有者 Post 返回 OS_ERR_MUTEX_NOT_OWNER；中断不能使用（无可继承优先级），继承只能缓解翻转而非消除（PDF p.247~249）。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 11 章信号量（PDF p.196~243）与第 12 章互斥信号量（PDF p.245~281）——本课全部依据
- 🌐 [Weston Embedded µC/OS-III 官方资料](https://weston-embedded.com/uc-os-iii)——OS_SEM/OS_MUTEX 官方结构定义与源码
- 📕 [《µC/OS-III: The Real-Time Kernel》](https://weston-embedded.com/uc-os-iii)——Labrosse 亲写，第 10 章 Semaphores 与第 11 章 Mutexes 深入论述
- 🔁 对照：[FreeRTOS 课程第 9 课（信号量）](/my-blog/posts/freertos/0009-semaphores/)——优先级翻转与继承现象的 FreeRTOS 视角

## 下一步

信号量与互斥量讲完，UCOS 的"对象式同步"你已经摸到门道。下一课预告：第 15 课——消息队列与事件标志，看 UCOS 怎么用"消息池 + 万能指针"传数据，以及任务内嵌信号量/消息队列这个 FreeRTOS 没有的轻量机制。

| [← 上一课](/my-blog/posts/ucosiii/0013-task-api-practice/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0015-queues-and-event-flags/) |