---
title: 中断管理与临界区
published: 2026-08-24
description: FreeRTOS 课程第 13 课：Cortex-M 的 NVIC 与优先级模型、PendSV/SysTick 为什么必须最低优先级、BASEPRI 分级关中断与临界区嵌套计数。
tags: [FreeRTOS, 嵌入式, RTOS, 中断管理, 临界区, Cortex-M]
category: FreeRTOS
draft: false
prevTitle: 时间管理
prevSlug: "freertos/0014-time-management"
nextTitle: 任务通知
nextSlug: "freertos/0012-task-notifications"
---

# 中断管理与临界区

这是 FreeRTOS 系列课程笔记的第 13 课：原理硬核课——PendSV 为什么必须最低优先级？临界区到底关了哪些中断？**本课目标：**前面 12 课所有"挂起切换""关中断"的说法，今天全部落地到寄存器。学完你能说清：Cortex-M 的 NVIC 与优先级模型、SHPR3 里 PendSV/SysTick 的优先级怎么来的、BASEPRI 如何实现"分级关中断"、临界区嵌套计数是什么，并完成中断测试实验（正点原子《FreeRTOS 开发指南 V1.12》第 4 章 PDF p.66~81）。

---

## 1. Cortex-M 中断：NVIC 与异常模型

ARM Cortex-M 内核里管理中断的硬件叫 **NVIC**（嵌套向量中断控制器，Nested Vectored Interrupt Controller）。它最大支持 **16 个系统中断 + 240 个外部中断**共 256 个中断源，芯片厂商一般用不完：你的 STM32F407 探索者只用到 16 个系统中断和 82 个外部中断（教材以 F103 战舰为例是 10+60，PDF p.66）。中断向量表（vector table）按异常编号排列，中断来了 CPU 自动跳转到对应入口——"向量化"由此得名。

外部中断的优先级通过 NVIC 里的优先级配置寄存器（CMSIS 里就是 `NVIC->IP[240]` 数组）设置，每个中断一个 8 位寄存器。注意：**STM32 只用了这 8 位的高 4 位 [7:4]**，低 4 位恒为 0，所以实际提供 `2^4 = 16` 级优先级（PDF 4.1.2 节 PDF p.66）。

> ⚠️ 关键规则：**优先级配置寄存器的值越小，优先级越高**。0 是最高优先级，15 是最低。这与很多人的直觉相反——后续所有分析都建立在这条规则上，务必记牢（PDF p.66）。

---

## 2. 抢占优先级与子优先级

STM32 的优先级分两档（PDF 4.1.2 节 PDF p.67）：

- **抢占优先级**：高的可以打断正在执行的低的中断 → 支持**中断嵌套**。
- **子优先级**：抢占优先级相同时才比较；子优先级高的**不能打断**正在执行的子优先级低的中断（不嵌套），只决定同抢占级中断的排队顺序。

高 4 位怎么分给两者？有 5 种分组方式（`NVIC_PriorityGroup_0~4`，由 `HAL_NVIC_SetPriorityGrouping()` 设置）。FreeRTOS 官方**强烈建议用分组 4**：4 位全部给抢占优先级，不用子优先级，只设一个数，简单可靠——正点原子例程也全部这么干（PDF 4.1.2 节 PDF p.67）：

```c
/* 优先级分组 4：4 位全用于抢占优先级，0~15 级，无子优先级 */
HAL_NVIC_SetPriorityGrouping(NVIC_PRIORITYGROUP_4);

/* 例子：给某个外部中断设抢占优先级 5（子优先级 0，分组 4 下无效） */
HAL_NVIC_SetPriority(KEY0_INT_IRQn, 5, 0);
HAL_NVIC_EnableIRQ(KEY0_INT_IRQn);
```

---

## 3. 三个系统中断优先级寄存器 SHPR1/2/3

外部中断用 NVIC->IP，**系统中断（异常）则用独立的三个寄存器**（PDF 4.1.3 节 PDF p.68）：

