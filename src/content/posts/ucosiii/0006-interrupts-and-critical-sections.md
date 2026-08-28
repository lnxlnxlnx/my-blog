---
title: 中断管理与临界区
published: 2026-08-18
description: BASEPRI 阈值、调度器锁定代替关中断、中断嵌套计数——µC/OS-III 把"关中断"的时间压到极限，与 FreeRTOS 第 13 课终极对照。
tags: [UCOSIII, 嵌入式, RTOS, 中断管理, 临界区, BASEPRI, 调度锁]
category: UCOSIII
draft: false
prevTitle: MiniOS① TCB 与位图就绪表
prevSlug: "ucosiii/0007-minios-1-tcb-and-ready-list"
nextTitle: 任务切换原理
nextSlug: "ucosiii/0005-task-switching"
---

# 中断管理与临界区

BASEPRI 阈值、调度器锁定与中断嵌套——µC/OS-III 把"关中断"的时间压到极限。**本课目标：**FreeRTOS 第 13 课你已经学透中断管理，这课看 µC/OS-III 的答案（PDF 第 4 章，p.70~80）。学完你能：说清 CPU_CFG_KA_IPL_BOUNDARY 这类的配置项怎么用；把 `CPU_CRITICAL_ENTER()` 宏链一路展开到 BASEPRI 寄存器；理解 µC/OS-III 最独特的招——**用锁定调度器代替关中断**；并讲出 `OSIntNestingCtr` 中断嵌套计数器的运作。最后和第 13 课的 FreeRTOS 答案对照，你会看清两种内核的取舍。

## 1. Cortex-M 中断与优先级：五分钟快速回顾

这一节几乎全部是 FreeRTOS 第 13 课的内容，我们只做"点到为止"的回顾，忘记细节就去复习那课：

- **NVIC**：嵌套向量中断控制器，管理外部中断；每个中断的优先级由 8 位配置寄存器的高 4 位决定（STM32 只用 [7:4]），共 16 级，**数值越小优先级越高**。系统中断（SVC/PendSV/SysTick/FAULT）用 SHPR1~SHPR3 三个专用寄存器配置（PDF p.70~74）。
- **抢占优先级与子优先级**：由优先级分组决定高低 4 位怎么分。µC/OS-III 强烈建议用分组 4（`HAL_NVIC_SetPriorityGrouping(NVIC_PRIORITYGROUP_4)`）——全部位用于抢占优先级，不做子优先级，中断管理一下子简单了（PDF p.71）。
- **三个屏蔽寄存器**：PRIMASK（bit0，屏蔽除 NMI/HardFault 外一切）、FAULTMASK（bit0，连 HardFault 也屏蔽）、**BASEPRI（低 8 位，设置"阈值"：优先级数值 ≥ BASEPRI 的中断全部被屏蔽）**。µC/OS-III 用 BASEPRI，因为它是"精细化"的——可以只屏蔽一部分中断（PDF p.72~74）。
- **ICSR 寄存器**（0xE000ED04）：bit28 PENDSVSET 置 1 可挂起 PendSV——第 5 课切换的触发手段（PDF p.74）。

> 💡 记住优先级分组的唯一正确姿势：用 µC/OS-III 就设分组 4。这样"优先级数值"就是"抢占优先级数值"，PendSV=15、SysTick=4、你的外设中断=几就几，一维排序，绝不混乱。FreeRTOS 课程的配置同理。

## 2. µC/OS-III 中断配置项：两个宏划定"管理边界"

µC/OS-III 把中断分成两拨：**受 µC/OS-III 管理的中断**（能用内核 API，关临界区时被屏蔽）和**不受管理的中断**（实时性最高，随时能响应）。分界由两个配置项决定（PDF p.75）：

