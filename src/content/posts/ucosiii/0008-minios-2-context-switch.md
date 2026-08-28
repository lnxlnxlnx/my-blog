---
title: MiniOS② 上下文切换
published: 2026-08-20
description: 手写内核第二步：任务栈帧、OSTaskStkInit 与 PendSV 切换汇编——让 CPU 真的从一个任务跳到另一个任务。
tags: [UCOSIII, 嵌入式, RTOS, MiniOS, 上下文切换, PendSV, OSTaskStkInit]
category: UCOSIII
draft: false
prevTitle: MiniOS③ 调度器与临界区
prevSlug: "ucosiii/0009-minios-3-scheduler"
nextTitle: MiniOS① TCB 与位图就绪表
nextSlug: "ucosiii/0007-minios-1-tcb-and-ready-list"
---

# MiniOS② 上下文切换

⭐ 手写内核第二步：任务栈帧、OSTaskStkInit 与 PendSV 切换汇编。**本课目标：**第 7 课造好了 TCB 和就绪表，但任务还是"死"的。本课让它们活过来：写 `OSTaskStkInit` 伪造"刚被中断"的栈帧、写 `OS_CPU_PendSV_Handler` 完成保存→恢复现场、写 `OSCtxSw` 触发切换。学完你能逐行讲解切换汇编，并用两个"裸任务"（不依赖调度器）验证切换成功。FreeRTOS 第 7 课的 xPortPendSVHandler 将在这里换上皮，但骨架完全一致——你已经会的东西，现在换成 UCOS 的命名和它真正的实现顺序。

## 1. 任务栈布局：StkPtr 指向的"伪造现场"

µC/OS-III 的任务栈初始化结果（PDF p.122~123 的注释表格）长这样——从高地址到低地址：

| 栈地址方向 | 内容 | 含义 |
|------|------|------|
| 高地址（栈底）↓低地址（栈顶） | 0x01000000 | xPSR（置 Thumb 位） |
| | p_task | PC：任务函数入口 |
| | OS_TaskReturn | LR：任务意外返回的去处 |
| | 0x12121212 | R12（填充标记） |
| | 0x03030303 | R3（填充标记） |
| | 0x02020202 | R2（填充标记） |
| | p_stk_limit 或填充值 | R1（UCOS 放栈水位指针，MiniOS 用填充值） |
| | p_arg | R0：任务函数参数 |
| | 0xFFFFFFFD | EXC_RETURN（线程模式 + PSP） |
| | 0x11111111 | R11（填充标记） |
| | 0x10101010 | R10（填充标记） |
| | 0x09090909 | R9（填充标记） |
| | 0x08080808 | R8（填充标记） |
| | 0x07070707 | R7（填充标记） |
| | 0x06060606 | R6（填充标记） |
| | 0x05050505 | R5（填充标记） |
| ← 栈顶 StkPtr | R4（填充标记，硬件出栈时先取它） |

理解这张表的钥匙（FreeRTOS 课第 6 课的机制二，原样复用）：**任务第一次"运行"，走的是异常返回的硬件出栈路径**——硬件从 PSP 依次弹出 R0、R1、R2、R3、R12、LR、PC、xPSR 然后跳转。所以栈里得预先埋好：PC = 任务入口（跳去哪）、R0 = p_arg（参数）、xPSR = 0x01000000（Thumb 位必须为 1）。而 R4~R11 和 EXC_RETURN 是 PendSV 切换汇编手动保存/恢复的，也一并预埋。

> ⚠️ 填充值（0x12121212 等）不是随便写的：它们一是让寄存器初值"可辨认"（调试时看到 0x05050505 就知道是 R5 的位置），二是栈溢出检查的参照物——以后检测栈被踩，就查这些标记还在不在。MiniOS 的 R1 位置用 0x01010101 填充（UCOS 放的是 p_stk_limit 栈水位指针，我们砍掉了水位检查功能）。

## 2. OSTaskStkInit：伪造一次"刚被中断"

µC/OS-III 的 OSTaskStkInit（原型见 PDF p.148~150 的 API 说明）是移植层函数，职责一句话：**把任务栈填成"这个任务刚被中断、现场完整"的样子**，返回新栈顶存入 TCB。MiniOS 版（os_task.c）：

