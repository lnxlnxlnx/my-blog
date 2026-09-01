---
title: ARM 寄存器与指令速查
published: 2026-08-21
description: ARM 寄存器与指令速查表
tags: [ARM, 汇编, 嵌入式, 参考]
category: ARM汇编
draft: false
prevTitle: "汇编术语表"
prevSlug: "arm汇编/reference-glossary"
nextTitle: "ARM 指令示例库"
nextSlug: "arm汇编/reference-instructions"
---

# ARM 寄存器与指令速查

## 寄存器

| 寄存器 | 别名 | 职责 |
| --- | --- | --- |
| r0-r7 | — | 通用数据寄存器 |
| r8-r12 | — | 通用（r8-r12 在 FIQ 模式有备份） |
| r13 | SP | 栈指针（往低地址增长，满递减栈） |
| r14 | LR | 链接寄存器，`bl` 存返回地址 |
| r15 | PC | 程序计数器（ARM 下 = 当前指令+8） |
| CPSR | — | 条件标志 N/Z/C/V · 中断使能位 · 模式位 |

## 常用指令（七组一把抓）

| 分类 | 指令 | 说明 |
| --- | --- | --- |
| 搬运 | `mov Rd, #imm / Rd,Rn` | 立即数/寄存器 → 寄存器 |
| `mvn Rd, #imm` | 取反后放入（`#0` 得全 1） |
| 算术 | `add/sub Rd,Rn,#imm` | 加/减（末尾加 `s` 更新标志：`subs`） |
| `mul / udiv / sdiv` | 乘 / 无符号除 / 有符号除 |
| `rsb Rd,Rn,#i` | 反向减：`#i - Rn` |
| 逻辑/位 | `and/orr/eor` | 与 / 或 / 异或（`orr r,#(3<<26)` 置位） |
| `bic R,#m` | bit clear：把指定位清 0 |
| `tst / cmp / cmn` | 测位 / 比较 / 反数比较，只改标志 |
| 内存 | `ldr Rt,[Rn,...]` | 读内存（带 `=` 是伪指令：塞立即数地址） |
| `str Rt,[Rn,...]` | 写内存 |
| 移位 | `mov r1, r2, lsl #2` | 逻辑左移（×2^n） |
| `mov r1, r2, lsr #2` | 逻辑右移（÷2^n） |
| `mov r1, r2, asr #2` | 算术右移（符号位填充，用于有符号） |
| 分支 | `b / bl / bx / blx` | 跳 / 调用(BL 记 LR) / 返回 / 调函数指针 |
| `beq/bne/bgt/…` | 条件跳转（后缀全表见指令示例库） |
| 栈/多载 | `push {..}/pop {..}` | 一条压/弹多个寄存器（现场保存） |
| `stmfd/ldmfd sp!, {..}` | push/pop 的原型（满递减/满递增） |
| 专用 | `mrs / msr` | 读 / 写 CPSR 等状态寄存器 |
| `svc / nop / wfi` | 软中断(进内核) / 空操作 / 睡眠等中断 |

> **逐条示例** 每种指令的"一行示例+注释"见 [ARM 指令示例库](/my-blog/posts/arm汇编/reference-instructions/)——当词典用。

## 易混对照

| 写法 | 含义 | 示例意图 |
| --- | --- | --- |
| `ldr r0, =0X0209C000` | 伪指令：地址值 → r0 | 想访问外设寄存器基地址 |
| `ldr r0, [r1]` | 真内存读：r0 = 内存[r1] 处 | 想读某个寄存器当前值 |
| `sub r2,r2,#1` | 不减标志 | 单纯算数 |
| `subs r2,r2,#1` | 减并更新 Z 标志 | 延时循环（配 `bne`） |
| `b label` | 跳走不回来 | 死循环/兜底 `loop: b loop` |
| `bl func` | 跳走去能回来 | 调 C 函数/延时函数 |

## 裸机工程速记（对照 A01/A05）

```text
<code>编译   : arm-linux-gnueabihf-gcc -g -c led.s -o led.o
链接   : arm-linux-gnueabihf-ld -Ttext 0X87800000 led.o -o led.elf
转换   : arm-linux-gnueabihf-objcopy -O binary -S -g led.elf led.bin
反汇编 : arm-linux-gnueabihf-objdump -D led.elf > led.dis
烧录   : imxdownload led.bin /dev/sdX（SD 卡；勿碰 eMMC）
链接地址: 0X87800000（正点原子裸机惯例；DDR 起始 0X80000000）</code>
```

## 常用寄存器地址（与 Linux 课速查表一致）

| 功能 | 寄存器 | 地址 | LED/KEY 用途 |
| --- | --- | --- | --- |
| 时钟 | CCM_CCGR1 | 0x020C406C | GPIO1 时钟 bit27:26=11 |
| 复用 | SW_MUX_GPIO1_IO03 | 0x020E0068 | LED：MUX=5(GPIO) |
| 电气 | SW_PAD_GPIO1_IO03 | 0x020E02F4 | LED：0x10B0 |
| 方向 | GPIO1_GDIR | 0x0209C004 | LED bit3=1 出；KEY bit18=0 入 |
| 数据 | GPIO1_DR | 0x0209C000 | LED bit3：0 亮 / 1 灭（低有效） |
| 状态 | GPIO1_PSR | 0x0209C008 | 读 KEY：bit18=0 按下 |

详细见 Linux 课：[IMX6ULL 速查表](../../linux/reference/imx6ull-cheatsheet.html)

| [← 上一课](/my-blog/posts/arm汇编/reference-instructions/) | [课程目录](/my-blog/posts/arm汇编/00-总览/) | [下一课 →](/my-blog/posts/arm汇编/reference-glossary/) |
