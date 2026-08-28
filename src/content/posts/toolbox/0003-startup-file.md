---
title: 启动文件：从复位到 main
published: 2026-08-11
description: 读懂 startup_stm32f4xx.s：栈堆开辟、向量表、Reset_Handler 与 __main 完整启动流程。
tags: [Toolbox, 嵌入式, STM32, 启动文件, 汇编]
category: Toolbox
draft: false
prevTitle: 调试器实战
prevSlug: "toolbox/0004-debugger-in-action"
nextTitle: MAP 文件深读
nextSlug: "toolbox/0002-map-file-deep-dive"
---

# 启动文件：从复位到 main

上电后第一个程序做了什么（正点原子《STM32 启动文件浅析》全文）

**本课目标：**你已经知道了 map 里的 RW 会被拷进 RAM、ZI 会被清零——但这活儿谁干的？就是本课的启动文件。学完你能：读懂 `startup_stm32f4xx.s` 每一行，说清上电后 CPU 从取地址到进入 main 的完整路径，并且能自己改栈/堆大小、给启动文件加中文注释。

## 1. 启动文件：上电后第一个执行的程序

启动文件由 ST 官方提供、用汇编写成，是系统**上电复位后第一个执行**的程序（(PDF p.3)）。它一口气干 7 件事：

1. 初始化堆栈指针 `SP = __initial_sp`
2. 初始化程序计数器 `PC = Reset_Handler`
3. 设置堆和栈的大小
4. 初始化中断向量表
5. 配置外部 SRAM 作为数据存储器（可选）
6. 调用 `SystemInit` 配置系统时钟（可选）
7. 调用 C 库 `__main` 初始化用户堆栈，最终调用 `main`

一句话：**它负责把汇编的世界平稳交接给 C 的世界**——这就是为什么每个 C 工程都要求有一个 `main`。

## 2. 汇编指令速查

读启动文件前，先把这些关键指令认全（(PDF p.3-4)）。注意 EQU/ALIGN/WEAK 是**编译器的伪指令**，不是 ARM 指令：

| 指令 | 作用 | 类似 C |
|------|------|--------|
| EQU | 给数字常量取符号名 | #define |
| AREA | 汇编一个新的代码段或数据段 | -- |
| ALIGN | 指令/数据对齐（缺省 4 字节）[伪指令] | -- |
| SPACE | 分配一块内存空间 | -- |
| PRESERVE8 | 当前文件栈按 8 字节对齐 | -- |
| THUMB | 后面指令兼容 THUMB-2 指令集 | -- |
| EXPORT | 声明标号全局可用 | extern |
| DCD | 按字分配内存并初始化（4 字节对齐） | const 数组 |
| PROC/ENDP | 定义/结束一个子程序 | -- |
| WEAK | 弱定义：优先用外部同名定义 [伪指令] | __weak |
| IMPORT | 声明标号来自外部文件 | extern 引用 |
| LDR | 从存储器加载字 | -- |
| BLX | 跳转（保存返回地址，可切换状态） | 函数调用 |
| BX | 跳转（不返回） | goto |
| B | 跳转到标号 | goto |
| IF/ELSE/ENDIF | 汇编条件分支 | #if/#else |
| END | 文件结束 | -- |

## 3. 栈空间的开辟

启动文件开头先划一块栈（MDK 版写法，(PDF p.5)）：

```text
Stack_Size      EQU     0x400               // 栈大小 1024 字节（可改）
                AREA    STACK, NOINIT, READWRITE, ALIGN=3   // 段名 STACK，不初始化，8 字节对齐
Stack_Mem       SPACE   Stack_Size          // 分配 Stack_Size 字节连续空间
__initial_sp                             // 紧挨 SPACE 放置：栈的结束地址（栈顶）
```

要点：栈**从高地址往低地址生长**，所以结束地址就是栈顶 `__initial_sp`。它存局部变量、函数形参，由编译器自动分配释放。程序莫名进 HardFault，先怀疑是不是栈溢出（(PDF p.5)）。

## 4. 堆空间的开辟

紧接着划堆（(PDF p.5-6)）：

```text
Heap_Size       EQU     0x200               // 堆大小 512 字节
                AREA    HEAP, NOINIT, READWRITE, ALIGN=3
__heap_base                                 // 堆起始地址（低地址）
Heap_Mem        SPACE   Heap_Size
__heap_limit                                // 堆结束地址
                PRESERVE8                   // 之后代码按 8 字节对齐
                THUMB                       // 之后为 THUMB 指令
```