```c
/* ---------- MiniOS/os_task.c：任务栈初始化 ---------- */
#include "os_core.h"

/* 任务意外返回（本不该发生）时的去处：死循环兜底 */
static void  OS_TaskReturn (void)
{
    for (;;) { ; }
}

CPU_STK *OSTaskStkInit (OS_TASK_PTR  p_task,
                        void        *p_arg,
                        CPU_STK     *p_stk_base,
                        CPU_STK_SIZE stk_size)
{
    CPU_STK *p_sp;

    p_sp = &p_stk_base[stk_size];        /* ① 从栈底（高地址）开始 */
    *--p_sp = 0x01000000u;               /* ② xPSR：置 Thumb 位 */
    *--p_sp = (CPU_STK)p_task;           /* ③ PC：任务函数入口 */
    *--p_sp = (CPU_STK)OS_TaskReturn;    /* ④ LR：意外返回的兜底函数 */
    *--p_sp = 0x12121212u;               /* ⑤ R12 填充 */
    *--p_sp = 0x03030303u;               /* ⑥ R3 填充 */
    *--p_sp = 0x02020202u;               /* ⑦ R2 填充 */
    *--p_sp = 0x01010101u;               /* ⑧ R1 填充（UCOS 放 p_stk_limit） */
    *--p_sp = (CPU_STK)p_arg;            /* ⑨ R0：任务参数 */
    *--p_sp = 0xFFFFFFFDu;               /* ⑩ EXC_RETURN：线程模式 + PSP */
    *--p_sp = 0x11111111u;               /* ⑪ R11 ~ R4 填充 */
    *--p_sp = 0x10101010u;
    *--p_sp = 0x09090909u;
    *--p_sp = 0x08080808u;
    *--p_sp = 0x07070707u;
    *--p_sp = 0x06060606u;
    *--p_sp = 0x05050505u;
    *--p_sp = 0x04040404u;               /* ⑫ R4 在最低地址，即"栈顶" */
    return p_sp;                         /* ⑬ 新栈顶 → 调用者存入 TCB->StkPtr */
}
```

对照 µC/OS-III 的初始化注释（PDF p.122~123）：布局逐字一致（除了 R1 的水位指针简化成填充值）。注意入栈顺序和硬件出栈顺序恰好相反——硬件后进先出，栈顶第一个被取走的必须是 R4。

## 3. OS_CPU_PendSV_Handler：逐行拆解切换汇编

切换的"换人区"就是 PendSV 中断服务函数。下面的版本以 µC/OS-III 的 os_cpu_a.asm（PDF p.141~144）为蓝本，砍掉 FPU 处理，命名用 UCOS 风格。先对照 FreeRTOS 课的 xPortPendSVHandler 回忆三步曲：**保存现场 → 选任务 → 恢复现场**，然后看 UCOS 的编排：

```c
; ---------- MiniOS/os_cpu_a.asm：PendSV 切换 ----------
; 注：完整版（µC/OS-III）还要处理 FPU（TST R14,#0x10 → VSTMDBEQ {S16-S31}），
;     本课用最简版：任务不使用浮点指令（Cortex-M4 默认惰性压栈仍会保护 S0~S15）。
    PRESERVE8

OS_CPU_PendSV_Handler
    CPSID   I                        ; ① 关中断：保护下面"选任务"过程不被插队
    MRS     R0, PSP                  ; ② R0 = 当前任务栈顶（硬件已自动压栈
                                     ;    R0~R3/R12/LR/PC/xPSR 到任务栈上）
    STMFD   R0!, {R4-R11, R14}       ; ③ 手动补压：硬件不保存的 R4~R11 + EXC_RETURN
    MOV32   R1, OSTCBCurPtr
    LDR     R1, [R1]
    STR     R0, [R1]                 ; ④ OSTCBCurPtr->StkPtr = R0（现场保存完成）

    MOV     R4, LR                   ; ⑤ 暂存 EXC_RETURN（下面的 BL 会破坏 LR！）
    BL      OS_SchedNew              ; ⑥ 选下一个任务：更新 OSTCBHighRdyPtr
                                     ;    （第 9 课填真算法；本课测试用手动指定）
    MOV32   R1, OSTCBHighRdyPtr
    LDR     R2, [R1]                 ; R2 = 新任务 TCB
    MOV32   R1, OSTCBCurPtr
    STR     R2, [R1]                 ; ⑦ OSTCBCurPtr = OSTCBHighRdyPtr

    ORR     LR, R4, #0x04            ; ⑧ 用暂存的 EXC_RETURN 组装返回模式
                                     ;    （bit2=1 → 线程模式 + PSP，UCOS 原版同款）
    LDR     R0, [R2]                 ; ⑨ R0 = 新任务栈顶（TCB 第一个成员！）
    LDMFD   R0!, {R4-R11, R14}       ; ⑩ 出栈新任务的 R4~R11 + EXC_RETURN
    MSR     PSP, R0                  ; ⑪ PSP = 新任务栈剩余栈顶
    CPSIE   I                        ; ⑫ 开中断
    BX      LR                       ; ⑬ 异常返回：硬件自动出栈 R0~R3/R12/LR/PC/xPSR，
                                     ;    跳到新任务上次被切走的那条指令继续跑
```