| 配置项 | 含义 | 例程取值 | 本课案例板（STM32F407） |
|------|------|------|------|
| `CPU_CFG_NVIC_PRIO_BITS` | 优先级配置寄存器实际用了几位 | 4（STM32 只用高 4 位） | 4 |
| `CPU_CFG_KA_IPL_BOUNDARY` | 受 µC/OS-III 管理的**最高**中断优先级（数值边界） | 4 | 4 |

边界的意思是：**优先级 4~15 的中断受 µC/OS-III 管理，优先级 0~3 的不受管理**。0~3 通常留给"即使内核乱套也必须响应"的场合（比如掉电检测、看门狗喂狗），它们不进临界区、不调内核 API，永远畅通。这个边界值稍后还要算进 BASEPRI 的阈值里。

还有一个常在 os_cfg.h 里看到、教材没有展开的开关：`OS_CFG_ISR_POST_DEFERRED_EN`（默认关闭）。开启后，中断里"发信号/发消息"这类操作不会直接动内核对象，而是先把动作丢进一个特殊队列，由内核自带的"ISR 处理任务"在任务级统一执行——ISR 变得更短、关中断时间更短。这是 µC/OS-III 的特色功能，本课程先知道"有这么个东西"，原理留给你以后读官方文档（Weston Embedded）时探索。

## 3. PendSV 与 SysTick 优先级：为什么 PendSV 必须最低

µC/OS-III 在汇编里配置这两个系统异常（PDF p.75~77）：

```c
; ---------- os_cpu_a.asm：OSStartHighRdy 开头 ----------
; 配置 PendSV 为最低中断优先级（0xFF → 数值 15 级）
MOV32   R0, NVIC_SYSPRI14       ; 0xE000ED22，SHPR3 的 [23:16]（PendSV 优先级字段）
MOV32   R1, NVIC_PENDSV_PRI     ; 0xFF
STRB    R1, [R0]

; ---------- os_cpu_c.c：OS_CPU_SysTickInit() 中对 SysTick 优先级的配置 ----------
basepri = (CPU_INT32U)(CPU_CFG_KA_IPL_BOUNDARY << (8u - CPU_CFG_NVIC_PRIO_BITS));  /* 4<<4 = 0x40 */
prio    = CPU_REG_SCB_SHPRI3;        /* 读 SHPR3 */
prio   &= 0x00FFFFFFu;               /* 清掉 SysTick 优先级字段 [31:24] */
prio   |= (basepri << 24u);          /* SysTick 优先级 = 4 */
CPU_REG_SCB_SHPRI3 = prio;
```

两个关键设计（第 5 课 PendSV 的原理在这里补全）：

- **PendSV = 最低优先级**：任务切换被推迟到"所有中断都处理完"之后执行。好处你在 FreeRTOS 课已经亲历——SysTick 里只管"决定要不要切"，真正的交接永远在中断潮水退去后进行，不会出现"切一半被打断"的脏状态，也避免了中断延迟与 Usage Fault。
- **SysTick = 受管理中断的"最高优先级"（数值 4）**：它是时基，得比普通外设中断"更接近实时"，但又要排在不受管理的 0~3 之后。这个"优先级 4"不是巧合——它就是 2. 节边界值的直接应用。

> ⚠️ 别动 PendSV/SysTick 的优先级！PendSV 一旦不是最低优先级，切换就可能抢在别的中断前面执行，任务栈现场会错乱（俗话叫"切换死机"）。SysTick 一旦低于你的某个外设中断，时基会被那个中断拖延，OSTimeDly 全部变慢。这两行配置是移植层的底线，写应用代码时永远不要碰。

## 4. 开关中断：CPU_CRITICAL_ENTER/EXIT 宏链

µC/OS-III 的临界区入口是一串"俄罗斯套娃"（PDF p.78~80），从内到外是：汇编函数 `CPU_SR_Save/CPU_SR_Restore` → 宏 `CPU_INT_DIS/CPU_INT_EN` → 宏 `CPU_CRITICAL_ENTER/EXIT` → 用户代码里的 `CPU_SR_ALLOC()`。先看汇编这一层（cpu_a.asm，PDF p.77）：

