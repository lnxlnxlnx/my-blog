---
title: 任务切换原理
published: 2026-08-17
description: OSSched 选人、OSCtxSw 喊人、PendSV 换人——三条腿走完一次任务切换，并对比 FreeRTOS 的调度点设计。
tags: [UCOSIII, 嵌入式, RTOS, 任务切换, OSSched, PendSV, 调度点]
category: UCOSIII
draft: false
prevTitle: 中断管理与临界区
prevSlug: "ucosiii/0006-interrupts-and-critical-sections"
nextTitle: 位图就绪表
nextSlug: "ucosiii/0004-bitmap-ready-list"
---

# 任务切换原理

OSSched 选人、OSCtxSw 喊人、PendSV 换人——三条腿走完一次切换。**本课目标：**上一课解决了"选谁跑"，这一课解决"怎么换人"（PDF 第 8 章 (PDF p.132~144)）。学完你能说清 µC/OS-III 的三个问题：任务级切换 `OSSched()` 的完整流程、中断级切换 `OSIntExit()` 与 `OSIntCtxSw` 的差异、`OS_CPU_PendSV_Handler` 汇编保存/恢复现场的关键段。对照 FreeRTOS 的 `vTaskSwitchContext` 与 PendSV，看清两大内核**调度点设计**的根本差异。

## 1. PendSV 异常回顾（FreeRTOS 已学，快速过）

FreeRTOS 课第 7 课已经解剖过 PendSV，这里只复习三个要点（PDF 第 8.1 节 (PDF p.132)）：

- 🔔 **PendSV = 可挂起服务调用**：可以被挂起、延迟执行，是 RTOS 的"专车"。
- 🔻 µC/OS-III 把 PendSV 配成**最低中断优先级**——等其他所有中断处理完，才轮到它做任务切换。这样切换永远不会打断中断服务，中断也不会晚点。
- 🚀 触发方式：往 ICSR 寄存器的 PENDSVSET 位写 1 即可挂起。一句话：**挂起≠立刻执行，而是"等其他中断都办完"**。

## 2. 何时触发切换：触发≠一定切换

µC/OS-III 是抢占式内核，系统保证"当前运行的一定是最高优先级就绪任务"，所以内核会在很多时机自动检查（PDF 第 8.2 节 (PDF p.132)）：

| 时机 | 典型 API |
|------|------|
| 任务间发信号/消息 | `OSSemPost()`、`OSQPost()` 等 |
| 任务主动延时 | `OSTimeDly()`、`OSTimeDlyHMSM()` |
| 等待未发生的事件 | `OSSemPend()`、`OSQPend()`、`OSFlagPend()`… |
| 任务生命周期变化 | `OSTaskCreate()`、`OSTaskDel()`、`OSTaskSuspend()/Resume()`、改优先级 |
| 内核对象被删 | `OSSemDel()`、`OSQDel()`… |
| 中断嵌套结束 | 最内层 ISR 的 `OSIntExit()` |
| 其他 | `OSSchedUnlock()`、`OSSchedRoundRobinYield()`、应用主动调 `OSSched()` |

重要认知：**"触发任务切换"并不一定真的切换**——它只是"保证运行的是最高优先级就绪任务"。如果查完发现当前任务就是最高优先级，白跑一趟，直接返回。

## 3. OSSched()：任务级切换的完整流程

`OSSched()` 定义在 os_core.c，任务里调用（PDF 第 8.3.1 节 (PDF p.133~135)），流程如下：

```c
/* os_core.c —— OSSched()：任务级调度器 */
void OSSched(void)
{
    CPU_SR_ALLOC();

#if (OS_CFG_INVALID_OS_CALLS_CHK_EN > 0u)
    if (OSRunning != OS_STATE_OS_RUNNING) {   /* ① 系统没跑？不调度 */
        return;
    }
#endif
    if (OSIntNestingCtr > 0u) {               /* ② 在中断里？不调度（那是 OSIntExit 的事） */
        return;
    }
    if (OSSchedLockNestingCtr > 0u) {         /* ③ 调度器被锁？不调度（OSSchedLock 锁着） */
        return;
    }

    CPU_INT_DIS();                            /* ④ 关中断，进入临界区 */
    OSPrioHighRdy   = OS_PrioGetHighest();    /* ⑤ 位图查最高就绪优先级（上一课！） */
    OSTCBHighRdyPtr = OSRdyList[OSPrioHighRdy].HeadPtr;  /* ⑥ 取该优先级就绪链表头 */
    if (OSTCBHighRdyPtr == OSTCBCurPtr) {     /* ⑦ 还是当前任务？白忙，直接返回 */
        CPU_INT_EN();
        return;
    }

    OSTaskCtxSwCtr++;                         /* 记录切换次数（调试用） */
    OS_TASK_SW();                             /* ⑧ 触发切换：挂起 PendSV */
    CPU_INT_EN();                             /* 退出临界区 */
}
```

