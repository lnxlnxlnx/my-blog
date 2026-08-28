---
title: 任务管理 API 实战
published: 2026-08-25
description: 亲手造过内核之后，回头系统过一遍 UCOS 任务管理 API：OSTaskCreate/OSTaskDel、挂起恢复、动态改优先级、时间片调度、空闲钩子与统计任务——每个参数背后都是 MiniOS 里实现过的"零件"。
tags: [UCOSIII, 嵌入式, RTOS, 任务管理, API]
category: UCOSIII
draft: false
prevTitle: 信号量与互斥量
prevSlug: "ucosiii/0014-semaphores-and-mutexes"
nextTitle: MiniOS⑥：三内核验收对比
nextSlug: "ucosiii/0012-minios-6-kernel-review"
---

# 任务管理 API 实战

亲手造过内核之后，回头用 UCOS 的商用 API——每个参数背后都是你见过的"零件"。**本课目标：**MiniOS 六课之后，回到 µC/OS-III 应用层系统过一遍任务管理 API：创建/删除、挂起/恢复、修改优先级、时间片调度、空闲钩子与统计。学完你能不带迟疑地写出 13 个参数的 `OSTaskCreate()`，并解释每个 API 内部对应的内核机制（你在 MiniOS 里亲手实现过的那些）。

## 1. OSTaskCreate 与 OSTaskDel：任务的一生

先看教材的原型（PDF 6.1 节 (PDF p.91)）：

```c
void OSTaskCreate( OS_TCB*         p_tcb,      /* 任务控制块指针（用户提供内存） */
                   CPU_CHAR*       p_name,     /* 任务名，字符串，调试用 */
                   OS_TASK_PTR     p_task,     /* 任务函数指针 */
                   void*           p_arg,      /* 传给任务函数的参数 */
                   OS_PRIO         prio,       /* 任务优先级（数值越小越高！） */
                   CPU_STK*        p_stk_base, /* 任务栈起始地址 */
                   CPU_STK_SIZE    stk_limit,  /* 栈"水位"限制（从栈顶往下的警戒线） */
                   CPU_STK_SIZE    stk_size,   /* 任务栈大小（单位：字） */
                   OS_MSG_QTY      q_size,     /* 任务内嵌消息队列大小 */
                   OS_TICK         time_quanta,/* 任务时间片（0 用默认值） */
                   void*           p_ext,      /* 扩展指针，一般传 0 */
                   OS_OPT          opt,        /* 选项：栈检查/栈清零等 */
                   OS_ERR*         p_err);     /* 错误码指针，必查！ */
```

13 个参数看着吓人，其实就三类：**你是谁**（TCB、名字、函数、参数、优先级）、**你站在哪**（栈基址、栈大小、水位）、**你要什么附加服务**（内嵌队列、时间片、选项、错误码）。要点：

- **TCB 和栈都要用户自己分配**：`OS_TCB MyTaskTCB; CPU_STK MyTaskStk[200];`——UCOS 不做内存管理，这也是它 TCB 结构透明的教学哲学。
- **优先级有保留位**：0、1、`OS_CFG_PRIO_MAX-2`、`OS_CFG_PRIO_MAX-1` 不能给应用任务用（PDF p.92）。
- **任务函数里必须有让出 CPU 的调用**：延时、挂起、等待内核对象，否则低优先级任务永远轮不到（PDF p.92 注意事项）。
- **不能在中断里创建任务**：会返回 `OS_ERR_TASK_CREATE_ISR`。

`OSTaskDel(p_tcb, p_err)` 删除任务（PDF p.93）：注意它**不释放任务栈和代码内存**，只是让内核不再管理它们，所以"删除"后资源可复用。传 `(OS_TCB*)0` 表示删除自己——start_task 干完活就这么退场。不能删空闲任务和中断服务任务。

> 💡 MiniOS 对照：你在 MiniOS 里写 `MiniTaskCreate` 时也做了同样的事——填 TCB、初始化栈、插就绪表。UCOS 只是把这些步骤封装成 13 个参数，内部流程一模一样（任务创建实验流程见 PDF 6.2 节 (PDF p.95)）。

## 2. OSTaskSuspend / OSTaskResume：支持嵌套的挂起

`OSTaskSuspend(p_tcb, p_err)` 无条件挂起任务（PDF 6.3 节 (PDF p.100)），关键语义：