```c
; ---------- cpu_a.asm ----------
; 入参 R0 = 要设置的 BASEPRI 阈值；返回值 R0 = 设置前的 BASEPRI 值
CPU_SR_Save
    CPSID   I           ; ① 先关全部中断（PRIMASK=1），防止下面几条指令被插队
    PUSH   {R1}         ; ② 保存 R1
    MRS    R1, BASEPRI  ; ③ 读出设置前的 BASEPRI → R1
    MSR    BASEPRI, R0  ; ④ 写入新阈值（屏蔽优先级数值 ≥ 阈值的中断）
    DSB                  ; ⑤ 数据/指令同步，确保写生效（Cortex-M7 上尤其重要）
    ISB
    MOV    R0, R1        ; ⑥ 返回值 = 旧的 BASEPRI
    POP    {R1}
    CPSIE  I             ; ⑦ 开全部中断（PRIMASK=0）
    BX     LR

CPU_SR_Restore
    CPSID   I
    MSR    BASEPRI, R0   ; 把 BASEPRI 恢复为进入临界区前的值
    DSB
    ISB
    CPSIE  I
    BX     LR
```

往上套一层，就得到用户日常写的三件套（cpu.h，PDF p.78~79）：

```c
/* ---------- cpu.h：临界区三件套 ---------- */
/* ① 定义保存中断状态的变量（必须放在函数内所有局部变量定义之后！） */
#define CPU_SR_ALLOC()        CPU_SR cpu_sr = (CPU_SR)0

/* ② 进入临界区：把 BASEPRI 设为 4<<4=0x40，
 *    屏蔽优先级 4~15 的中断；0~3 不受影响，照常响应 */
#define CPU_CRITICAL_ENTER()  do { cpu_sr = CPU_SR_Save(   \
        CPU_CFG_KA_IPL_BOUNDARY << (8u - CPU_CFG_NVIC_PRIO_BITS)); } while (0)

/* ③ 退出临界区：恢复进入前的 BASEPRI 值 */
#define CPU_CRITICAL_EXIT()   do { CPU_SR_Restore(cpu_sr); } while (0)

/* ---------- 用户代码的标准用法 ---------- */
void Function (void)
{
    uint32_t a;
    CPU_SR_ALLOC();            /* 必须在所有局部变量之后！ */

    /* 非临界区代码 */
    CPU_CRITICAL_ENTER();      /* 进入临界区 */
    /* 临界区代码：对共享数据的读写 */
    CPU_CRITICAL_EXIT();       /* 退出临界区 */
}
```

三个理解要点：

- **为什么用 BASEPRI 而不用 PRIMASK 全关**：临界区只屏蔽"受管理"的中断（4~15），优先级 0~3 的"生死攸关中端"继续运行——实时性损失最小。
- **cpu_sr 是局部变量，不是全局计数器**：BASEPRI 的旧值保存在调用者自己的栈上，天然支持嵌套（外层进入后内层再进入，各自保存各自的旧值，退出时逐层还原），不需要像 FreeRTOS 那样维护 `uxCriticalNesting`。代价是——**进入和退出必须发生在同一个函数里**，不能跨函数成对使用。
- **CPU_IntDis / CPU_IntEn**：另一组"简单粗暴"的汇编（CPSID I / CPSIE I），全关全开，µC/OS-III 启动流程里用它，日常代码别碰。

## 5. µC/OS-III 的招牌：锁定调度器，代替关中断

这才是 µC/OS-III 区别于 FreeRTOS 的核心思想之一：**大部分内核数据结构的保护根本不关中断，而是把调度器锁起来**（PDF p.133~136 可看到 OSSched 对锁计数器的检查）。中断照常响应、照常进入 ISR，只是"不准切换任务"。两个 API：

