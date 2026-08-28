---
title: MDK 编译产物全解
published: 2026-08-09
description: 从 .c 到 .hex：MDK 编译链路、11 类编译产物、.htm 栈深分析与 .map 文件预告。
tags: [Toolbox, 嵌入式, STM32, MDK, 编译产物]
category: Toolbox
draft: false
prevTitle: MAP 文件深读
prevSlug: "toolbox/0002-map-file-deep-dive"
nextTitle: ""
nextSlug: ""
---

# MDK 编译产物全解

从 .c 到 .hex：你的代码经历了什么（正点原子《STM32 MAP 文件浅析》第 1 章）

**本课目标：**点了编译按钮后，MDK 在背后做了什么？学完你能认出 Output 目录里每一类文件（.o/.axf/.hex/.htm/.map…）是干什么的，说清"可重定向"和"不可重定向"的区别，并能用 .htm 文件查看工程真实栈深——这是后面读 MAP 文件、调栈溢出、做 Bootloader 的地基。

## 1. 编译链路：.c 是怎么变成 .hex 的

MDK 编译一次工程，会在 Output 目录生成 11 类、几十个文件（正点原子《STM32 MAP 文件浅析》第 1 章 (PDF p.3)）。这条流水线本质是三步：

```text
# 编译（compiler，ARMCC/GCC）
main.c ──────────────► main.o      // 每个 .c/.s 一个 .o，可重定向（地址还没定）
startup_stm32f4xx.s ──► startup.o

# 链接（linker，armlink）
main.o + startup.o + HAL*.o + ... ──► Project.axf   // 不可重定向，绝对地址已定

# 转换（fromelf）
Project.axf ──► Project.hex  // 带地址信息，ISP/仿真器下载用
Project.axf ──► Project.bin  // 纯代码，Bootloader 升级用
```

关键概念（(PDF p.3)）：

- **可重定向（relocatable）**：.o 文件里的代码/数据还没分配绝对地址，地址由链接器后续指定
- **不可重定向**：.axf 文件所有地址已定死，不能再改
- **仿真器下载调试用的是 .axf**，不是 .hex——因为它包含调试符号信息

## 2. 11 类文件一览

| 文件 | 是什么 | 你关心吗 |
|------|--------|----------|
| **.o** | 每个源文件编译出的可重定向对象文件 | ✅ 分散加载里会见到 |
| **.axf** | 链接产物，可执行对象，仿真调试用 | ✅ 下载调试依赖它 |
| **.hex** | 含地址信息的下载文件 | ✅ ISP 下载用 |
| **.htm** | 静态调用图 + 栈深分析 | ✅ 调栈大小神器 |
| **.map** | 链接器生成的详细清单 | ⭐⭐ 本课程主角 |
| .crf | 交叉引用浏览信息 | MDK 浏览功能用 |
| .d / .dep | 依赖文件 | 增量编译用 |
| .lnp | 链接输入文件 | 命令行链接用 |
| .lst | 编译器列表文件 | 反汇编排查用 |
| .build_log.htm | 编译日志 | 看编译警告/错误 |

## 3. .hex 和 .bin：下载双雄

两者都来自 .axf，区别一句话（(PDF p.4)）：

- **.hex**：Intel Hex 格式，**每行带地址信息**。ISP 软件（如 FlyMcu）解析地址后写入对应 Flash 地址
- **.bin**：**纯二进制代码，无地址**。Bootloader 升级场景用它，目标地址由 Bootloader 自己指定

> 💡 记忆锚点：**.hex 是"带快递单号的包裹"（地址），.bin 是"光秃秃的货物"（只有内容）**。发货方式不同，用的场景就不同。

## 4. .htm：免费的栈深分析器

.htm 文件（浏览器双击打开）包含整个工程的**静态调用图**，两大用途（(PDF p.4)）：

- ① 显示**最大栈深**及调用关系：例如例程中最大栈深 416 字节，调用链是 `__rt_entry_main → main → sys_stm32_clock_init → HAL_RCC_ClockConfig → HAL_InitTick → …`
- ② 显示**每个函数的栈深**及其调用关系

