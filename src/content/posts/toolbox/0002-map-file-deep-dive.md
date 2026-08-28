---
title: MAP 文件深读
published: 2026-08-10
description: 读懂 .map 文件五大组成部分，掌握 Code/RO/RW/ZI 四个数与 FLASH/RAM 占用公式。
tags: [Toolbox, 嵌入式, STM32, MAP 文件, 链接]
category: Toolbox
draft: false
prevTitle: 启动文件：从复位到 main
prevSlug: "toolbox/0003-startup-file"
nextTitle: MDK 编译产物全解
nextSlug: "toolbox/0001-build-artifacts"
---

# MAP 文件深读

把 Program Size 四个数彻底看懂（正点原子《STM32 MAP 文件浅析》第 2 章）

**本课目标：**第 1 课我们只记下了 Code/RO-data/RW-data/ZI-data 四个数，这课把它们逐个解剖。学完你能：读懂 .map 文件五大组成部分，算清工程到底吃掉多少 FLASH 和 RAM，一眼揪出"占空间最多的模块"和"被编译器悄悄删掉的冗余函数"——优化代码、排查栈溢出全靠它。

## 1. 怎么让 MDK 吐出 .map 文件

.map 文件是链接器（armlink）生成的一份"工程体检报告"（(PDF p.7)）。默认情况下 MDK 已经在生成它了，但你得知道开关在哪：

- ① 魔术棒（Options for Target）→ **Listing 选项卡**：里面勾选与链接器输出相关的项（默认全勾，取消会少输出部分信息，一般不建议动）
- ② 全编译工程（Rebuild，无错误），.map 文件随 .axf 一起生成
- ③ 在工程树里**双击目标名**（如 LED、Project），.map 就在编辑器里打开了

```text
# 打开路径：MDK → 魔术棒(Options for Target) → Listing 选项卡
# 关键输出选项（默认全勾）：
  [x] Assembly Listing     // 汇编列表 .lst
  [x] C Preprocessor Listing
  [x] C Compiler Listing
  [x] Linker Listing (.map) // ★ 本课主角，别关它
# 打开方式：编译成功后，双击工程树顶部的工程目标名
```

> 💡 咱们当前工程是 CubeMX/CMake 工程，编译器是 GCC——生成的 map 在 `build\EmbedOrigin_4s.map`（GCC 链接器也产 map）。文件格式和 MDK 的略有差异，但"看占用、找符号、查未使用段"的套路完全通用，本课后面会两边对照着看。

## 2. 基础概念：Section 与 RO/RW/ZI

读 map 前先认几个词（(PDF p.8)）：

| 术语 | 含义 | 占哪 |
|------|------|------|
| **Section（程序段）** | 描述映像文件的代码或数据块，链接的最小单元 | — |
| **RO（Read Only）** | 只读数据（RO data）+ 只读代码（RO code） | FLASH |
| **RW（Read Write）** | 有初值且不为 0 的可读写数据 | FLASH 存初值 + RAM 读写 |
| **ZI（Zero initialized）** | 初始化为 0 的数据 | RAM |
| .text / .constdata / .data / .bss | 分别对应 RO code / RO data / RW data / ZI data（GCC 侧叫法） | 同上 |

用一段 C 代码把四个类别对号入座：

```c
/* RO data：const 修饰的只读数据，跟着代码进 FLASH */
const uint8_t logo_buf[] = {0x10, 0x32, 0x54, 0x76};

/* RW data：有初值且非 0，FLASH 里存一份初值，上电拷贝到 RAM 后读写 */
uint8_t g_count = 5;

/* ZI data：初值为 0（或没初始化），只在 RAM 里占地方 */
uint8_t g_buffer[1024];
uint8_t g_flag;    /* 未初始化 = 自动清零 = ZI */
```

为什么 RW 要两头占？因为 RAM 掉电就丢，程序一上电就必须从 FLASH 的"初值区"把 g_count 的 5 拷进 RAM——这正是第 3 课启动文件里 `__scatterload` 干的事。

## 3. 五大组成部分，逐个解剖

.map 文件主体分为 5 部分（(PDF p.7)）。下面以教材的 H750 例程片段为例，每一段都标好了地址和大小。

### 3.1 程序段交叉引用（Section Cross References）

描述文件之间函数调用关系（(PDF p.9)）：