- 挂起的任务**不参与调度**；挂起自己（传 0）会触发调度让出 CPU。
- 被挂起的任务**只能由 OSTaskResume 恢复**——即使延时到期也不会恢复（还记得第 10 课 Tick 链表里 `OS_TASK_STATE_DLY_SUSPENDED` 这个状态吗？就是它）。
- **支持嵌套**：UCOS 内部有挂起嵌套计数（错误码 `OS_ERR_TASK_SUSPEND_CTR_OVF` 证明它数着次数），挂起 N 次就要恢复 N 次才能真正就绪。
- 任务在等待信号量时被挂起，恢复后**继续等**，不会丢等待状态。

MiniOS 里如果你想加，就是给 MiniTCB 加个 `suspend_ctr` 字段 + 就绪表移除/恢复的逻辑——挂起 = 从就绪表摘走，恢复 = 插回去（如果还满足就绪条件）。

## 3. OSTaskChangePrio：动态改优先级

`OSTaskChangePrio(p_tcb, prio_new, p_err)` 运行中改任务的优先级（PDF 9.1 节 (PDF p.147)），教材实验（9.2 节 (PDF p.153)）设计了三个任务：task1/task2 是"被改"对象，task3 负责按键改它们的优先级。核心代码长这样：

```c
/* 教材 9.2 实验核心：task3 按按键改 task1/task2 的优先级 */
void task3(void *p_arg)
{
    OS_ERR err;
    uint8_t key;
    while (1)
    {
        key = key_scan(0);                      /* 扫描按键 */
        if (key == KEY0_PRES)
        {
            OSTaskChangePrio(&Task1Task_TCB, TASK2_PRIO, &err);  /* 把 task1 降到 task2 的优先级 */
            printf("task1 优先级已改为 %d\r\n", TASK2_PRIO);
        }
        else if (key == KEY1_PRES)
        {
            OSTaskChangePrio(&Task1Task_TCB, TASK1_PRIO, &err);  /* 改回去 */
            printf("task1 优先级已恢复 %d\r\n", TASK1_PRIO);
        }
        OSTimeDly(10, OS_OPT_TIME_DLY, &err);   /* 10 个节拍扫一次键 */
    }
}
```

内部机制你其实见过：改优先级 = 从旧优先级就绪链表摘下 → 改 TCB 里的 Prio → 插入新优先级就绪链表（若任务处于就绪态）；若任务正在等信号量，则要重新排等待链表位置。这就是第 4 课位图就绪表 + 第 11 课等待链表的组合拳。

## 4. 时间片调度：同优先级任务轮流跑

µC/OS-III 内建时间片调度：同优先级的多个任务按时间片轮转（第 10 课讲过 `OS_SchedRoundRobin()` 在 tick 里数剩余时间片）。使用时两步（PDF 9.3 节 (PDF p.160)）：

1. 配置项 `OS_CFG_SCHED_ROUND_ROBIN_EN` 置 1（os_cfg.h）。
2. 启动任务里 `OSSchedRoundRobinCfg(OS_TRUE, dflt_time_quanta, &err)` 使能，第二个参数是默认时间片长度（教材实验设为 1，肉眼可见的交替）。

```c
/* 教材 9.3 实验：start_task 里开时间片 + 创建两个同优先级任务 */
void start_task(void *p_arg)
{
    OS_ERR err;
    CPU_INT32U cnts;

    CPU_Init();
    cnts = (CPU_INT32U)(HAL_RCC_GetSysClockFreq() / OSCfg_TickRate_Hz);
    OS_CPU_SysTickInit(cnts);                       /* 配置 SysTick 时基 */

    OSSchedRoundRobinCfg(OS_TRUE, 1, &err);         /* 开启时间片，默认 1 个节拍 */

    OSTaskCreate(&Task1Task_TCB, "task1", task1, 0,
                 TASK1_PRIO, Task1Task_STK, TASK1_STK_SIZE/10, TASK1_STK_SIZE,
                 0, 0, 0, OS_OPT_TASK_STK_CHK|OS_OPT_TASK_STK_CLR, &err);
    OSTaskCreate(&Task2Task_TCB, "task2", task2, 0,
                 TASK2_PRIO, Task2Task_STK, TASK2_STK_SIZE/10, TASK2_STK_SIZE,
                 0, 0, 0, OS_OPT_TASK_STK_CHK|OS_OPT_TASK_STK_CLR, &err);

    OSTaskDel((OS_TCB*)0, &err);                    /* start_task 功成身退 */
}
```

关键前提：**task1 和 task2 的优先级必须相同**（教材里 TASK1_PRIO == TASK2_PRIO），时间片轮转只在同优先级间进行。两个任务死循环打印计数，串口输出会交替增长——这就是"肉眼可见"的时间片。如果任务里还调了延时，时间片到期与延时谁先触发？tick 处理顺序是：先 `OS_SchedRoundRobin` 后 `OS_TickUpdate`（PDF p.177~178），记住这个顺序能解释很多实验现象。