堆**从低往高生长**，与栈相反，专给 `malloc()`/`calloc()` 等动态分配用。💡 教材小技巧：正点原子自带 mymalloc/mymalloc 内存管理，不用 C 库 malloc，所以能把 Heap_Size 设成 0 省内存（(PDF p.6)）。

## 5. 中断向量表

向量表是一张 **32 位整数（WORD）数组**，每个下标对应一种异常/中断，元素值就是该中断服务函数的入口地址（(PDF p.6-7)）：

```text
                AREA    RESET, DATA, READONLY
                EXPORT  __Vectors
                EXPORT  __Vectors_End
                EXPORT  __Vectors_Size

__Vectors       DCD     __initial_sp            // 0x0800 0000：栈顶地址（MSP 初值）
                DCD     Reset_Handler           // 0x0800 0004：复位入口
                DCD     NMI_Handler             // 0x0800 0008
                DCD     HardFault_Handler       // 0x0800 000C
                ...
__Vectors_End
__Vectors_Size  EQU     __Vectors_End - __Vectors
```

关键：**地址 0 不是入口地址，而是 MSP 初值**。内核响应异常时按 `编号 × 4` 计算偏移查表跳转。向量表被放在代码段最前面，程序跑在 FLASH 时起始地址就是 0x0800 0000。**C 语言里的函数名，对芯片来说就是一个地址**（(PDF p.7-8)）。

## 6. 复位程序 Reset_Handler

核心三行（(PDF p.8-9)）：

```text
Reset_Handler   PROC
                EXPORT  Reset_Handler  [WEAK]     // 弱定义：用户可重写
                IMPORT  SystemInit                // SystemInit 来自外部文件
                IMPORT  __main                    // __main 来自 C 库
                LDR     R0, =SystemInit           // 取 SystemInit 地址
                BLX     R0                        // 调用：配时钟（FSMC/FMC 可选）
                LDR     R0, =__main               // 取 __main 地址
                BX      R0                        // 跳入，不返回，进入 C 的世界
                ENDP
```

**WEAK 弱定义**：被 [WEAK] 声明的函数，若外部文件重新定义了同名函数，就用外部的；否则用弱函数且不报错（(PDF p.9)）。例：启动文件里预置的 `HardFault_Handler` 是弱函数（内容就是原地死循环），而 `stm32f1xx_it.c` 里实现了真版本——真中断来了就跳进你的处理函数，忘了实现就用弱函数原地死循环兜底。

## 7. __main 到底干了什么

别误会：`__main` 不是 `main` 的别名！它是**链接器发现你定义了 main 后自动创建**的库函数（(PDF p.10)）。它内部两大步：

- **__scatterload()**：把 RW/RO 从**加载域**（FLASH）拷贝到**执行域**（RAM），并完成 ZI 运行域清零（(PDF p.10-12)）
- **__rt_entry()**：初始化堆栈、完成库函数初始化，最后自动跳转到 `main()`（(PDF p.12-13)）

```text
__main
 ├─ __scatterload          // ① 拷贝 RW 段初值 ② ZI 段清零
 │    └─ __scatterload_copy     // FLASH→RAM 搬运 RW（如 g_count=5 的初值）
 │    └─ __scatterload_zeroinit // RAM 里把 ZI 清 0（g_buffer 等）
 └─ __rt_entry              // ③ 建立堆栈 ④ 库初始化
      └─ __rt_entry_main    // ⑤ 跳进你的 main —— 终于到 C 了！
```

这正是第 2 课"RW 存 FLASH 初值、上电拷 RAM"的落地实现。

## 8. 系统启动全流程

把前几节串成一条线（(PDF p.16-19)）。Cortex-M3/M4 内核复位后先做两件事：从 0x0800 0000 取 MSP 初值（栈顶），从 0x0800 0004 取 PC 初值（Reset_Handler 入口）。

```text
上电/复位
   │
   ▼
取 0x0800 0000 → SP = __initial_sp    // 栈顶地址，供 NMI/fault 用
取 0x0800 0004 → PC = Reset_Handler
   │
   ▼
Reset_Handler
   ├─ SystemInit      // 配系统时钟
   └─ __main
        ├─ __scatterload   // 拷 RW、清 ZI（加载域→执行域）
        └─ __rt_entry      // 建堆栈、初始化库
             └─ main()     // 你的 C 程序从这里开始
```