八个步骤，本质就一句话：**先查清楚"该不该换、换成谁"，再喊 PendSV 来换**。真正换人的脏活累活不在 OSSched 里——它只是"决策者"，"执行者"是 PendSV。

## 4. OSIntExit() 与 OSIntCtxSw：中断级切换的差异

中断退出时的调度走 `OSIntExit()`（PDF 第 8.3.2 节 (PDF p.137~139)）。它和 OSSched 的差别在"记账"：

```c
/* os_core.c —— OSIntExit()：ISR 结尾调用，报告"我处理完了" */
void OSIntExit(void)
{
    CPU_SR_ALLOC();
    if (OSRunning != OS_STATE_OS_RUNNING) { return; }

    CPU_INT_DIS();
    if (OSIntNestingCtr == 0u) { CPU_INT_EN(); return; }  /* 没进过中断？返回 */
    OSIntNestingCtr--;                                    /* ① 中断嵌套计数器 -1 */
    if (OSIntNestingCtr > 0u) { CPU_INT_EN(); return; }   /* ② 还有外层中断？不调度 */
    if (OSSchedLockNestingCtr > 0u) { CPU_INT_EN(); return; }  /* ③ 调度锁着？不调度 */

    OSPrioHighRdy   = OS_PrioGetHighest();                /* ④ 位图查最高优先级 */
    OSTCBHighRdyPtr = OSRdyList[OSPrioHighRdy].HeadPtr;
    if (OSTCBHighRdyPtr == OSTCBCurPtr) {                 /* ⑤ 无需切换就返回 */
        CPU_INT_EN();
        return;
    }

    OSIntCtxSw();                                         /* ⑥ 触发切换 */
    CPU_INT_EN();
}
```

关键差异在最后一步。看 os_cpu_a.asm 里这两个标号的"真面目"——它们是**同一段代码**（PDF 第 8.3.3 节 (PDF p.140)）：

```c
/* os_cpu_a.asm —— 任务级与中断级切换的"触发端"是同一个标号对 */
NVIC_INT_CTRL   EQU 0xE000ED04   ; 中断控制状态寄存器（ICSR）地址
NVIC_PENDSVSET  EQU 0x10000000   ; PENDSVSET 位掩码

OSCtxSw
OSIntCtxSw
    ; 把 ICSR 的 PENDSVSET 位置 1：挂起 PendSV，触发任务切换
    LDR R0, =NVIC_INT_CTRL
    LDR R1, =NVIC_PENDSVSET
    STR R1, [R0]
    BX  LR
```

为什么两个入口共用一段代码、中断里"不需要额外保存现场"？因为**保存现场这件事 PendSV 的 Handler 统一包办了**：

- 进入 PendSV 时，CPU 硬件已经自动把 xPSR/PC/LR/R12/R0~R3 压进当前栈（进任何异常都一样）；
- PendSV Handler 再手动保存 R4~R11（加 FPU 时还有 S16~S31）——把"全部现场"凑齐；
- 所以无论从任务（OSCtxSw）还是从中断（OSIntCtxSw）挂起 PendSV，**现场保存都在 PendSV 里统一完成**，两个入口自然可以共用。中断级切换省掉的只是"自己找地方压栈"——硬件早替它压好了。

> 💡 对照 FreeRTOS：FreeRTOS 的切换触发散在各处（tick 中断里 `portYIELD_FROM_ISR()`、API 里的 `portYIELD()`……都只是置位 PENDSVSET），选任务的动作放在 PendSV 里调用 `vTaskSwitchContext()`；µC/OS-III 反过来——**选任务在 C 层先做完（OSSched/OSIntExit），PendSV 只做纯搬运**。前者"PendSV 身兼选人+换人"，后者"选人换人分居两层"。殊途同归，但 UCOS 的 PendSV 汇编更短、更纯粹。

## 5. 汇编切换：OS_CPU_PendSV_Handler 的关键段

真正"换人"的现场，在 os_cpu_a.asm 的 `OS_CPU_PendSVHandler`（PDF 第 8.4 节 (PDF p.140~144)）。核心六步：