```text
main.o(i.main) refers to sys.o(i.sys_stm32_clock_init) for sys_stm32_clock_init
//        ↑main 函数            ↑调用关系                 ↑被调函数
// 读法：main.c 的 main 调用了 sys.c 的 sys_stm32_clock_init
// i.xxx = 该函数入口地址（函数名本身）
```

### 3.2 删除未使用的程序段（Removing Unused input sections）

列出被优化掉、从未被调用的函数/数据（(PDF p.9)）。末尾一行是总账：

```text
Removing Unused input sections from the image.
    stm32h7xx_hal_usart_ex.o(USARTEx_SetNbDataToProcess)    // 例：没用到的函数被移除
    ...
361 unused section(s) (total 43234 bytes) removed from the image.
// 共删 361 个冗余段、省下 43234 字节 Flash
```

要让删除更彻底，MDK 可在 魔术棒 → C/C++ 选项卡勾选 **One ELF Section per Function**（每个函数独立成段，才能按函数粒度删）(PDF p.9)。

### 3.3 映像符号表（Image Symbol Table）

记录每个符号的地址、类型、大小（(PDF p.10)）。分两类：

```text
# 本地符号 Local Symbols（static 变量/函数、汇编标号，只在本文件可见）
0x08002bc8   Section   sys.o(i.sys_stm32_clock_init)   // 仅入口地址，大小 0

# 全局符号 Global Symbols（全局变量、函数，全工程可见）
0x08002bc9   Thumb Code  sys.o(i.sys_stm32_clock_init)   // 代码，大小 344 字节
```

注意两个地址 **0x08002bc8 与 0x08002bc9 其实是同一个函数**——ARM 规定 Thumb 指令最低位必须为 1，奇数地址表示"这是 Thumb 代码"，所以永远是差 1（(PDF p.11)）。

### 3.4 映像内存分布图（Memory Map of the image）

这是最直观的一张图（(PDF p.11-13)）。先搞清两个域：

- **加载域（Load Region）**：映像实际存放的地方（就是 FLASH/QSPI 里的"货"）
- **执行域（Execution Region）**：MCU 上电后的运行状态（RW 被拷进 RAM、ZI 在 RAM 里清零）

```text
# 教材 H750 例程的内存分布（加载域 + 执行域清单）
  LR_m_stmflash   0x08000000   size 0x2D8C   // 加载域：整块映像躺在 FLASH
  ├── ER_m_stmflash   0x08000000  size 0x2D6C  // 执行域：代码+只读数据，就地执行
  └── RW_m_stmsram   0x24000000  size 0x2D6C  // 执行域：RW+ZI 拷贝/清零后在这跑
  LR_m_qspiflash 0x90000000   size 0x0720   // 第二个加载域：外部 QSPI FLASH
  └── ER_m_qspiflash  0x90000000  size 0x0720
```

从这个清单能查到任何一个函数所在运行域、入口地址、大小——比如教材中 `sys_stm32_clock_init` 在 ER_m_stmflash 域、入口 0x08002BC8、大小 0x168 字节。

### 3.5 映像组件大小（Image component sizes）

按 .o 文件汇总每个源文件的占用，末尾给全工程总账（(PDF p.13-15)）：

```text
# ① 每个 .c/.s 的占用（以 delay.o 为例）
  Code (inc. data)   RO Data   RW Data   ZI Data   Debug
  142  (8)              0         0         0        23    delay.o
# ② 库成员占用 Library Totals（如 fpinit.o 来自 fz_wv.l 库）
# ③ 全工程汇总 Grand Totals
  Total RO Size (Code + RO Data)  = 13452 Bytes    // 纯代码+只读
  Total RW Size (RW + ZI)         = 3032  Bytes    // 需占 SRAM
  Total ROM Size (Code+RO+RW)     = 13484 Bytes    // 需占 FLASH
```

## 4. Program Size 四个数，一页看懂

回到编译输出的那行 `Program Size: Code=... RO-data=... RW-data=... ZI-data=...`，现在它的含义全明白了（(PDF p.14-15)）：

> 💡 核心公式（请背下来）：
> - **FLASH 占用 = Code + RO-data + RW-data**（RW 的初值得存 FLASH）
> - **RAM 占用 = RW-data + ZI-data**（运行期两者都躺在 SRAM）