逐段消化（对照 FreeRTOS 第 7 课的逐段分析）：

- **②③④ 保存现场**：进 PendSV 时硬件已经把 R0~R3、R12、LR、PC、xPSR 压进任务栈（中断入栈用的正是任务栈），汇编只需补压 R4~R11 和 R14（EXC_RETURN，恢复时判断 FPU 要用，我们保留它以便将来扩展）。`STR R0,[R1]` 把新栈顶写回 TCB——注意这更新的是"当前任务"的 StkPtr。
- **⑤⑥ 选任务**：`BL OS_SchedNew` 会改写 LR（返回地址）和 R0~R3，所以先 `MOV R4, LR` 把 EXC_RETURN 藏进 R4（µC/OS-III 原版就是这么干的，PDF p.142）。调 C 函数时 CPU 在 Handler 模式，栈用的是 MSP，与任务栈互不干扰。
- **⑧⑨⑩⑪⑬ 恢复现场**：`ORR LR, R4, #0x04` 先于 LDMFD 执行——因为 LDMFD 会覆盖 R4 和 R14！组装好返回模式后，取新栈顶、手动出栈 9 个寄存器、PSP 就位，`BX LR` 异常返回，硬件自动弹出剩余 8 个寄存器，新任务从上次暂停处继续执行。

> 💡 关键顺序记忆法：**先"组返回模式"，再"碰新栈"**。UCOS 把 `ORR LR, R4, #0x04` 放在 LDMFD 之前，正是为了避免 LDMFD 把 R4（暂存的 EXC_RETURN）冲掉。FreeRTOS 的处理不同（它把 EXC_RETURN 存进栈帧，恢复时用 LDMIA 出栈的 r14 直接 BX），两条路殊途同归——你现在能看出两种移植风格的区别了。

## 4. OSCtxSw 与 OSStartHighRdy：触发切换与启动第一个任务

切换的扳机：往 ICSR 的 PENDSVSET（bit28）写 1，挂起 PendSV（µC/OS-III 的 OSCtxSw/OSIntCtxSw 就是这个，PDF p.140）：

```c
; ---------- MiniOS/os_cpu_a.asm：触发切换 ----------
OSCtxSw
OSIntCtxSw                          ; 两个标号指向同一段代码（UCOS 原版同款）
    LDR     R0, =0xE000ED04         ; ICSR 寄存器地址
    LDR     R1, =0x10000000         ; bit28：PENDSVSET
    STR     R1, [R0]                ; 挂起 PendSV
    BX      LR                      ; 返回；中断使能后 PendSV 立即执行

; ---------- os_cpu.h 中的宏 ----------
#define  OS_TASK_SW()   OSCtxSw()
```

第一个任务怎么"出生"？µC/OS-III 的 OSStartHighRdy（PDF p.129~131）用了一个巧妙的技巧——先设好 PSP 和 CONTROL，再直接"手动出栈"跳进任务，不走异常返回：

```c
; ---------- MiniOS/os_cpu_a.asm：启动第一个任务（第 9 课 OSStart 调用） ----------
OSStartHighRdy
    CPSID   I                        ; ① 关中断
    MOV32   R0, 0xE000ED22           ; ② SHPR3 的 PendSV 优先级字段 [23:16]
    MOV32   R1, 0xFF                 ;    配置 PendSV 为最低优先级（0xFF）
    STRB    R1, [R0]
    MOV32   R0, OSTCBHighRdyPtr
    LDR     R2, [R0]                 ; ③ R2 = 第一个任务的 TCB
    LDR     R0, [R2]                 ; ④ R0 = 其栈顶（StkPtr）
    MSR     PSP, R0                  ; ⑤ PSP 指向任务栈
    MRS     R0, CONTROL
    ORR     R0, R0, #2               ; ⑥ CONTROL.SPSEL=1：线程模式改用 PSP
    MSR     CONTROL, R0              ;    （写后立即生效，SP 当场切到 PSP）
    ISB
    LDMFD   SP!, {R4-R11, LR}        ; ⑦ 手动出栈：R4~R11 + EXC_RETURN
    LDMFD   SP!, {R0-R3}             ; ⑧ R0 = p_arg，R1~R3 = 填充值
    LDMFD   SP!, {R12, LR}           ; ⑨ R12、LR = OS_TaskReturn
    LDMFD   SP!, {R1, R2}            ; ⑩ R1 = PC（任务入口！），R2 = xPSR
    CPSIE   I                        ; ⑪ 开中断
    BX      R1                       ; ⑫ 跳进任务函数——任务第一次运行
```

