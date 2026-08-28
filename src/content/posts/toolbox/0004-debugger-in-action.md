---
title: 调试器实战
published: 2026-08-12
description: ST-Link 驱动安装、MDK 配置、固件升级与断点/Watch/Call Stack/Peripherals/Memory 五大调试窗口实战。
tags: [Toolbox, 嵌入式, STM32, 调试器, ST-Link]
category: Toolbox
draft: false
prevTitle: 规范总览与排版注释
prevSlug: "toolbox/0005-coding-style-format"
nextTitle: 启动文件：从复位到 main
nextSlug: "toolbox/0003-startup-file"
---

# 调试器实战

ST-Link 驱动/配置/固件升级 + 在线调试技巧（正点原子《ST-Link V2 调试补充教程》全文）

**本课目标：**第 3 课讲"从复位到 main"是纸上的，这课把它变成眼睛能看到的。学完你能：独立完成 ST-Link 的驱动安装、MDK 配置与固件升级；熟练使用断点/条件断点、Watch、Call Stack、Peripherals、Memory 五大调试窗口，真机上下载调试你自己的工程。

## 1. 仿真器就三件事

ST-Link 与 J-Link 的操作方法几乎 99% 相同（(PDF p.1)）。任何 JTAG/SWD 仿真器，会用的知识点就三个：

1. **驱动的安装**——让电脑认得出这个 USB 设备
2. **编程软件（MDK）配置**——让 MDK 认识调试器并连上芯片
3. **固件升级方法**——保持 ST-Link 自身固件最新

## 2. 驱动安装

拿到 ST-Link 资料包，解压后有两个 exe（(PDF p.1)）：

```text
# ST-Link 官方驱动包内容
dpinst_x86.exe      // 32 位系统用
dpinst_amd64.exe    // 64 位系统首选（装失败再试 x86）
```

步骤（(PDF p.1-2)）：① 先运行 `dpinst_amd64.exe`，无报错即成功；② USB 插入 ST-Link；③ 打开**设备管理器**，应能看到新设备（WIN10 显示为 "STM32 STLINK"）。若设备名旁有**黄色叹号**，右键 → 更新设备驱动。

> ⚠️ 不同 Windows 版本下设备名称和所在栏目不一样，别按图索骥。判断标准只有一个：**没有黄色感叹号**就是装好了（PDF p.2）。

## 3. MDK 配置：Debug + Utilities

驱动好了，来让 MDK 认识调试器。只需改两个地方（(PDF p.2-5)）：

### 3.1 Debug 选项卡

- 魔术棒 → **Debug 选项卡** → 右上角调试器下拉选 **"ST-Link Debugger"**（用 J-Link 则选 "J-LINK/J-Trace Cortex"）(PDF p.3)
- 点右侧 **Settings** 按钮进入连接配置 (PDF p.3)

```text
# Settings 界面（Debug 选项卡 → Settings）
调试方式:   JTAG  |   SWD   // 教材默认 JTAG；推荐改 SWD
连接速度:   1~5M 之间选择   // 默认 1.12M，线短可调高
设备类型:   STM32F407ZG 等  // 右侧 SW Device 应列出你的芯片
```

**JTAG vs SWD**：两者用法一样，区别是 **SWD 更省引脚**（SWDIO + SWCLK 两根线就能调试），为了省资源推荐用 SWD 模式（(PDF p.4)）。速度一般 1~5M 之间选一个合适的（与 ST-Link 固件版本有关）。

### 3.2 Utilities 选项卡

按图核对 **Utilities 选项卡**的下载设置是否与教材一致（选 ST-Link，Settings 里勾上 Reset and Run 之类），不一致就修正（(PDF p.4-5)）。

> 💡 咱们当前 CMake 工程已经自带一条现成的调试路径：`.vscode\launch.json` 里配好了 `cortex-debug + OpenOCD`，直接用 `interface/stlink.cfg` + `target/stm32f4x.cfg`、`"interface": "swd"`、`"runToEntryPoint": "main"`。MDK 里学的概念，在这份 JSON 里能看到一一对应（swd、stlink 接口、入口 main）。

## 4. 固件升级

ST-Link 能正常用就别乱升级；确需升级时（(PDF p.5-8)）：

```text
# Windows 下升级流程
1. 解压「ST-Link 固件升级软件.zip」，进 Windows 文件夹
2. 运行 ST-LinkUpgrade.exe
3. ST-Link 插上 USB，点界面上的 [Device Connect]
4. 提示 "Please restart it" → 拔掉 USB 重插，再试
5. 连接成功 → 点 [YES] 开始升级
```

> ⚠️ 升级过程中**千万不能断开 USB 线，也别断网**——中途断电会把 ST-Link 刷成砖（PDF p.7）。

## 5. 扩展：在线调试实战技巧

教材之外，把这五个窗口练熟，排查问题快一半。先看演示代码：

```c
/* 演示 1：断点 + Watch 观察变量
 * 用一个定时器中断自增的计数，配合断点看它跳变 */
volatile uint16_t g_tick = 0;   /* volatile：防优化，调试必加 */

void TIM6_IRQHandler(void)
{
    if (__HAL_TIM_GET_FLAG(&htim6, TIM_FLAG_UPDATE)) {
        __HAL_TIM_CLEAR_FLAG(&htim6, TIM_FLAG_UPDATE);
        g_tick++;               /* 在这里下断点，Watch 里看 g_tick 变化 */
    }
}

int main(void)
{
    HAL_Init();
    ...
    while (1) {
        HAL_Delay(1);           /* 全速运行时，断点只在命中处停 */
    }
}
```

