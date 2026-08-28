---
title: 初识 µC/OS-III
published: 2026-08-13
description: 认识第二个经典内核 µC/OS-III：源码三件套结构、与 FreeRTOS 的总体对比、课程 16 课路线图——主线是亲手造一个操作系统。
tags: [UCOSIII, 嵌入式, RTOS, 三件套, 源码结构, 课程路线图]
category: UCOSIII
draft: false
prevTitle: 移植与配置
prevSlug: "ucosiii/0002-porting-and-config"
nextTitle: ""
nextSlug: ""
---

# 初识 µC/OS-III

这是 µC/OS-III 系列课程笔记的第 1 课：第二个内核、三件套源码结构、以及本课程的真正目标——亲手造一个操作系统。**本课目标：**FreeRTOS 课里你已经看透了链表就绪表的内核；这课认识第二个经典内核 µC/OS-III——它的"位图就绪表"是另一派设计。学完你能说清 µC/OS-III 的源码三件套结构、它与 FreeRTOS 的总体差异，并理解本课程"手写 MiniOS"这条主线的意义。

## 1. µC/OS-III 是什么

µC/OS-III 读作 "Micro C O S Three"，是 Micrium 公司（Jean Labrosse 创立）的第三代实时内核（正点原子《µC/OS-III 开发指南 V1.5》第 1.1 节 (PDF p.13)）。它是 RTOS 家族的另一位重量级成员，与 FreeRTOS、RTX、RT-Thread 同类，但血统不同：**FreeRTOS 诞生于社区，µC/OS 诞生于教科书**——Labrosse 写《µC/OS: The Real-Time Kernel》时为了给书配代码而写了它，所以它的内核代码结构以"清晰教学"著称，是所有 RTOS 里最适合用来"拆开研究内核设计"的一个。

一句话理解多任务（与 FreeRTOS 课第 1 课完全一致的概念）：单核 CPU 某一时刻只能跑一个任务，是**任务调度器**在任务间高速切换，造成"同时运行"的错觉。µC/OS-III 的调度器同样按优先级决定下一刻跑谁（PDF p.13）。

## 2. 为什么学 µC/OS-III（而不是只学 FreeRTOS）

你已经学透 FreeRTOS 了，为什么还要学第二个内核？因为两个内核的设计哲学恰好互补，**对照学习才能看清"什么是操作系统共有的本质，什么是具体实现的选择"**：