| 寄存器 | 地址 | 管谁 | 位段 |
| --- | --- | --- | --- |
| SHPR1 | `0xE000ED18` | MemManage / BusFault / UsageFault | [7:0] / [15:8] / [23:16] |
| SHPR2 | `0xE000ED1C` | SVCall（SVC） | [31:24] |
| SHPR3 | `0xE000ED20` | **SysTick [31:24] / PendSV [23:16]** | — |

FreeRTOS 的移植层（port.c / portmacro.h）正是通过直接写 SHPR3 来设置 PendSV 和 SysTick 优先级的。启动调度器时（`xPortStartScheduler()`，PDF 4.3.1 节 PDF p.71）：

```c
/* FreeRTOS 移植层源码（port.c，Cortex-M4F 移植） */
#define portNVIC_SHPR3_REG \
        ( *( ( volatile uint32_t * ) 0xe000ed20 ) )          /* 指向 SHPR3 */

#define portNVIC_PENDSV_PRI \
        ( ( ( uint32_t ) configKERNEL_INTERRUPT_PRIORITY ) << 16UL )  /* 写 [23:16] */
#define portNVIC_SYSTICK_PRI \
        ( ( ( uint32_t ) configKERNEL_INTERRUPT_PRIORITY ) << 24UL )  /* 写 [31:24] */

BaseType_t xPortStartScheduler(void)
{
    /* 把 PendSV 和 SysTick 都设为最低优先级（数值最大） */
    portNVIC_SHPR3_REG |= portNVIC_PENDSV_PRI;
    portNVIC_SHPR3_REG |= portNVIC_SYSTICK_PRI;
    /* ...其余初始化与启动第一个任务... */
}
```

---

## 4. 为什么 PendSV 必须是最低优先级

这是本课的灵魂问题。任务切换由 PendSV 异常完成（第 6 课讲过切换流程），把它的优先级设到最低（15）有两大好处（PDF 4.3.1 节 PDF p.71）：

1. **不阻塞任何硬件中断**：切换动作最后做。即使某个时刻同时触发了任务切换请求和外部中断，CPU 也会先把外部中断处理完，再执行 PendSV 切换。硬件中断的响应延迟不因任务切换而恶化。
2. **切换过程中可被新中断打断且不丢切换**：如果切换执行到一半来了个更高优先级中断，PendSV 会被暂时挂起，中断处理完后又回到 PendSV 继续——因为 PendSV 的挂起位（ICSR 的 PENDSVSET）在切换完成前不会清除，中断结束回来后会重新调度 PendSV。

而 SysTick 也设最低优先级，是为了让 SysTick 能打断任何任务代码（它毕竟是时基），又不至于和别的中断抢。两者同为 15 级时按异常编号排序：SysTick 编号 15 > PendSV 编号 14，SysTick 仍优先于 PendSV——切换永远不会被时基"饿死"。

> 💡 还有一个隐藏原因：FreeRTOS 在临界区内也可能触发 PendSV（挂起但不立即切换），若 PendSV 优先级不是最低，临界区退出时的中断行为会变得不可预测。把 PendSV 钉死在最低优先级，是"临界区模型"成立的前提之一。

---

## 5. 三个屏蔽寄存器：PRIMASK / FAULTMASK / BASEPRI

Cortex-M 提供三个中断屏蔽寄存器（PDF 4.1.4 节 PDF p.68）：

| 寄存器 | 屏蔽范围 | 谁在用 |
| --- | --- | --- |
| PRIMASK | 置 1 屏蔽除 NMI 和 HardFault 外的所有异常/中断 | 裸机关中断（__disable_irq） |
| FAULTMASK | 置 1 屏蔽除 NMI 外的所有异常/中断（连 HardFault 也屏蔽） | 极少用 |
| BASEPRI | 低 8 位设阈值：**优先级数值 ≥ 阈值的中断全被屏蔽**（优先级高于阈值的照常） | FreeRTOS 的开关中断 |