## 5. 空闲任务钩子与统计任务

最后两个"软技能"API：

- **空闲任务钩子**：空闲任务（最低优先级）每跑一轮会调用 `OSIdleTaskHook()`。教材通过 `App_OS_SetAllHooks()` 把钩子函数指针指到你的 `App_OS_IdleTaskHook()`（PDF 9.4 节 (PDF p.165)）。典型用途：空闲时让 MCU 进入低功耗、喂看门狗、统计空闲率。注意钩子里**不能调用任何让任务挂起的 API**（比如不能延时），否则空闲任务就"不空闲"了。
- **统计任务**：`OSStatTaskCPUUsageInit(&err)` 初始化 CPU 使用率统计（需 `OS_CFG_STAT_TASK_EN` 为 1 + 时间戳支持，PDF 9.5 节 (PDF p.168~173)）。之后全局变量 `OSStatTaskCPUUsage`（当前使用率）和 `OSStatTaskCPUUsageMax`（历史峰值）随时可读——正点原子例程直接把它们画到 LCD 上（PDF p.171）。配合第 9 课的 `OSTaskStkChk()` 还能看每个任务的栈余量。

> ⚠️ 统计实验依赖时间戳功能（µC/CPU 的 DWT 计数器），移植工程里必须按教材 2.1.6 节把时间戳配好，否则 `OSStatTaskCPUUsageInit()` 的数据是假的或直接报错。先跑通移植实验再开统计，顺序别反。

## 核心代码：创建/删除与优先级修改实验

```c
/* ===== 练习实验：任务创建与删除（对应教材 6.2 实验，PDF p.95~99） ===== */
OS_TCB   StartTask_TCB;
CPU_STK  StartTask_STK[128];
OS_TCB   Task1_TCB;
CPU_STK  Task1_STK[128];

#define TASK1_PRIO  3

void task1(void *p_arg)
{
    OS_ERR err;
    uint32_t num = 0;
    while (1)
    {
        printf("task1 运行: %lu\r\n", ++num);
        OSTimeDly(500, OS_OPT_TIME_DLY, &err);   /* 500 个节拍 = 500ms */
    }
}

void start_task(void *p_arg)
{
    OS_ERR err;
    CPU_INT32U cnts;

    CPU_Init();
    cnts = (CPU_INT32U)(HAL_RCC_GetSysClockFreq() / OSCfg_TickRate_Hz);
    OS_CPU_SysTickInit(cnts);

    /* 创建任务：TCB 与栈都是静态数组，用户自备 */
    OSTaskCreate(&Task1_TCB, "task1", task1, (void*)0, TASK1_PRIO,
                 &Task1_STK[0], 128/10, 128,     /* 栈水位 = 栈大小/10 */
                 0, 0, (void*)0,                 /* 内嵌队列 0、时间片 0、扩展 0 */
                 OS_OPT_TASK_STK_CHK | OS_OPT_TASK_STK_CLR, &err);
    if (err != OS_ERR_NONE)
    {
        printf("创建失败: %d\r\n", err);        /* 错误码必须检查！ */
    }

    OSTaskDel((OS_TCB*)0, &err);                 /* 删除自己，start_task 退场 */
}
```

```c
/* ===== 练习实验：优先级修改（对应教材 9.2 实验，PDF p.153~159） ===== */
/* 观察要点：task1 打印变快/变慢、串口节奏改变的那一刻就是优先级生效的时刻 */

void task1(void *p_arg)                          /* 被改优先级的任务 */
{
    OS_ERR err;
    uint32_t num = 0;
    while (1)
    {
        printf("task1: %lu\r\n", ++num);
        OSTimeDly(50, OS_OPT_TIME_DLY, &err);    /* 50ms 打印一次 */
    }
}

void task2(void *p_arg)                          /* 同款结构，不同优先级 */
{
    OS_ERR err;
    uint32_t num = 0;
    while (1)
    {
        printf("task2: %lu\r\n", ++num);
        OSTimeDly(50, OS_OPT_TIME_DLY, &err);
    }
}

void task3(void *p_arg)                          /* 键盘侠：负责改优先级 */
{
    OS_ERR err;
    uint8_t key;
    while (1)
    {
        key = key_scan(0);
        if (key == KEY0_PRES)
        {
            OSTaskChangePrio(&Task1_TCB, TASK2_PRIO, &err);  /* task1 降到和 task2 同优先级 */
        }
        else if (key == KEY1_PRES)
        {
            OSTaskChangePrio(&Task1_TCB, TASK1_PRIO, &err);  /* 恢复 */
        }
        OSTimeDly(10, OS_OPT_TIME_DLY, &err);
    }
}
```

