---
title: 初识 FreeRTOS
published: 2026-08-12
description: FreeRTOS 系列课程第 1 课：从裸机思维切换到 RTOS 思维，理解调度器制造"并发假象"的原理，认识 FreeRTOS 相比裸机与 µC/OS 的优势、8 个核心源码文件与完整学习路线图。
tags: [FreeRTOS, 嵌入式, RTOS, 思维转变, 源码结构, 学习路线]
category: FreeRTOS
draft: false
prevTitle: 移植与第一个任务
prevSlug: "freertos/0002-porting-and-first-task"
nextTitle: ""
nextSlug: ""
---

# 初识 FreeRTOS

这是 FreeRTOS 系列课程笔记的第 1 课：RTOS 是什么、为什么选 FreeRTOS、它的源码长什么样。**本课目标：**从"裸机思维"切换到"操作系统思维"的第一步。学完你能说清：RTOS 凭什么让多个任务"同时跑"、FreeRTOS 相比裸机和 µC/OS 的优势、以及它的源码里每个文件是干什么的。这是后续 16 课的路线图。

## 1. 从裸机到 RTOS：思维转变

你现在的工程是典型的裸机程序：`while(1)` 里顺序执行各个模块，靠定时器中断和按键扫描驱动一切。裸机在单任务场景很舒服，但一旦任务变多（显示、采集、存储、通信……），主循环就变成"大杂烩"——每个模块都得让路，代码越写越乱，实时性也没保证。

RTOS 解决这个问题的思路是：**把大循环拆成多个独立任务，交给调度器管理**。CPU 只有一个核，某一时刻只能跑一个任务，但调度器让任务高速切换，造成"同时运行"的错觉（正点原子《FreeRTOS 开发指南 V1.12》第 1.1.1 节（PDF p.15））：

```c
// 裸机：一个大循环，所有模块排队
while (1) {
    key_scan();      // 扫描按键
    lv_timer_handler(); // 刷 GUI
    adc_sample();    // 采数据
    save_to_sd();    // 存 SD 卡
}

// RTOS：每个模块一个任务，各自"独立运行"
void key_task(void)  { for(;;) { key_scan();        vTaskDelay(10); } }
void gui_task(void)  { for(;;) { lv_timer_handler(); vTaskDelay(5);  } }
void adc_task(void)  { for(;;) { adc_sample();      vTaskDelay(1);  } }
void sd_task(void)   { for(;;) { save_to_sd();      vTaskDelay(100);} }
```

关键区别：裸机的"同时"是代码层叠出来的假象，RTOS 的"同时"是**调度器用可预测的规则分配 CPU 时间**。RTOS 的调度器行为必须是可预测的——这正是嵌入式实时系统最看重的特性。

> 💡 学 FreeRTOS 最大的坎不是 API，而是思维：任务不是"函数调用"而是"独立程序"，它们之间不能共享局部变量，只能通过队列/信号量等机制通信。从第 2 课开始，我们会反复强化这一点。

## 2. 为什么选 FreeRTOS

RTOS 家族成员不少：µC/OS、FreeRTOS、RTX、RT-Thread……为什么 FreeRTOS 是当前嵌入式界的事实标准（PDF 第 1.1.2 节（PDF p.16））？

| 理由 | 说明 |
|------|------|
| 🆓 免费 | MIT 开源许可，商业产品可免费使用，无需开源自己的应用代码 |
| 🧩 简单 | 内核源码只有 8 个 .c 文件，比 µC/OS 精简得多 |
| 🌍 使用广泛 | 几乎所有带 Wi-Fi/蓝牙协议栈的芯片 SDK 都内置 FreeRTOS；ST 的 Cube 生态也原生支持 |
| 📚 资料齐全 | 官网提供官方书籍、API 参考手册、大量例程（虽然偏英文） |
| 🔧 可移植性强 | 支持 F1/F4/F7/H7 等几乎所有 MCU 架构 |

## 3. 源码初探：8 个文件撑起一个操作系统

FreeRTOS 内核（V10.4.6）的源码在 `Source/` 目录下，全部核心代码只有 8 个文件（PDF 第 1.3.2 节（PDF p.24））：

| 文件 | 职责 | 对应本课程哪一课 |
|------|------|------|
| `tasks.c` | 任务管理：创建/删除/挂起/恢复、调度器 | 第 3~7 课 |
| `queue.c` | 队列（含信号量的实现基础） | 第 8、9 课 |
| `list.c` | 列表与列表项（内核的"血管"） | 第 5 课 |
| `timers.c` | 软件定时器 | 第 10 课 |
| `event_groups.c` | 事件标志组 | 第 11 课 |
| `stream_buffer.c` | 流式缓冲区 | 本课程不深讲 |
| `croutine.c` | 协程（老特性，基本不用） | 了解即可 |
| `include/` + `portable/` | 头文件 + 架构移植层（连接硬件与内核的桥梁） | 第 2、13 课 |

> ⚠️ 注意区分两个概念：**FreeRTOS**（完整发布包，含内核 + FreeRTOS-Plus 组件）和 **FreeRTOS 内核**（V10.4.6，真正学的东西）。教材讲的都是内核，下文中"FreeRTOS"均指内核。