> ⚠️ 启动模式注意：Boot 引脚决定向量表映射到哪。映射到 FLASH 则从 0x0800 0000 启动；映射到 SRAM 则从 0x2000 0000 启动。另外 ARM 规定写进 PC 的地址最低位必须为 1（Thumb），否则触发 fault——这就是第 2 课"奇数地址"的由来（PDF p.18-19）。

## 动手练习

### 练习 3.1：给真实启动文件加中文注释

- 1️⃣ **怎么做：**打开当前工程根目录的 `startup_stm32f407xx.s`（GCC 版）——注意它是 GCC 汇编语法（.section/.word/.global 而非 AREA/DCD），但逻辑一一对应。
- 2️⃣ **怎么做：**对照本课 7 件事，逐段标注：找向量表 `g_pfnVectors`、找 `Reset_Handler`（其中 `ldr sp, =_estack`、`bl SystemInit`、CopyDataInit 拷贝 .data、FillZerobss 清零 .bss、`bl __libc_init_array`、`bl main`）。
- 3️⃣ **观察什么：**本工程的栈顶 `_estack` 在链接脚本里 = RAM 顶端 0x20020000；栈大小 `_Min_Stack_Size = 0x1000`（4KB）、堆 `_Min_Heap_Size = 0x1000`，都在 `STM32F407XX_FLASH.ld` 里定义——MDK 的 Stack_Size EQU 在这里换了个形式。

### 练习 3.2：改栈大小，观察变化

- 1️⃣ **怎么做：**MDK 工程：把 `Stack_Size EQU 0x400` 改成 0x800 → Rebuild → 在 map 里搜 `__initial_sp`，看栈顶地址怎么变（栈顶 = 栈低 + 栈大小）。CMake 工程则改 `_Min_Stack_Size` 再重链接。
- 2️⃣ **怎么做：**再故意把栈改得极小（如 0x80），在 main 里定义一个大局部数组，运行观察是否进 HardFault。
- 3️⃣ **观察什么：**栈溢出前的典型症状——HardFault、变量莫名被改写。这正是第 1 课 .htm "2 倍法则"要防的事故。

## 自测

### 随堂小测 1

上电复位后，CPU 从哪个地址取出 PC 的初值？

- A. 0x0800 0000，即 MSP 初值处
- B. 0x0800 0004，向量表第二项
- C. 0x0800 0008，第一个中断处

<details>
<summary>查看答案</summary>

B。地址 0 放 MSP 初值，0x0004 放 Reset_Handler 入口，内核复位后依次取出（PDF p.17）。
</details>

### 随堂小测 2

栈的生长方向是？

- A. 从低地址往高地址生长
- B. 从高地址往低地址生长
- C. 双向同时生长

<details>
<summary>查看答案</summary>

B。栈向下生长（满栈），所以 __initial_sp 是栈顶地址；堆才从低往高生长（PDF p.5-6）。
</details>

### 随堂小测 3

关于 __main 函数，说法正确的是？

- A. 是 main 函数编译后的名字
- B. 链接器发现 main 后自动创建的库函数
- C. 用户必须自己实现它

<details>
<summary>查看答案</summary>

B。__main 由编译器/链接器自动创建，负责 __scatterload + __rt_entry，最后跳 main（PDF p.10）。
</details>

### 随堂小测 4

启动文件把中断函数声明为 [WEAK] 的意义是？

- A. 强制用户必须实现该函数
- B. 有外部定义优先用外部的，没有也能编译
- C. 让中断函数执行得更快

<details>
<summary>查看答案</summary>

B。弱定义：外部同名定义优先，否则用弱函数（死循环兜底），编译不报错（PDF p.9）。
</details>

## 推荐阅读

- 📖 正点原子《STM32 启动文件浅析 V1.2》全文（PDF p.3~19）——本课全部依据
- 📖 本工程 `startup_stm32f407xx.s` 与 `STM32F407XX_FLASH.ld`——GCC 版对照阅读
- 📖《Cortex-M3 权威指南》第 3 章复位序列、第 4 章指令集

## 下一步

启动流程哪一环卡住了、栈溢出调不明白，尽管来问。下一课预告：第 4 课——调试器实战，用 ST-Link 断点、看变量、追调用栈，把启动流程"现场直播"给你看。

| [← 上一课](/my-blog/posts/toolbox/0002-map-file-deep-dive/) | [课程目录](/my-blog/posts/toolbox/00-总览/) | [下一课 →](/my-blog/posts/toolbox/0004-debugger-in-action/) |