```c
/* ---------- os_core.c：调度器锁定（代码按教材思想简化） ---------- */
void OSSchedLock (OS_ERR *p_err)
{
    CPU_SR_ALLOC();
    if (OSRunning != OS_STATE_OS_RUNNING) {      /* 内核还没跑？ */
        *p_err = OS_ERR_SCHED_LOCK_ISR;
        return;
    }
    CPU_CRITICAL_ENTER();                        /* 只在这一瞬间关中断 */
    OSSchedLockNestingCtr++;                     /* 锁嵌套计数器 +1 */
    CPU_CRITICAL_EXIT();                         /* 立刻开中断 */
    *p_err = OS_ERR_NONE;
}

void OSSchedUnlock (OS_ERR *p_err)
{
    CPU_SR_ALLOC();
    if (OSSchedLockNestingCtr == 0u) {
        *p_err = OS_ERR_SCHED_UNLOCK_ISR;
        return;
    }
    CPU_CRITICAL_ENTER();
    OSSchedLockNestingCtr--;
    if (OSSchedLockNestingCtr == 0u) {           /* 解锁到最外层：*/
        CPU_CRITICAL_EXIT();
        OSSched();                               /* 立即调度一次（锁期间欠下的切换在此补上） */
    } else {
        CPU_CRITICAL_EXIT();
    }
    *p_err = OS_ERR_NONE;
}
```

妙处在哪里？对比一下：

| 方案 | 中断响应 | 临界区代码 | 典型耗时 |
|------|------|------|------|
| 关中断（PRIMASK 全关） | 全部被延迟 | 一切共享数据 | 临界区有多长，中断就有多长被拖 |
| BASEPRI 阈值 | 0~3 照常，4~15 被延迟 | 受管共享数据 | 短一点，但仍在拖 4~15 |
| **锁定调度器** | **所有中断照常响应！** | 任务级共享数据（切换被禁止） | **中断几乎零延迟** |

本质：**任务级的数据竞争来自"切换"而不是"中断"**。ISR 里访问同一数据时，UCOS 另有规矩（ISR 只调用 FromISR 类 API，由 OSIntNestingCtr 兜底）。所以任务之间争抢的临界区，锁调度器就够了——这就是 µC/OS-III 引以为豪的"中断禁用时间极短"。

> 💡 对照 FreeRTOS：`vTaskSuspendAll()/xTaskResumeAll()` 也是"锁调度器"思想，但 FreeRTOS 的许多内核操作仍然默认走 `taskENTER_CRITICAL`（关中断）。µC/OS-III 把"锁调度器"用得更彻底、更常规——你在源码里看到的 `CPU_CRITICAL_ENTER()` 很多其实只是给"计数器 +1 / 读一个变量"这种微操作用，一两条指令就出来了，中断几乎不被拖累。

## 6. 中断嵌套计数器：OSIntNestingCtr

µC/OS-III 用全局变量 `OSIntNestingCtr` 记录"现在是否在中断里、嵌了几层"（PDF p.80）。>0 表示处于中断状态，=0 表示在任务里。ISR 的标准模板：

```c
/* ---------- os_cpu_c.c：SysTick 中断服务函数模板 ---------- */
void OS_CPU_SysTickHandler (void)
{
    CPU_SR_ALLOC();

    CPU_CRITICAL_ENTER();      /* 进入中断后先报告：我进中断了 */
    OSIntEnter();              /* OSIntNestingCtr++ */
    CPU_CRITICAL_EXIT();

    OSTimeTick();              /* 中断服务函数本体（时基处理） */

    OSIntExit();               /* 中断返回前报告：我出中断了；
                                 * 计数器减到 0 且调度器没锁时，挂起 PendSV 完成切换 */
}
```

两个函数的分工（PDF p.80，实现细节在教材第 7/8 章里展开）：