移植层（`portable/`）是连接"软件内核"和"硬件芯片"的桥梁——同一个 tasks.c 跑在所有芯片上，不同芯片只换 portable 下的几个文件（任务切换的汇编、SysTick 配置等）。这个"内核与硬件隔离"的设计，是 FreeRTOS 可移植性的根基，第 2 课移植时会亲手摸到它们。

## 4. 学习路线图

本课程 17 课按教材 20 章重组为五个阶段：

1. **入门**（01~02）：概念 + 移植跑通
2. **任务机制·原理深入**（03~07）：任务/列表/启动流程/任务切换——逐行源码分析
3. **同步与通信**（08~12）：队列/信号量/软件定时器/事件组/任务通知
4. **系统机制**（13~15）：中断与临界区/时间管理/内存管理
5. **进阶与综合**（16~17）：低功耗/空闲任务 + LVGL×FreeRTOS 产品多任务架构

第 7 章（列表）、第 8 章（启动流程）、第 9 章（任务切换）是全书最硬的骨头，也是"原理深入"的核心，届时会逐函数读源码。

## 动手练习（约 15 分钟）

### 练习 1.1：在 FreeRTOS 工程里指认源码

- 1️⃣ 切换到你的 FreeRTOS 分支工程，找到 FreeRTOS 内核源码目录（一般是 `Middlewares/Third_Party/FreeRTOS/Source/` 或类似路径）。
- 2️⃣ 对照上表，确认 8 个核心文件都在；打开 `portable/`，找到你的移植层目录（应该包含 `port.c`、`portmacro.h` 和编译器相关文件，如 `RVDS/ARM_CM4F/`）。
- 3️⃣ 在 `tasks.c` 里搜 `xTaskCreate` 的函数定义，看一眼它的形参列表——和 PDF p.19 的官方示例对照。

### 练习 1.2：读懂官方示例

- 1️⃣ 抄写并阅读下面这段 PDF p.18 的官方创建任务示例，说出 6 个形参各是什么。

```c
void vTaskCode(void *pvParameters)
{
    configASSERT(((uint32_t)pvParameters) == 1);
    for (;;) {
        /* 任务代码 */
    }
}

void vOtherFunction(void)
{
    BaseType_t xReturned;
    TaskHandle_t xHandle = NULL;

    xReturned = xTaskCreate(
        vTaskCode,        /* 任务函数 */
        "NAME",           /* 任务名 */
        STACK_SIZE,       /* 任务栈大小，单位：字 */
        (void *)1,        /* 传给任务的参数 */
        tskIDLE_PRIORITY, /* 优先级 */
        &xHandle);        /* 任务句柄 */
    if (xReturned == pdPASS) {
        vTaskDelete(xHandle);
    }
}
```

- 2️⃣ 思考题：任务函数的 `for(;;)` 意味着什么？为什么任务函数不能"返回"？（提示：返回了任务就结束了，RTOS 没有"主函数"概念）

## 自测（答完再点答案）

### 随堂小测 1

Q1. RTOS 让多个任务"同时运行"的本质是？

- A. 多核并行，每核跑一个任务
- B. 调度器按规则快速切换任务，制造并发假象
- C. 任务之间轮流独占整机直到完成

<details>
<summary>查看答案</summary>

B。单核 CPU 同一时刻只能跑一个任务，调度器的高速切换造成"同时"的错觉（PDF p.15）。

</details>

### 随堂小测 2

Q2. FreeRTOS 的许可证类型是？

- A. GPL，衍生代码必须开源
- B. MIT，商用免费且无需开源
- C. 商业授权，按件收费

<details>
<summary>查看答案</summary>

B。MIT 开源许可，商用免费、无需开源应用代码（PDF p.16）。

</details>

### 随堂小测 3

Q3. 内核源码中"连接软件与硬件"的桥梁是？

- A. include 目录
- B. portable 目录
- C. queue.c

<details>
<summary>查看答案</summary>

B。portable 里的移植文件（port.c、portmacro.h 等）针对不同芯片架构，是内核与硬件的隔离层（PDF p.25）。

</details>

### 随堂小测 4

Q4. 一个 RTOS 任务函数的典型结构是？

- A. for(;;) 无限循环，不能返回
- B. 普通函数，执行完自动销毁
- C. while(0) 单次执行后挂起

<details>
<summary>查看答案</summary>

A。任务函数通常是无限循环，返回即任务结束（PDF p.18 官方示例）。

</details>

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 1 章（PDF p.15~27）——本课全部依据
- 🌐 [FreeRTOS 官网](https://www.freertos.org/)——点 Download FreeRTOS 看源码包结构，点 Getting Started 看官方入门文档
- 📕 [Mastering the FreeRTOS™ Real Time Kernel](https://www.freertos.org/Documentation/RTOS_book.html)——官方免费书，英文，配合本课看前两章

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 2 课——把 FreeRTOS 移植进你的分支工程并跑起第一个任务，亲手摸到 portable 那层"桥梁"。

| — | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0002-porting-and-first-task/) |