注意 ⑦~⑩ 的四次出栈：**LR 先收 EXC_RETURN、再收 OS_TaskReturn、最后收进 R1 的是 PC**——对照第 1 节的栈帧表，正好把 17 个字全部出完，SP 回到栈底。任务第一次运行不走硬件出栈，而是由这段汇编"亲手"把寄存器摆好再 `BX R1`。µC/OS-III 教材注释特意提醒："重点留意 R1 寄存器会从任务栈中得到任务入口函数的地址"（PDF p.130）。

## 5. 本课交付：裸任务切换验证

把三块拼起来，先不写调度器——用"手动指定下一个任务"的方式验证切换链路（os_cpu_a.asm 里的 `OS_SchedNew` 暂时是空壳 C 函数，测试代码直接改 `OSTCBHighRdyPtr`）：

```c
/* ---------- MiniOS/os_sched.c：第 8 课占位版 ---------- */
void  OS_SchedNew (void)
{
    /* 空壳：第 9 课用 OS_PrioGetHighest() 填真算法。
     * 本课测试在调用 OSCtxSw() 前手动指定 OSTCBHighRdyPtr */
}

/* ---------- MiniOS/main.c：第 8 课验收测试 ---------- */
#include "os_core.h"
#include "usart.h"

OS_TCB    Task1_TCB;
CPU_STK   Task1Stk[64];
OS_TCB    Task2_TCB;
CPU_STK   Task2Stk[64];

void  task1 (void *p_arg)
{
    for (;;) {
        printf("task1 running\r\n");
        OSTCBHighRdyPtr = &Task2_TCB;   /* 手动"选"下一个任务（第 9 课删除此行） */
        OSCtxSw();                      /* 触发 PendSV 切换 */
    }
}

void  task2 (void *p_arg)
{
    for (;;) {
        printf("task2 running\r\n");
        OSTCBHighRdyPtr = &Task1_TCB;   /* 手动"选"回 task1 */
        OSCtxSw();
    }
}

int main (void)
{
    HAL_Init();
    uart_init(115200);
    OSInit();

    /* 初始化两个任务栈，栈顶写入各自的 TCB */
    Task1_TCB.StkPtr = OSTaskStkInit((OS_TASK_PTR)task1, (void *)0,
                                     &Task1Stk[0], 64u);
    Task2_TCB.StkPtr = OSTaskStkInit((OS_TASK_PTR)task2, (void *)0,
                                     &Task2Stk[0], 64u);

    OSTCBHighRdyPtr = &Task1_TCB;       /* 第一个任务：task1 */
    OSTCBCurPtr     = &Task1_TCB;
    OSStartHighRdy();                   /* 汇编启动，不返回 */
    for (;;) { ; }
}
```

运行流程：main → OSStartHighRdy 跳进 task1 → task1 打印 → 手动指定 task2 → OSCtxSw 挂起 PendSV → PendSV 保存 task1、恢复 task2 → task2 打印 → 手动指定 task1 → 切换……串口上 `task1 / task2` 无限交替。虽然"选谁"还是人肉指定的，但**保存/恢复/跳转的完整链路已经全部真实运转**——下一课把 `OS_SchedNew` 填上真算法，调度器就诞生了。

## 动手练习（约 30 分钟）

### 练习 8.1：写下栈初始化与切换汇编

- 1️⃣ 在 `MiniOS/` 下新建 `os_task.c`（OSTaskStkInit + OS_TaskReturn）和 `os_cpu_a.asm`（OS_CPU_PendSV_Handler、OSStartHighRdy、OSCtxSw），逐行抄写并加自己的注释——重点标注"为什么要先 ORR 再 LDMFD"和"为什么 TCB 第一个成员零偏移取栈顶"。
- 2️⃣ 把第 5 节的测试 main 加进工程，下载运行，串口应无限交替打印 task1/task2。
- 3️⃣ 在 `OS_CPU_PendSV_Handler` 的 `BL OS_SchedNew` 处打断点，单步走一遍 ①~⑬，Watch 里盯住 `r0`（PSP）：确认 `STR R0,[R1]` 前后 TCB.StkPtr 的变化、`LDMFD` 前后 SP 的走向。
- 4️⃣ 验收标准：能不看笔记，白板默写 13 步汇编，并指出"保存现场""选任务""恢复现场"三个段落的分界线。