BASEPRI 是"分级屏蔽"：比如设 `BASEPRI = 0x50`，优先级数值 ≥ 0x50（即优先级 ≤ 5 档，数值 5~15）的中断全被屏蔽，而优先级 0~4 的高优中断不受影响。FreeRTOS 正是靠它做到"临界区只屏蔽受管中断、不拖累高优硬实时中断"（PDF 4.1.4 节 PDF p.69）。

还有一个 **ICSR**（中断控制状态寄存器，地址 `0xE000ED04`）：bit28 `PENDSVSET` 写 1 即挂起 PendSV（任务切换就是往这写 1），`VECTACTIVE [8:0]` 指示当前正在执行的异常编号——中断服务函数里读它，就能确认"我真的在中断里"（PDF 4.1.5 节 PDF p.69）。

---

## 6. FreeRTOS 中断配置：FreeRTOSConfig.h 里的 6 个宏

教材 4.2 节把这些配置项讲透了（PDF 4.2 节 PDF p.70）。以正点原子例程（你的 F407 探索者同样适用）为例：

```c
/* FreeRTOSConfig.h 中断相关配置（正点原子例程） */
#define configPRIO_BITS                        4   /* STM32 优先级寄存器只用高 4 位 */
#define configLIBRARY_LOWEST_INTERRUPT_PRIORITY 15 /* 最低优先级 15 */
#define configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY 5 /* 受管最高优先级为 5 */

/* 内核内部换算（自动计算，不用手改）：
 * configKERNEL_INTERRUPT_PRIORITY      = 15 << 4 = 0xF0
 * configMAX_SYSCALL_INTERRUPT_PRIORITY =  5 << 4 = 0x50   */
#define configKERNEL_INTERRUPT_PRIORITY \
        ( configLIBRARY_LOWEST_INTERRUPT_PRIORITY << ( 8 - configPRIO_BITS ) )
#define configMAX_SYSCALL_INTERRUPT_PRIORITY \
        ( configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY << ( 8 - configPRIO_BITS ) )
```

含义一句话：**优先级数值 ≤ 5（优先级高于 5）的中断不受 FreeRTOS 影响**，可以随意调用 API 而不会被内核开关中断干扰；优先级数值 > 5（6~15）的中断属于"受管中断"，用 FromISR 系列 API 时会被 BASEPRI 屏蔽/恢复，且必须遵守"不能在临界区里调用"等约束（PDF 4.2 节 PDF p.70）。

---

## 7. 开关中断与临界区

开关中断就是操作 BASEPRI（PDF 4.3.2 节 PDF p.72）：

```c
/* 关闭受管中断：BASEPRI 置为 configMAX_SYSCALL_INTERRUPT_PRIORITY（0x50） */
#define portDISABLE_INTERRUPTS()    vPortRaiseBASEPRI()
/* 打开中断：BASEPRI 清零 */
#define portENABLE_INTERRUPTS()     vPortSetBASEPRI( 0 )

void vPortRaiseBASEPRI(void)
{
    uint32_t ulNewBASEPRI = configMAX_SYSCALL_INTERRUPT_PRIORITY;
    __asm { msr basepri, ulNewBASEPRI; dsb; isb; }   /* 写 BASEPRI + 数据/指令同步 */
}

static portFORCE_INLINE void vPortSetBASEPRI(uint32_t ulBASEPRI)
{
    __asm { msr basepri, ulBASEPRI; }                /* 写 BASEPRI */
}
```

临界区四个宏（PDF 4.3.3 节 PDF p.73）：

- `taskENTER_CRITICAL()` / `taskEXIT_CRITICAL()`：任务上下文用。进入时关受管中断并让 **uxCriticalNesting 嵌套计数 +1**，退出时 -1，**减到 0 才真正开中断**——所以临界区可以嵌套，进出次数必须配对。首次进入时还会断言检查 VECTACTIVE：如果你在中断里误用了任务版临界区，直接触发断言（PDF p.74）。
- `taskENTER_CRITICAL_FROM_ISR()` / `taskEXIT_CRITICAL_FROM_ISR(x)`：中断上下文用。进入时**先读回旧的 BASEPRI 值**（作为返回值 x），退出时把 x 写回恢复原状。注意：**中断版不支持嵌套**，且必须成对使用、参数必须是进入时的返回值（PDF p.74~75）。