```c
; os_cpu_a.asm —— OS_CPU_PendSVHandler（注释版关键段）
OS_CPU_PendSVHandler
    ; ---- ① 保存现场：把"现在的我"完整存进当前任务栈 ----
    MRS     R0, PSP              ; R0 = 当前任务栈顶（PSP）
    IF {FPU} != "SoftVFP"
    TST     R14, #0x10           ; 用了 FPU？是则保存 S16~S31
    IT      EQ
    VSTMDBEQ R0!, {S16-S31}
    ENDIF
    STMFD   R0!, {R4-R11, R14}   ; 手动压栈 R4~R11 + 返回地址（其余寄存器硬件已压）

    ; ---- ② 更新当前任务的栈顶指针 ----
    MOV32   R5, OSTCBCurPtr
    LDR     R1, [R5]             ; R1 = 当前任务 TCB
    STR     R0, [R1]             ; TCB->StkPtr = 保存后的栈顶（TCB 第一个成员！）

    ; ---- ③ 钩子 + 切换"领导权"：Cur 指向新任务 ----
    MOV     R4, LR
    BL      OSTaskSwHook         ; 任务切换钩子（统计、栈检查…）
    MOV32   R0, OSPrioCur
    MOV32   R1, OSPrioHighRdy
    LDRB    R2, [R1]
    STRB    R2, [R0]             ; OSPrioCur = OSPrioHighRdy（第 4 课选的）
    MOV32   R1, OSTCBHighRdyPtr
    LDR     R2, [R1]
    STR     R2, [R5]             ; OSTCBCurPtr = OSTCBHighRdyPtr
    ORR     LR, R4, #0x04        ; 返回时使用 PSP（任务栈）

    ; ---- ④ 恢复现场：把"新任务"从它的栈里捞出来 ----
    LDR     R0, [R2]             ; R0 = 新任务 TCB->StkPtr
    LDMFD   R0!, {R4-R11, R14}   ; 弹出 R4~R11 + 返回地址
    IF {FPU} != "SoftVFP"
    TST     R14, #0x10
    IT      EQ
    VLDMIAEQ R0!, {S16-S31}      ; 恢复 FPU 寄存器
    ENDIF

    ; ---- ⑤ 换栈 + 异常返回：从新任务上次暂停处继续跑 ----
    MSR     PSP, R0              ; PSP = 新任务栈顶
    BX      LR                   ; 异常返回：硬件自动弹出 PC 等寄存器
```

观察三件事：**① 保存与恢复是对称的**（STMFD 对 LDMFD）；**② TCB 第一个成员必须是 StkPtr**——`STR R0,[R1]` / `LDR R0,[R2]` 零偏移直接存取，第 3 课埋的伏笔在此兑现；**③ 整个过程只碰 PSP（任务栈）不碰 MSP（系统栈）**——任务用 PSP，中断用 MSP，互不侵犯。

> ⚠️ 不要手痒去改这段汇编！保存/恢复顺序、FPU 标志位判断、EXC_RETURN 的 bit 设置，任何一处错位都会导致"栈错乱 → 任务跑飞 → HardFault"。理解它，但别动它——这正是移植时"PendSV 必须指向 OS_CPU_PendSVHandler"的原因（第 2 课）。

## 6. 对比 FreeRTOS：调度点设计的两派

把两门课的知识拼起来，两大内核的调度架构差异一目了然：

| 维度 | FreeRTOS（已学） | µC/OS-III（本课） |
|------|------|------|
| 选任务的地点 | PendSV 内调用 `vTaskSwitchContext()`（C 层在异常里跑） | 任务级 `OSSched()` / 中断级 `OSIntExit()`（C 层在调用现场跑） |
| PendSV 的职责 | 选人 + 换人（调 C 函数 + 搬现场） | **纯换人**（只搬现场，最短汇编） |
| 触发点分布 | 分散：tick 里 `xTaskIncrementTick` 判断、FromISR API 置 `xYieldPending`、`portYIELD()` | 集中：一切路径汇入 `OSSched()` 或 `OSIntExit()` 两个出口 |
| 调度器锁定 | `vTaskSuspendAll()/xTaskResumeAll()` | `OSSchedLock()/OSSchedUnlock()`（嵌套计数） |
| 中断里禁止调度 | ISR 里只允许 FromISR API | `OSIntNestingCtr` 计数，非 0 时 OSSched 直接返回 |