```c
/* 演示 2：条件断点 —— 只在特定条件下暂停 */
for (uint32_t i = 0; i < 10000; i++) {
    process_sample(&buf[i]);    /* 希望 i == 5000 时暂停，逐行检查 buf */
}
```

对应五大窗口怎么用：

```text
# MDK 调试工具栏 / 快捷键（cortex-debug 插件同键位）
F5/F8   Run(全速)      F10/F10 单步跳过     F11    单步进入
Ctrl+F11  跳出函数     Ctrl+F5 运行到光标    Ctrl+Shift+F9 清除所有断点

# 五大窗口速览
Watch          // 加变量，看实时值/类型/地址（右键可改值）
Call Stack     // 函数调用栈：看当前停在哪、谁调了谁（点栈帧可跳转）
Peripherals    // 外设寄存器视图，如 GPIOA->ODR 实时亮灭
Memory         // 看裸内存，调 DMA 缓冲区/结构体首选
Disassembly    // 看 C 对应的汇编，配启动文件学习食用更佳
```

- **断点**：点代码行号左侧红点。断点命中即暂停，CPU 状态冻结，所有窗口都给你看
- **条件断点**：右键断点 → Breakpoint… 填条件（如 `i == 5000`），避免一次次 F5
- **Call Stack**：单步进 `HAL_Delay` 后看栈顶到 main 的完整调用链——和第 1 课 .htm 的调用图"实测版"一模一样
- **Peripherals**：全速跑 LVGL 界面时盯着 GPIO 或定时器寄存器，看外设状态

## 动手练习

### 练习 4.1：连接 ST-Link，下载调试当前工程

- 1️⃣ **怎么做：**ST-Link 用 SWD 接线连到探索者开发板（SWDIO/SWCLK/GND，板上一般留了 4 针口），USB 插电脑，设备管理器确认无黄叹号。
- 2️⃣ **怎么做：**MDK 工程按第 3 节配 Debug（ST-Link Debugger + SWD + 1M~5M）+ Utilities；CMake 工程直接用 VS Code 的 "Debug with OpenOCD" 配置（`.vscode\launch.json` 已就绪）。
- 3️⃣ **观察什么：**下载完成那一刻，LCD/串口开始按程序运行。在 Settings 里看 SW Device 是否识别到 STM32F407，识别到 = 连接成功。

### 练习 4.2：断点 + 单步走 main

- 1️⃣ **怎么做：**在 `main` 第一行下断点 → 启动调试。若配置了 `runToEntryPoint: main`，会直接停在 main 入口。
- 2️⃣ **怎么做：**把第 3 课的启动流程"现场直播"：取消 main 断点，在 `Reset_Handler` 或 `SystemInit` 下断点，单步看汇编跳转；再在 `g_tick++` 处设断点，把 `g_tick` 加进 Watch。
- 3️⃣ **观察什么：**Watch 里 g_tick 每次断点命中都在变；Call Stack 能看到 main → HAL_Delay 的调用链；Peripherals 里看 GPIO 寄存器随 LVGL 刷新跳变。

## 自测

### 随堂小测 1

驱动安装成功后，判断标准是？

- A. 设备管理器出现 ST-Link 且无黄叹号
- B. dpinst_amd64.exe 能双击打开
- C. 设备管理器里名称叫 STLINK

<details>
<summary>查看答案</summary>

A。名称因系统而异，唯一硬标准是设备管理器无黄色叹号（PDF p.2）。
</details>

### 随堂小测 2

MDK 中应选择哪种调试方式以节省引脚？

- A. JTAG，速度快且稳定
- B. SWD，只占两根信号线
- C. ISP，直接串口下载

<details>
<summary>查看答案</summary>

B。SWD 只需 SWDIO+SWCLK，更省引脚，推荐使用（PDF p.4）。
</details>

### 随堂小测 3

ST-Link 固件升级过程中绝对禁止？

- A. 点击 Device Connect 按钮
- B. 断开 USB 线或断网
- C. 重复运行升级软件

<details>
<summary>查看答案</summary>

B。中途断电断网会刷坏 ST-Link（PDF p.7）。
</details>

### 随堂小测 4

想让程序只在 i == 5000 时停下，最合适用？

- A. 条件断点，填 i == 5000
- B. 普通断点，多按几次 F5
- C. Watch 窗口监视变量

<details>
<summary>查看答案</summary>

A。条件断点在命中条件时才暂停，避免反复 F5（本课扩展技巧）。
</details>

## 推荐阅读

- 📖 正点原子《ST-Link V2 调试补充教程》全文（PDF p.1~8）——本课驱动/配置/升级依据
- 📖《STM32F4 开发指南》3.4.2 节 JLINK 下载与调试、4.2 节在线调试——通用调试步骤
- 🔧 本工程 `.vscode\launch.json`——OpenOCD + cortex-debug 现成配置对照

## 下一步

连不上、下不进、断点不生效——把这几个词丢给我，咱们一起查。下一课预告：第 5 课——代码规范与排版注释，把调试出的好代码再打磨得体面。

| [← 上一课](/my-blog/posts/toolbox/0003-startup-file/) | [课程目录](/my-blog/posts/toolbox/00-总览/) | [下一课 →](/my-blog/posts/toolbox/0005-coding-style-format/) |