```c
/* 任务上下文：临界区保护共享变量 */
uint32_t g_shared_counter = 0;

void task_a(void *pvParameters)
{
    while (1)
    {
        taskENTER_CRITICAL();              /* 进入临界区（关受管中断） */
        g_shared_counter++;                /* 完整执行，不会被受管中断打断 */
        taskEXIT_CRITICAL();               /* 退出临界区（开中断） */
        vTaskDelay(10);
    }
}

/* 中断上下文：FromISR 版必须这样配对 */
void Some_IRQHandler(void)
{
    UBaseType_t uxSaved;

    uxSaved = taskENTER_CRITICAL_FROM_ISR();   /* 保存旧 BASEPRI 并关受管中断 */
    /* 这里操作共享数据... */
    taskEXIT_CRITICAL_FROM_ISR(uxSaved);       /* 恢复原 BASEPRI */
}
```

---

## 8. 教材实验：中断测试

教材 4.4 实验验证了"分级关中断"（PDF 4.4 节 PDF p.76）：TIM3 中断优先级设 4（**不受管**），TIM5 设 6（**受管**），两个定时器都以 1Hz 触发并在串口打印。task1 每 5 秒执行一次 `portDISABLE_INTERRUPTS()` 后延时 5 秒再 `portENABLE_INTERRUPTS()`：

```c
/* 定时器中断初始化（优先级是关键） */
HAL_NVIC_SetPriority(BTIM_TIM3_INT_IRQn, 4, 0);  /* 优先级 4：高于 5，不受管 */
HAL_NVIC_SetPriority(BTIM_TIM5_INT_IRQn, 6, 0);  /* 优先级 6：低于 5，受管 */

/* task1：周期性开关中断 */
void task1(void *pvParameters)
{
    uint32_t task1_num = 0;

    while (1)
    {
        if (++task1_num == 5)
        {
            printf("FreeRTOS 关闭中断\r\n");
            portDISABLE_INTERRUPTS();   /* BASEPRI = 0x50，屏蔽优先级 5~15 */
            delay_ms(5000);
            printf("FreeRTOS 打开中断\r\n");
            portENABLE_INTERRUPTS();    /* BASEPRI = 0 */
        }
        vTaskDelay(1000);
    }
}
```

预期现象：关中断的 5 秒内，**TIM3 照常每秒打印（不受管），TIM5 静默（受管被屏蔽）**；打开后 TIM5 恢复。这一现象把"分级屏蔽"表现得明明白白。

> ⚠️ 三个易错点：① `taskENTER_CRITICAL_FROM_ISR` 的返回值必须原样交给对应的 `taskEXIT_CRITICAL_FROM_ISR`，丢了就乱套；② 临界区里禁止调用任何可能引起切换的 API（如 `xQueueSend`、`vTaskDelay`），参考手册明确禁止；③ 从 `xTaskNotifyGiveFromISR()` 这类 API 返回 `pdTRUE` 时要在中断末尾 `portYIELD_FROM_ISR()`，否则切换请求只被挂起、不立即执行。

---

## 动手练习

### 练习 13.1：验证 PendSV 最低优先级配置

- 1️⃣ 在你的 FreeRTOS 分支工程里，任务启动后直接读 `*(volatile uint32_t *)0xE000ED20`（SHPR3），用串口打印十六进制值。
- 2️⃣ 按位拆解验证：[31:24] 应是 0xF0（SysTick）、[23:16] 应是 0xF0（PendSV）、其余为 0——即 `0xF0F00000`。
- 3️⃣ 再读 `0xE000ED04`（ICSR）的 VECTACTIVE 段，打印当前异常编号，验证在任务上下文是 0、在定时器中断里是 TIM 对应编号。