- `OSIntEnter()`：简单地把 `OSIntNestingCtr++`（防溢出，超过 250 就忽略）。
- `OSIntExit()`：`OSIntNestingCtr--`；若减到 0（最外层中断要退出了）且调度器未锁，就查最高优先级就绪任务——如果跟当前任务不是同一个，**挂起 PendSV**，让切换在中断全部退完后执行（这个逻辑和第 8 章 OSIntExit 一致，p.137~140）。

所以中断嵌套时：第一个中断进入 → 计数器 1；被高优先级中断抢占 → 2；嵌套返回 → 1 → 0，只有最外层退出时才评估"要不要切换"。嵌套层数越多，越不会在中途误切换。

## 7. 终极对照：taskENTER_CRITICAL vs CPU_CRITICAL_ENTER

两课的答案摆在一起（FreeRTOS 第 13 课：`portSET_INTERRUPT_MASK` 用 `configMAX_SYSCALL_INTERRUPT_PRIORITY` 写死阈值；µC/OS-III 用 `CPU_CFG_KA_IPL_BOUNDARY << (8 - CPU_CFG_NVIC_PRIO_BITS)` 动态计算）：

| 维度 | FreeRTOS（第 13 课） | µC/OS-III（本课） |
|------|------|------|
| 进入临界区手段 | `taskENTER_CRITICAL()` → BASEPRI = configMAX_SYSCALL_INTERRUPT_PRIORITY | `CPU_CRITICAL_ENTER()` → BASEPRI = boundary<<(8-bits) |
| 屏蔽范围 | 受 FreeRTOS 管理的中断（可调 API 的） | 受 µC/OS-III 管理的中断（4~15），0~3 保留 |
| 嵌套方式 | 全局计数器 uxCriticalNesting（可跨函数） | 局部变量 cpu_sr（同函数内嵌套） |
| 常规临界区偏好 | 关中断为主 | **锁调度器为主（OSSchedLock）** |
| ISR 里的保护 | FromISR 系列 API + 由 PendSV 兜底 | OSIntEnter/Exit + OSIntCtxSw 兜底 |

一句话总结两家哲学：**FreeRTOS 把"关中断"当默认武器，µC/OS-III 把"关中断"当最后手段**——能锁调度器就锁调度器，BASEPRI 只用来保护极短的内核微操作。这也是 µC/OS-III 在实时性敏感场景下"中断响应更快"的底气来源。

## 动手练习（约 20 分钟）

### 练习 6.1：把 CPU_CRITICAL_ENTER 宏链展开到底

- 1️⃣ 在你的 µC/OS-III 分支工程里打开 `cpu.h`，依次找到 `CPU_CRITICAL_ENTER()` → `CPU_INT_DIS()` → `CPU_SR_Save()`，对照本课第 4 节的宏链逐级展开，确认最终落到 `CPU_SR_Save(4 << (8-4))`，即 BASEPRI = 0x40。
- 2️⃣ 打开 `cpu_a.asm`，核对 `CPU_SR_Save` 的汇编：数一数它用了几条指令，确认"设置 BASEPRI 前先 CPSID I"这个细节。
- 3️⃣ 在调试器里给 `CPU_SR_Save` 打断点，运行到 OSInit 附近，Watch 里看 R0（入参 0x40）和返回值（旧 BASEPRI），确认"保存旧值→设新值"的往返。
- 4️⃣ 验收标准：能白板写出完整调用链（CPU_CRITICAL_ENTER → CPU_INT_DIS → CPU_SR_Save → BASEPRI），并解释为什么 cpu_sr 必须是局部变量。

### 练习 6.2：中断嵌套计数实验