### 练习 8.2：Memory 窗口验证栈帧

- 1️⃣ 在 `OSTaskStkInit` 返回处打断点，Memory 窗口查看 Task1Stk 区域，对照本课第 1 节表格逐字核对 17 个字的布局（xPSR=0x01000000、PC=task1 地址、EXC_RETURN=0xFFFFFFFD……）。
- 2️⃣ 全速运行到 task1 第一次打印后打断，看当前 PSP 的值——它应该落在 Task1Stk 的"新栈顶"下方不远处（任务运行消耗了栈空间）。
- 3️⃣ 破坏性实验：把 `OSTaskStkInit` 里的 xPSR 值改成 0x00000000，重新编译运行，观察现象（提示：进 HardFault）。这能让你深刻理解"Thumb 位必须为 1"。
- 4️⃣ 验收标准：能画出"初始化栈帧 ↔ PendSV 保存的栈帧"两代帧在任务栈上的叠放关系，并解释为什么第一次切换后初始帧成为"死数据"。

## 自测（答完再点答案）

### 随堂小测 1

Q1. OSTaskStkInit 的核心目的是什么？

- A. 给任务栈分配堆内存
- B. 伪造"刚被中断"的栈帧，供首次切换恢复
- C. 计算任务栈的最大深度
- D. 把任务函数编译进内存

<details>
<summary>查看答案</summary>

B。按硬件异常入栈顺序预埋 xPSR/PC/LR/R0~R12/EXC_RETURN 等，任务第一次"运行"走异常返回路径，PC 槽里的任务入口就是跳转目标（PDF p.122~123）。

</details>

### 随堂小测 2

Q2. PendSV 汇编里 STMFD 手动压栈的是哪些寄存器？

- A. R0~R3、R12、LR、PC、xPSR
- B. R4~R11 和 R14（EXC_RETURN）
- C. 全部 16 个通用寄存器
- D. 仅 R4 和 LR 两个寄存器

<details>
<summary>查看答案</summary>

B。硬件在异常入口已自动压栈 R0~R3、R12、LR、PC、xPSR，汇编只需补压硬件不保存的 R4~R11 和 R14（PDF p.141）。

</details>

### 随堂小测 3

Q3. OS_CPU_PendSV_Handler 中 "MOV R4, LR" 的作用是？

- A. 保存任务函数的返回地址
- B. 把 EXC_RETURN 暂存起来，防止被 BL 破坏
- C. 切换 MSP 和 PSP 的指针
- D. 为 FPU 寄存器腾出位置

<details>
<summary>查看答案</summary>

B。BL OS_SchedNew 会改写 LR（装入返回地址），而 LR 里是进入 PendSV 时的 EXC_RETURN，先藏进 R4、切完再 ORR 组装回 LR（PDF p.142 原版同款操作）。

</details>

### 随堂小测 4

Q4. OSStartHighRdy 最后 "BX R1" 跳向哪里？

- A. 第一个任务函数入口
- B. 空闲任务函数入口
- C. 中断服务函数入口
- D. main 函数入口

<details>
<summary>查看答案</summary>

A。四次 LDMFD 手动出栈后，R1 拿到的是栈帧 PC 槽里的任务入口地址（OSTaskStkInit 时写入的 p_task），BX R1 即跳进任务（PDF p.130）。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》7.4~7.5 节（(PDF p.118~131)）——OSTaskCreate 里栈初始化调用与 OSStart/OSStartHighRdy 全程
- 📖 同书第 8 章 8.3~8.4 节（(PDF p.132~144)）——OSCtxSw 与 OS_CPU_PendSVHandler 的官方完整版（含 FPU 处理）
- 🔁 对照：[FreeRTOS 课程第 7 课（任务切换原理）](/my-blog/posts/freertos/0007-task-switching-pendsv/)——xPortPendSVHandler 逐行拆解，与本节 UCOS 版对照阅读
- 🔁 对照：[FreeRTOS 课程第 6 课（系统启动流程）](/my-blog/posts/freertos/0006-scheduler-startup/)——prvPortStartFirstTask 与 OSStartHighRdy 两种"第一跳"的对比

## 下一步

切换链路打通了——现在"换人"是全自动的，但"选谁"还是手动挡。下一课 MiniOS③：把 OS_SchedNew 填上真算法、实现 OSSched 与任务创建，收获第一个全自动运行的多任务 MiniOS。

| [← 上一课](/my-blog/posts/ucosiii/0007-minios-1-tcb-and-ready-list/) | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0009-minios-3-scheduler/) |