### 练习 13.2：临界区保护共享变量实验

- 1️⃣ 写一个共享计数器：定时器中断里每 1ms 加 1（模拟高频写入），两个任务反复读取并累加求和后打印。
- 2️⃣ 先不做任何保护跑一遍，记录偶发的错误值；再加 `taskENTER_CRITICAL()/taskEXIT_CRITICAL()` 包裹读写，对比正确性。
- 3️⃣ 进阶：把其中一个任务改成中断里用 `taskENTER_CRITICAL_FROM_ISR()`，验证嵌套配对的使用方式。验收标准：加临界区后长时间运行计数无错值。

---

## 自测

### 随堂小测 1

STM32 中断优先级配置寄存器实际使用了哪几位？

- A. 高 4 位 [7:4]，共 16 级优先级
- B. 低 4 位 [3:0]，共 16 级优先级
- C. 全部 8 位，共 256 级优先级

<details>
<summary>查看答案</summary>

A。STM32 只用 8 位寄存器的高 4 位，低 4 位恒 0，共 2^4=16 级（PDF 4.1.2 节，p.66）。
</details>

### 随堂小测 2

PendSV 的中断优先级被 FreeRTOS 设置成？

- A. 最高优先级，保证切换立即执行
- B. 最低优先级，不阻塞硬件中断
- C. 与 SysTick 相同的中间优先级

<details>
<summary>查看答案</summary>

B。PendSV 和 SysTick 都设为最低优先级（数值最大），任务切换在所有中断处理完之后才执行（PDF 4.3.1 节，p.71）。
</details>

### 随堂小测 3

FreeRTOS 开关中断操作的是哪个寄存器？

- A. PRIMASK
- B. FAULTMASK
- C. BASEPRI

<details>
<summary>查看答案</summary>

C。BASEPRI 设阈值，屏蔽优先级数值 ≥ 阈值的中断，高优中断不受影响；PRIMASK/FAULTMASK 是全屏蔽（PDF 4.1.4 节，p.69）。
</details>

### 随堂小测 4

taskENTER_CRITICAL() 支持嵌套的关键机制是？

- A. uxCriticalNesting 计数器，减到 0 才开中断
- B. 每次调用都重新读回 BASEPRI
- C. 中断版和任务版各自独立计数

<details>
<summary>查看答案</summary>

A。任务版进入 +1、退出 -1，减到 0 才真正开中断；中断版 FromISR 不支持嵌套，靠保存/恢复 BASEPRI（PDF 4.3.3 节，p.73~75）。
</details>

---

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 4 章（PDF p.66~81）——本课全部依据，实验例程为《FreeRTOS 实验例程 4》
- 📕 [FreeRTOS 官方文档：Running FreeRTOS on ARM Cortex-M](https://www.freertos.org/Documentation/02-Kernel/03-Supported-devices/04-Demos/ARM-Cortex/RTOS-Cortex-M3-M4)——PendSV/SysTick 优先级设定的官方说明
- 🔧 [FreeRTOS API 参考：taskENTER/EXIT_CRITICAL_FROM_ISR](https://freertos.org/Documentation/02-Kernel/04-API-references/04-RTOS-kernel-control/02-taskENTER_CRITICAL_FROM_ISR_taskEXIT_CRITICAL_FROM_ISR)——临界区宏的完整语义
- 📖 深入 Cortex-M 架构可参考《Definitive Guide to ARM Cortex-M3/M4》（Joseph Yiu 著）第 7~8 章——SHPR/ICSR/BASEPRI 的权威出处

---

## 下一步

有问题随时问我。下一课预告：第 14 课——时间管理，tick 怎么来、延时任务如何被唤醒、vTaskDelayUntil 的精确周期用法。

| [← 上一课](/my-blog/posts/freertos/0012-task-notifications/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0014-time-management/) |
| --- | --- | --- |