- 1️⃣ 在工程里配置两个定时器中断（如 TIM2、TIM3），抢占优先级分别设为 5 和 6（分组 4），让 TIM2（优先级 5，更高）的 ISR 里延时几百微秒，保证 TIM3 会在 TIM2 处理期间到达——制造嵌套。
- 2️⃣ 两个 ISR 都按第 6 节模板写：`OSIntEnter()` 后、`OSIntExit()` 前，各把 `OSIntNestingCtr` 的值打印到串口。
- 3️⃣ 观察串口输出：嵌套发生时计数器是否出现了 1 → 2 → 1 → 0 的波形？在 `OSIntExit()` 里打断点，确认只有减到 0 的那次才会走到调度判断。
- 4️⃣ 验收标准：能画出一条时间轴上 OSIntNestingCtr 的变化曲线，并解释"最外层中断退出时才切换"的设计原因。

## 自测（答完再点答案）

### 随堂小测 1

Q1. CPU_CFG_KA_IPL_BOUNDARY = 4 时，CPU_CRITICAL_ENTER 设置的 BASEPRI 值是？

- A. 0x04
- B. 0x40
- C. 0xFF
- D. 0x00

<details>
<summary>查看答案</summary>

B。BASEPRI = 4 << (8-4) = 0x40，屏蔽优先级数值 ≥ 0x40（即 4~15 级）的中断，0~3 不受影响（PDF p.78）。

</details>

### 随堂小测 2

Q2. µC/OS-III 把 PendSV 的中断优先级配置为？

- A. 最高优先级，保证切换立即执行
- B. 与 SysTick 相同，轮流执行
- C. 最低优先级，等所有中断处理完再切换
- D. 不配置，由应用自行决定

<details>
<summary>查看答案</summary>

C。OSStartHighRdy 里把 PendSV 设为 0xFF（数值 15，最低级），切换被推迟到所有中断之后（PDF p.75~76、p.132）。

</details>

### 随堂小测 3

Q3. 与 FreeRTOS 相比，µC/OS-III 保护任务级共享数据的常规手段是？

- A. 全局关中断 PRIMASK
- B. 锁定调度器 OSSchedLock
- C. 关闭 SysTick 时基
- D. 提高任务优先级

<details>
<summary>查看答案</summary>

B。OSSchedLock/OSSchedUnlock 锁调度器，中断照常响应，只在计数器操作那一瞬间短暂关中断——这就是"中断禁用时间极短"的来源（PDF p.133 可见 OSSched 对锁计数的检查）。

</details>

### 随堂小测 4

Q4. OSIntExit() 在什么条件下才会真正触发任务切换？

- A. OSIntNestingCtr 减到 0 且调度器未锁定
- B. 只要 OSIntNestingCtr 大于 0
- C. 中断返回地址是任务代码
- D. 只要调用 OSIntCtxSw 就会切换

<details>
<summary>查看答案</summary>

A。嵌套计数减到 0（最外层中断退出）且 OSSchedLockNestingCtr=0 时，才查最高就绪任务并挂起 PendSV；嵌套未退完或调度器被锁则直接返回（PDF p.137~140）。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 4 章（(PDF p.70~80)）——本课全部依据，重点 4.1.4（屏蔽寄存器）与 4.4（临界区）
- 📖 同书第 8 章（(PDF p.132~144)）——OSIntExit 与 PendSV 的完整实现，本课只引用了它的结论
- 🔁 对照：[FreeRTOS 课程第 13 课（中断管理与临界区）](/my-blog/posts/freertos/0013-interrupts-and-critical-sections/)——本课的对比基准，建议两课对着读
- 🌐 [Weston Embedded µC/OS-III 官方文档](https://weston-embedded.com/uc-os-iii)——查 OS_CFG_ISR_POST_DEFERRED_EN 等配置项的权威说明

## 下一步

到这里，UCOS 机制段（03~06）收官。下一课起进入本课程的核心主线——手写 MiniOS：第 7 课先把任务控制块和位图就绪表落地，你会亲手写出 µC/OS-III 最精髓的 O(1) 调度数据结构。

| [← 上一课](/my-blog/posts/ucosiii/0005-task-switching/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0007-minios-1-tcb-and-ready-list/) |