> 💡 实验设计思路：让 task1 和 task2 打印内容不同（比如前缀不同），task3 只管按键改优先级。现象：task1 从"几乎独占串口"变成"和 task2 交替打印"，再变回来——优先级就是话语权，改优先级就是改话语权。

## 动手练习（约 60~80 分钟）

### 练习 1：任务创建与删除实验

- 1️⃣ 在你的 UCOS 分支工程（保持当前 git 分支不动，在练习分支操作）新建 `app_task.c`，按上面代码创建 start_task + task1。
- 2️⃣ 加一个 task2：每 300ms 打印一次。验收标准：串口出现两条独立节奏的打印流，task1 500ms 一条、task2 300ms 一条。
- 3️⃣ 扩展：task3 每 5 秒调用 `OSTaskDel(&Task2_TCB, &err)` 删掉 task2。验收标准：task2 的打印消失、task1 不受影响；再让 task1 用 `OSTaskCreate` 复用 Task2 的 TCB 和栈重新创建它（教材说删除后资源可复用，验证这一点）。

### 练习 2：优先级修改实验

- 1️⃣ 按教材 9.2 实验搭好 task1/task2/task3，按 KEY0 把 task1 降到 task2 的优先级，按 KEY1 恢复。验收标准：串口节奏随按键改变，且改回后节奏与初始完全一致。
- 2️⃣ 挑战：把 task1 改成比 task2 更高（数值更小）的优先级后，用 `OSTaskSuspend(&Task1_TCB, &err)` 挂起它再恢复，观察"挂起期间即使优先级最高也不运行"。
- 3️⃣ 写 5 行总结：OSTaskChangePrio 内部大概动了哪些数据结构（就绪链表/等待链表/TCB 字段），对照第 12 课架构表。

## 自测（答完再点答案）

### 随堂小测

Q1. OSTaskCreate 里任务栈内存由谁提供？

- A. 内核自动分配
- B. 用户提供栈数组和栈大小
- C. 由 p_ext 参数指定

<details>
<summary>查看答案</summary>

B。TCB 与任务栈都由用户分配（静态数组或内存池），UCOS 只负责初始化与管理（PDF p.91~92）。

</details>

Q2. OSTaskDel 传入 (OS_TCB*)0 表示？

- A. 删除所有任务
- B. 删除当前任务自己
- C. 报错返回

<details>
<summary>查看答案</summary>

B。传 0 表示删除当前任务，start_task 干完活就这样退场（教材多处实验如此，PDF p.95）。

</details>

Q3. 被 OSTaskSuspend 挂起的任务，延时到期后会怎样？

- A. 直接恢复运行
- B. 保持挂起，只能由 OSTaskResume 恢复
- C. 变成就绪但排在队尾

<details>
<summary>查看答案</summary>

B。延时超时只把状态从 DLY_SUSPENDED 改成 SUSPENDED，仍需 OSTaskResume 恢复（PDF p.183 Tick 链表处理）。

</details>

Q4. 时间片调度生效的前提是？

- A. 任务优先级必须各不相同
- B. 任务优先级相同且已使能轮转
- C. 任务必须调用延时函数

<details>
<summary>查看答案</summary>

B。OSSchedRoundRobinCfg 使能 + 同优先级多任务，tick 里 OS_SchedRoundRobin 才生效（PDF p.160~163）。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 6 章（PDF p.91~108）——OSTaskCreate/OSTaskDel/OSTaskSuspend/OSTaskResume 全部依据
- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 9 章（PDF p.145~173）——优先级修改、时间片、空闲钩子、统计实验
- 🔁 对照：[FreeRTOS 课程第 4 课：任务 API 实战](/my-blog/posts/freertos/0004-task-api/)——xTaskCreate/vTaskDelete/vTaskSuspend 与 UCOS 同名 API 的形参风格对照
- 🔁 对照：MiniOS 第 7~9 课（TCB/就绪表/调度器）——UCOS 每个任务 API 背后的内核机制都在 MiniOS 里实现过

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 14 课——信号量与互斥量。任务 API 只是"调度舞台"，同步对象才是"任务协作剧本"：二值/计数信号量、互斥量与优先级翻转，UCOS 最经典的同步篇章。

| [← 上一课](/my-blog/posts/ucosiii/0012-minios-6-kernel-review/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0014-semaphores-and-mutexes/) |