µC/OS-III 的哲学是"**统一出口**"：所有可能改变就绪状态的动作，最终都会调 OSSched 或 OSIntExit，调度决策集中、可审计；FreeRTOS 的哲学是"**就地标记、延迟执行**"：API 只改状态和标记，PendSV 里统一收割。两派都稳定可靠——理解这个差异，你就拥有了"读懂任何 RTOS 调度器"的框架。

## 动手练习（约 30 分钟）

### 练习 5.1：给 OSSched 加断点，观察切换时机

- 1️⃣ 在 `os_core.c` 的 `OSSched()` 函数开头和 `OS_PrioGetHighest()` 调用处各下一个断点，全速运行第 2 课的多任务程序。
- 2️⃣ 每次断点命中，在 Watch 里记录 `OSTCBCurPtr->NamePtr` 和 `OSTCBHighRdyPtr->NamePtr`，确认"当前任务"与"将切换任务"的名字。
- **观察什么：**数一数哪些断点命中时两个名字相同（说明查完发现无需切换）——你会惊讶于"白跑"的比例。再在 `OSIntExit()` 加断点，观察中断退出路径的切换时机。

### 练习 5.2：对比 FreeRTOS 调度点

- 1️⃣ 在 FreeRTOS 分支工程里，给 `vTaskSwitchContext()` 和 `xTaskIncrementTick()` 加断点，跑同样的双任务程序。
- 2️⃣ 对比两边的断点命中规律：FreeRTOS 的切换决策发生在哪（PendSV 里 vs tick 里）？µC/OS-III 的决策发生在哪（任务调用点 vs 中断退出点）？
- **观察什么：**写一段 6 行的对照笔记：① 选任务代码的存放位置 ② 触发路径的集中/分散 ③ 中断里调度的禁止方式。这是两内核"调度架构"差异的第一手证据。

## 自测（答完再点答案）

### 随堂小测 1

Q1. OSSched() 在哪种情况下会直接返回、不做切换？

- A. 查完发现无需切换
- B. 当前任务优先级最低
- C. 时间片还没用完

<details>
<summary>查看答案</summary>

A。最高就绪任务就是当前任务时直接返回；"触发切换"不保证真的切换（PDF p.133~134）。

</details>

### 随堂小测 2

Q2. OSCtxSw 与 OSIntCtxSw 的关系是？

- A. 完全不同的两段代码
- B. 同一段汇编的两个标号
- C. 一个 C 函数一个宏

<details>
<summary>查看答案</summary>

B。都是"置位 PENDSVSET 挂起 PendSV"的同一条汇编（PDF p.140），现场保存统一由 PendSV Handler 完成。

</details>

### 随堂小测 3

Q3. PendSV Handler 里保存 R4~R11 用的是哪条指令？

- A. STMFD
- B. LDMFD
- C. STR

<details>
<summary>查看答案</summary>

A。STMFD 压栈保存（R4~R11、R14），恢复时用 LDMFD 对称弹出（PDF p.141~143）。

</details>

### 随堂小测 4

Q4. 与 FreeRTOS 相比，µC/OS-III 的调度决策发生在？

- A. PendSV 异常内部
- B. 集中的 OSSched/OSIntExit 出口
- C. 每个 API 函数内部

<details>
<summary>查看答案</summary>

B。µC/OS-III 所有路径汇入 OSSched()（任务级）与 OSIntExit()（中断级）两个出口；FreeRTOS 是在 PendSV 里调 vTaskSwitchContext 决策。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 8 章（PDF p.132~144）——本课全部依据
- 🌐 [Weston Embedded（Micrium 后继）µC/OS-III 主页](https://weston-embedded.com/uc-os-iii)——os_core.c / os_cpu_a.asm 源码在线阅读
- 📕 [《µC/OS-III: The Real-Time Kernel》](https://weston-embedded.com/uc-os-iii)——第 6 章 Context Switch 与汇编详解
- 🔁 对照：[FreeRTOS 课程第 7 课（任务切换与 PendSV）](/my-blog/posts/freertos/0007-task-switching-pendsv/)——xPortPendSVHandler 与本课逐行对照

## 下一步

切换的"人"换明白了，下一课看看"围墙"——中断管理与临界区：UCOS 为什么敢说"中断禁用时间极短"，BASEPRI 与调度锁怎么配合。有疑问随时问我 😄

| [← 上一课](/my-blog/posts/ucosiii/0004-bitmap-ready-list/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0006-interrupts-and-critical-sections/) |