> ⚠️ 这个"最大栈深"只是**静态最低要求**——它没统计递归函数、函数指针调用、以及用内存管理（堆）的函数。正点原子经验法则：**实际栈深设置不低于静态值的 2 倍**。例程默认 Stack_Size 为 0x800（2048 字节），正是这个思路。

这个 2 倍法则在你做 FreeRTOS 任务栈规划时同样适用——FreeRTOS 的 `uxTaskGetStackHighWaterMark()` 就是干这个的运行时版。

## 5. .map 预告：下一课的主角

.map 文件是链接器生成的清单，包含 5 大部分（(PDF p.7)）：

1. 程序段交叉引用关系（Section Cross References）
2. 删除映像未使用的程序段
3. 映像符号表（Image Symbol Table）
4. 映像内存分布图（Memory Map of the image）
5. 映像组件大小（Image component sizes）

通过它你能知道：Flash/RAM 占用多少、具体到每个 .c 文件占多少、哪些函数没被用到被删了——第 2 课逐个解剖。

## 动手练习

### 练习 1.1：认领你的 Output 目录

- 1️⃣ 编译当前工程（EmbedOrigin_4s，含 LVGL + FATFS），打开 Output/OBJ 目录。
- 2️⃣ 对照第 2 节表格，把 11 类文件各找出一两个代表；数一数一共有多少个 .o 文件，想想要是 500 个源文件的工程会怎样。
- 3️⃣ 打开 .build_log.htm，找到最后一次编译的 "Program Size" 行，记下 Code/RO-data/RW-data/ZI-data 四个数——下一课你会真正看懂它们。

### 练习 1.2：用 .htm 看栈深

- 1️⃣ 双击打开工程 Output 下的 .htm 文件（若不存在，先完整编译一次）。
- 2️⃣ 找到"最大栈深"数值，对照启动文件里的 Stack_Size（`startup_stm32f4xx.s` 里 `Stack_Size EQU 0x400` 之类），验证是否满足"2 倍法则"。
- 3️⃣ 思考题：如果最大栈深 800 字节、Stack_Size 只有 0x400（1024 字节），会发生什么？（提示：第 3 课启动文件里你会看到栈的真相）

## 自测

### 随堂小测 1

仿真器在线调试时下载的是哪个文件？

- A. .hex 文件，它包含地址信息
- B. .axf 文件，它包含调试符号
- C. .bin 文件，它最纯净

<details>
<summary>查看答案</summary>

B。仿真器下载调试用 .axf（含调试符号），.hex 是 ISP 下载用，.bin 是 Bootloader 用（PDF p.3-4）。
</details>

### 随堂小测 2

"可重定向"的 .o 文件含义是？

- A. 代码已经烧录到固定地址
- B. 地址尚未分配，由链接器指定
- C. 文件可以被移动位置

<details>
<summary>查看答案</summary>

B。.o 是编译产物，地址未定，链接时由 armlink 统一分配（PDF p.3）。
</details>

### 随堂小测 3

Bootloader 升级固件时一般用？

- A. .bin，地址由引导程序指定
- B. .hex，地址内嵌在文件里
- C. .axf，符号信息最全

<details>
<summary>查看答案</summary>

A。Bootloader 场景目标地址由 Bootloader 自己决定，用无地址的 .bin（PDF p.4）。
</details>

### 随堂小测 4

.htm 报告的"最大栈深"应如何使用？

- A. 直接等于 Stack_Size 设置值
- B. 乘以 2 作为栈大小的下限
- C. 与栈设置完全无关

<details>
<summary>查看答案</summary>

B。静态栈深未统计递归/函数指针，正点原子建议栈深设置不低于静态值的 2 倍（PDF p.4）。
</details>

## 推荐阅读

- 📖 正点原子《STM32 MAP 文件浅析 V1.1》第 1 章（PDF p.3~6）——本课全部依据
- 🔧 MDK 内置帮助：`uVision Help → B. File Types`——11 类文件的官方说明

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 2 课——解剖 .map 文件五大组成部分，真正看懂 Program Size 四个数（Code/RO/RW/ZI）。

| — | [课程目录](/my-blog/posts/toolbox/00-总览/) | [下一课 →](/my-blog/posts/toolbox/0002-map-file-deep-dive/) |