换算关系：

- **Total RO Size = Code + RO-data**：纯只读部分（代码 + const 数据）
- **Total RW Size = RW-data + ZI-data**：SRAM 需求
- **Total ROM Size = Code + RO-data + RW-data**：FLASH 需求（教材 H750 例程 13484 字节）

> ⚠️ 常见误区：别拿 Program Size 的 ZI-data 去跟 RAM 总量比——ZI 只算 RAM；也别把 RW 只算成 RAM——它还额外吃 FLASH。做 Bootloader 时 FLASH 空间计算最容易在这栽跟头。

## 动手练习

### 练习 2.1：打开你自己的 .map

- 1️⃣ **怎么做：**MDK 工程 → 魔术棒 → Listing 选项卡确认 Linker Listing 已勾选 → Rebuild 一次 → 双击工程树目标名打开 .map。当前 CMake 工程直接打开 `build\EmbedOrigin_4s.map`。
- 2️⃣ **怎么做：**先搜 `Cross Reference`、`removed from the image`、`Image Symbol Table`、`Memory Map` 等关键词，把 5 个部分的位置都标出来。
- 3️⃣ **观察什么：**数一数你的工程被删了几个未使用段、省了多少字节？入口地址 0x0800xxxx 的"奇数地址"现象看到了吗？

### 练习 2.2：算账 + 找最大模块

- 1️⃣ **怎么做：**找到 Grand Totals 区，读出 Total RO/RW/ROM Size。
- 2️⃣ **怎么做：**用公式自己算一遍：FLASH = Code+RO+RW，RAM = RW+ZI，对照 ROM Size 验证。
- 3️⃣ **观察什么：**在 Image component sizes 里找出占 Code 最大的 3 个 .o（大概率是 lvgl 或 FATFS 相关），想想怎么优化；再对照 STM32F407 的 1MB FLASH / 192KB RAM（本工程 RAM 128K + CCM 64K），估算资源余量。

## 自测

### 随堂小测 1

一个非 0 初值的全局变量，同时占用哪种空间？

- A. 只占 RAM，因为它要读写
- B. 只占 FLASH，因为它是代码
- C. FLASH 存初值 + RAM 运行期读写

<details>
<summary>查看答案</summary>

C。RW data 的初值存在 FLASH，上电由启动文件拷贝到 RAM 后读写，两头都占（PDF p.8、p.14）。
</details>

### 随堂小测 2

FLASH 占用量的正确公式是？

- A. Code + RO-data + RW-data
- B. Code + RO-data + ZI-data
- C. RW-data + ZI-data

<details>
<summary>查看答案</summary>

A。RW 的初值需要 FLASH 存放；ZI 只在 RAM（PDF p.14-15）。
</details>

### 随堂小测 3

全局符号表中函数地址为什么是奇数？

- A. 编译器随机生成的填充位
- B. Thumb 指令最低位必须为 1
- C. 表示函数有错误标记

<details>
<summary>查看答案</summary>

B。ARM 规定 Thumb 指令最低位为 1（LSB=1），所以真实地址 0x...C8 记作 0x...C9（PDF p.11）。
</details>

### 随堂小测 4

"Removing Unused input sections" 部分告诉你什么？

- A. 哪些函数被删了、省了多少空间
- B. 哪些变量越界了需要修复
- C. 哪些外设没有初始化

<details>
<summary>查看答案</summary>

A。它列出未被调用的冗余段并统计节省字节数，配合 One ELF Section per Function 可更彻底瘦身（PDF p.9）。
</details>

## 推荐阅读

- 📖 正点原子《STM32 MAP 文件浅析 V1.1》第 2 章（PDF p.7~15）——本课全部依据
- 🔧 MDK 帮助：`uVision Help → armlink User Guide → Map file`——map 各字段官方定义

## 下一步

算不清的占用、找不到的模块，随时来问我。下一课预告：第 3 课——从复位到 main 的启动文件。上电后第一个程序到底做了什么，Stack_Size 那行 EQU 又藏着什么秘密。

| [← 上一课](/my-blog/posts/toolbox/0001-build-artifacts/) | [课程目录](/my-blog/posts/toolbox/00-总览/) | [下一课 →](/my-blog/posts/toolbox/0003-startup-file/) |