| 维度 | FreeRTOS（已学） | µC/OS-III（本课程） |
|------|------|------|
| 就绪任务组织 | **链表**（列表+列表项） | **位图**（OSRdyGrp/OSRdyTbl） |
| 优先级方向 | 数值越大优先级越高 | **数值越小优先级越高** |
| 同优先级多任务 | 时间片轮转（可选） | 时间片轮转（内建） |
| 任务间同步 | 队列/信号量/事件组/任务通知 | 信号量/互斥量/消息队列/事件标志/**任务内嵌信号量与消息队列** |
| 临界区 | 关中断 + BASEPRI | 锁定调度器为主 + BASEPRI（中断禁用时间极短） |
| 源码组织 | 单内核（tasks.c/queue.c/list.c…） | **三件套**：µC/OS-III + µC/CPU + µC/LIB |
| 定位 | 社区驱动、极度普及 | 教学经典、结构清晰、商用授权（后转开源） |

关键差异剧透（本课程会展开）：**位图就绪表**让 µC/OS-III 找"最高优先级就绪任务"只需查一次表，是 O(1) 的；而 FreeRTOS 的链表就绪表需要遍历。两种都是教科书级设计，第 4 课和第 7 课（MiniOS 第一步）你会亲手实现位图算法。

## 3. 源码三件套：µC/OS-III 的"俄罗斯套娃"

µC/OS-III 不像 FreeRTOS 只有一个内核目录，它由三个独立组件组成（PDF 第 1.3 节 (PDF p.20)）：

| 组件 | 职责 | 关键内容 |
|------|------|------|
| **µC/OS-III**（uC-OS3-x.x.x） | 实时内核本体 | `Source/`（os_core/os_task/os_sem/os_mutex/os_q/os_flag/os_tmr/os_mem…）、`Ports/`（ARM-Cortex-M 移植）、`Cfg/`（os_cfg.h 模板） |
| **µC/CPU**（uC-CPU-x.x.x） | CPU 抽象层：数据类型、开关中断、时间戳、CPU 状态 | `cpu_core.c/h`、`ARM-Cortex-M/`（cpu_a.s 汇编）、`BSP/`（时间戳定时器） |
| **µC/LIB**（uC-LIB-x.x.x） | 标准库补充：内存拷贝、字符串、数学函数（不依赖编译器库） | `lib_mem.c`、`lib_str.c`、`lib_math.c` 等 |

> 💡 对照 FreeRTOS：FreeRTOS 把 CPU 相关的东西并进了 portable/ 移植层；µC/OS-III 把它拆成了独立的 µC/CPU 组件。拆开的好处是移植层更薄、内核更纯——这对我们第 7~12 课"手写 MiniOS"是极好的参考样板。

版本情报：教材配套源码为 µC/OS-III V3.08.01 + µC/CPU V1.32.01。内核原理与版本基本无关，但看源码时以你分支工程的实际版本为准。

## 4. 本课程路线图：16 课，主线是"造一个操作系统"

1. **入门**（01~02）：概念 + 移植配置
2. **UCOS 机制**（03~06）：任务基础 / 位图就绪表 / 任务切换 / 中断与临界区——处处对照 FreeRTOS
3. **手写 MiniOS**（07~12）：⭐ 本课程核心。从零实现一个可运行的最小内核——TCB 与位图就绪表 → PendSV 上下文切换 → 调度器与临界区 → 时基与任务延时 → 信号量 → 三内核验收对比
4. **UCOS 应用**（13~16）：任务管理 / 信号量与互斥 / 消息队列与事件标志 / 软件定时器与内存管理

> ⚠️ 前置依赖：MiniOS 系列（07~12）需要 FreeRTOS 课程第 6/7 课（启动流程、PendSV 切换）打底。如果还没学到那两课，建议先补上再进 MiniOS。

## 动手练习（约 15 分钟）

### 练习 1.1：在 UCOS 分支工程里指认三件套

- 1️⃣ 切换到你的 µC/OS-III 分支工程，找到三个组件目录（一般是 `Middlewares/` 或 `uC-OS3/`、`uC-CPU/`、`uC-LIB/` 之类命名）。
- 2️⃣ 进入 µC/OS-III 的 `Source/`，数一下 os_ 开头的源文件，找到 os_core.c / os_task.c / os_sem.c / os_mutex.c / os_q.c / os_flag.c / os_tmr.c / os_mem.c。
- 3️⃣ 对照 FreeRTOS 分支工程：FreeRTOS 的 tasks.c/queue.c/list.c 和 UCOS 的 os_task.c/os_core.c 分别承担什么角色？写一段 3 行的笔记。

### 练习 1.2：看一段 UCOS 风格的任务创建

- 1️⃣ 在 UCOS 工程里找到示例任务创建代码（搜索 `OSTaskCreate`），对比 FreeRTOS 的 `xTaskCreate`，先感受两者的形参风格差异（提示：UCOS 需要任务栈数组 + 栈大小 + 优先级 + 选项 + 错误码指针……）。
- 2️⃣ 思考题：UCOS 的"优先级数值越小越高"和 FreeRTOS 相反——为什么有的 RTOS 这么设计？（提示：位图算法中"最高优先级"对应最高位，见第 4 课）

## 自测（答完再点答案）

### 随堂小测 1

Q1. µC/OS-III 找"最高优先级就绪任务"用的是？

- A. 链表遍历查找
- B. 位图就绪表查表
- C. 哈希表映射查找

<details>
<summary>查看答案</summary>

B。OSRdyGrp/OSRdyTbl 位图就绪表，O(1) 查最高优先级（本课表格 + 第 4 课展开）。

</details>

### 随堂小测 2

Q2. µC/OS-III 的优先级数值大小与优先级高低关系是？

- A. 数值越大优先级越高
- B. 数值越小优先级越高
- C. 与数值大小完全无关

<details>
<summary>查看答案</summary>

B。与 FreeRTOS 相反，µC/OS-III 数值越小优先级越高（PDF p.84）。

</details>

### 随堂小测 3

Q3. µC/OS-III 源码由哪三件套组成？

- A. µC/OS-III、µC/CPU、µC/LIB
- B. µC/OS-III、µC/GUI、µC/FS
- C. µC/OS-III、µC/OS-II、µC/OS

<details>
<summary>查看答案</summary>

A。内核 + CPU 抽象层 + 标准库补充，三个独立组件（PDF p.20~26）。

</details>

### 随堂小测 4

Q4. 本课程（07~12 课）的核心主线是？

- A. UCOS 全部 API 逐个实验
- B. 手写 MiniOS 最小内核
- C. UCOS 与 LVGL 集成开发

<details>
<summary>查看答案</summary>

B。手写 MiniOS：位图就绪表→上下文切换→调度器→时基→信号量，亲手实现一个操作系统。

</details>

## 推荐阅读

- 📖 正点原子《µC/OS-III 开发指南 V1.5》第 1 章（PDF p.13~27）——本课全部依据
- 🌐 [Weston Embedded（Micrium 后继）µC/OS-III 主页](https://weston-embedded.com/uc-os-iii)——官方文档与代码库入口
- 📕 [《µC/OS-III: The Real-Time Kernel》](https://weston-embedded.com/uc-os-iii)——内核作者 Labrosse 亲写的书，配合本章读"Introduction"
- 🔁 对照：[FreeRTOS 课程第 1 课（初识 FreeRTOS）](/my-blog/posts/freertos/0001-intro-to-freertos/)——本课的对比基准

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 2 课——把 µC/OS-III 移植进你的分支工程并跑起第一个任务，亲手摸到三件套的移植层。

| — | [课程目录](/my-blog/posts/ucosiii/00-总览/) | [下一课 →](/my-blog/posts/ucosiii/0002-porting-and-config/) |