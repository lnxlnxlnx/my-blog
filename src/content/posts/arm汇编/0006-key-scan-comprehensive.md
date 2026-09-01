---
title: 按键轮询综合
published: 2026-08-28
description: 读 GPIO1_PSR、tst+beq、轮询 vs 中断、消抖
tags: [ARM, 汇编, 嵌入式, 裸机]
category: ARM汇编
draft: false
prevTitle: ""
prevSlug: ""
nextTitle: "栈与汇编调 C"
nextSlug: "arm汇编/0005-stack-and-c"
---

# 按键轮询综合

A01-A05 你一直在"写寄存器输出"。真实世界里还得**读**——按键。这课用汇编写"按键轮询"：读 GPIO1_PSR，按下就在 LED 上呈现（按下亮/松开灭或翻转）。跑通它，你已经从"看得懂寄存器"升级成"能独立用汇编操作输入与输出"。

## 读按键的硬件事实

《指南》第 15 章：KEY0 = **GPIO1_IO18**，按下为**低**电平。读一个按键电平，就是读 GPIO1_PSR（引脚状态寄存器）的 bit18：

```text
@ GPIO1_PSR = 0X0209C008
ldr r0, =0X0209C008
ldr r1, [r0]            @ 读整组引脚状态到 r1
tst r1, #(1 << 18)      @ 测试 r1 的 bit18（tst = 按位与，只改标志）
beq pressed             @ bit18=0 → 按下（低有效）→ 跳去处理
```

> **把输入引脚配成输入** KEY0 的 GPIO 方向要设成输入（GDIR bit18 = 0）。和输出相反——这提醒你：**同一套"四步走"（时钟→复用→电气→方向），只是最后一步填输入还是输出不同**。

## 完整主线逻辑（配成输入，读按键，控制 LED）

```text
_start:
    @= 时钟、复用、电气：KEY0(GPIO1_IO18) 与 LED(GPIO1_IO03) 都要配
    @（用 A01 那套指令分别写时钟/复用/电气，这里省略重复部分）

    @ 方向：GDIR = 0X0209C004
    @   bit3 = 1 → LED 输出
    @   bit18 = 0 → 按键输入  （0x0209C004 写 (1<<3)）
    ldr r0, =0X0209C004
    ldr r1, =0X00000008
    str r1, [r0]

loop:
    @ 读 PSR，判断按键
    ldr r0, =0X0209C008     @ GPIO1_PSR
    ldr r1, [r0]
    tst r1, #(1 << 18)      @ bit18 = 1 吗？
    beq key_down            @ bit18=0（按下）→ 去灯亮分支
    @ 否则：灯灭
    ldr r0, =0X0209C000
    ldr r1, =0X00000008     @ LED 灭（bit3=1）
    str r1, [r0]
    b   loop

key_down:
    ldr r0, =0X0209C000
    ldr r1, =0X00000000     @ LED 亮（bit3=0）
    str r1, [r0]
    b   loop
```

一个 `tst + beq` 就实现了 "if (按键按下) 亮 else 灭"。注意**轮询**：CPU 一直在 loop 里反复读——简单但占着 CPU，这就是"轮询 vs 中断"（Linux 课 L06）的基础对比。

## 实战提醒：消抖

机械按键按下瞬间电平会抖动（几十 ms），直接读会闪。简单处理：检测到电平变化后**延时 ~10ms 再确认一次**。用 A04 的 `delay` 就能消抖——现在你知道为什么 A04 要先学延时了。

### 练习 A06：按键控制 LED（收官综合）

1. 把上面逻辑写成完整 `key.s`：KEY0 输入 + LED 输出 + 轮询 + time 消抖（首次跳过消抖，观察抖动现象再加）。
1. 编译三连 + objdump：定位 `tst`/`beq`，看懂"读-判-分支"三段体。
1. 把"按下亮"改成"按一下翻转、再按一下灭"（记忆开关），需要控一个 flag 寄存器（如 r6）——这是对 ADD/SUB 和分支的又一次综合。
1. **可选上板**：SD+imxdownload 烧录，真人按按键看灯。若不上板，用 objdump + 纸面推演代替（在 A06 的练习注释里写下你的"预期行为表"）。

## 随堂小测

<details>
<summary>tst r1, #(1<<18) 之后，怎么判断 "bit18==1"？</summary>

tst 做按位与只更新 Z 标志：bit18=1 时结果非 0 → Z=0。所以 bit18=1 → 走 beq 外的分支(bne)/顺序执行；bit18=0 → Z=1 → beq 成立。

</details>

<details>
<summary>为什么按键要配成输入（GDIR bit=0），LED 配成输出？</summary>

方向决定该引脚的驱动/采样模式。LED 要"把电平送出去"所以输出；按键要"别人把电平拉进来"所以输入。配反了读不到按键状态/点不亮灯。

</details>

<details>
<summary>轮询 vs 中断，裸机里怎么选？</summary>

轮询简单、吃 CPU；中断省电、及时但复杂。裸机按键常轮询（够用），Linux 驱动推荐中断。你从这两种思路切换的感觉，就是入门嵌入式软件的"分水岭"。

</details>

> **到这里，汇编课收官。** 你已经：能读/写寄存器、能写循环/延时/按键轮询、懂 start.S。接下来把同一套"读-写寄存器"搬进 Linux 驱动（course/linux 的 L05/L06/L07），你会觉得亲切：**驱动课里的 ioremap+readl/writel，就是汇编里 ldr/str 的"亲兄弟"。**

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 15 章（按键输入实验：含轮询读按键的 C 写法对照）
- 第 18/19 章（EPIT 定时器 + 定时器消抖，若你想让消灭抖从"软延时"升级到"硬件定时"）
- 课程速查：[ARM 速查表](/my-blog/posts/arm汇编/reference-arm-cheatsheet/) · [汇编术语表](/my-blog/posts/arm汇编/reference-glossary/)

**有不清楚的直接问我（agent）**。综合课最容易在"方向配错/读错 bit 号/消抖没加"上翻车——把 objdump 和现象贴给我一起看。

| [← 上一课](/my-blog/posts/arm汇编/0005-stack-and-c/) | [课程目录](/my-blog/posts/arm汇编/00-总览/) | — |
