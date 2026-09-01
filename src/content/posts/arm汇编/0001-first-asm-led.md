---
title: 交叉工具链三连：第一个汇编点灯
published: 2026-08-23
description: 第一个汇编点灯：工具链三连把 led.s 变成 led.bin，读懂 ldr/str 寄存器操作与链接地址
tags: [ARM, 汇编, 嵌入式, 裸机]
category: ARM汇编
draft: false
prevTitle: "寄存器与处理器模式"
prevSlug: "arm汇编/0002-arm-registers-modes"
nextTitle: "汇编术语表"
nextSlug: "arm汇编/reference-glossary"
---

# 交叉工具链三连：第一个汇编点灯

裸机没有 OS 帮你。CPU 上电后从复位地址取第一条指令——那第一行代码,通常是用**汇编**写的。今天把一整段 `led.s` 用工具链三连变成 `led.bin`，并亲手读懂它点了灯。

## 一段汇编点灯长这样（对照《指南》第 8 章）

```text
.global _start       @ 程序入口标号（编译、链接要用）

_start:
    /* 1. 开时钟：CCM_CCGR1 = 0x020C406C，GPIO1 时钟 bit27:26 = 11 */
    ldr r0, =0X020C406C
    ldr r1, =0XFFFFFFFF
    str r1, [r0]

    /* 2. 复用：IOMUXC_SW_MUX_CTL_PAD_GPIO1_IO03 = 0x020E0068，ALT5=GPIO */
    ldr r0, =0X020E0068
    ldr r1, =0X5
    str r1, [r0]

    /* 3. 电气属性：SW_PAD_GPIO1_IO03 = 0x020E02F4，写 0x10B0 */
    ldr r0, =0X020E02F4
    ldr r1, =0X10B0
    str r1, [r0]

    /* 4. 方向：GPIO1_GDIR = 0x0209C004，bit3=1（输出） */
    ldr r0, =0X0209C004
    ldr r1, =0X8
    str r1, [r0]

    /* 5. 电平：GPIO1_DR = 0x0209C000，bit3=0 → LED 亮（低电平点亮） */
    ldr r0, =0X0209C000
    ldr r1, =0X0
    str r1, [r0]

loop:
    b loop              @ 死循环：点完灯就停在这，防止跑飞
```

读法：`ldr r0, =地址` 把"地址"放进修存器，`str r1, [r0]` 把"值"写进那个"地址"。这就是裸机操作寄存器的全部姿势。

## 工具链三连：.s → .o → .elf → .bin

```bash
# 1. 编译：汇编 → 机器码目标文件 .o（带调试信息 -g）
arm-linux-gnueabihf-gcc -g -c led.s -o led.o

# 2. 链接：把 .o 放到指定内存地址，生成可执行 ELF
arm-linux-gnueabihf-ld -Ttext 0X87800000 led.o -o led.elf

# 3. 转换：ELF → 纯二进制 .bin（烧给板子的是它）
arm-linux-gnueabihf-objcopy -O binary -S -g led.elf led.bin

# 4. 查看：反汇编，确认你的每条指令变成了什么
arm-linux-gnueabihf-objdump -D led.elf > led.dis
```

> **链接地址 0X87800000 是什么？** IMX6ULL 的 DDR 从 `0x80000000` 开始。正点原子约定把裸机代码链接到 `0x87800000`（往 DDR 里放、在么执行的位置）。CPU 启动时 BootROM 把 SD 卡前若干扇区读进内存并跳到这里运行。给你留个印象——u-boot 把内核放到 `0x80800000` 也是同一种"约定地址"。

## 怎么烧进板子（SD 卡，不动 eMMC）

正点原子资料盘里的 `imxdownload` 把 led.bin 写进一张 SD 卡（细节看《指南》8.4.3）。板子拨码切到从 SD 启动，上电灯亮。烧录课的安全铁律照旧：**只烧 SD、不碰 eMMC、先备份**。

### 练习 A01：编译 + 反汇编验证（即使不上板也能完成）

1. 写 `led.s`（上面整段），执行工具链三连。
1. `objdump -D led.elf`，找到对应 "1.开时钟" 起的那几行机器码，确认不是乱码而是有意义的 `ldr/str` 序列——你"看到"了你的代码变成了什么。
1. 把第 5 步的值 `=0X0` 改成 `=0X8`（bit3=1 → 灯灭），重新三连，反汇编确认 value 变化。
1. **可选**：有 SD 卡+imxdownload 就烧一次真的点灯；否则本课用反汇编验证，烧录在 A06 再练。

## 随堂小测

<details>
<summary>ldr r0, =0X0209C000 和 str r1, [r0] 分别干了什么？</summary>

ldr r0,=地址 把 0x0209C000 这个"地址值"装进 r0；str r1,[r0] 把 r1 的值写入"r0 指向的那个内存地址"。一个是拿地址，一个是写内容到那个地址。

</details>

<details>
<summary>为什么要链接（ld）和转换（objcopy），不能直接烧 .o 吗？</summary>

.o 是"重定位目标文件"，指令还没定死放哪；ld 把它放到约定地址(0x87800000)生成 .elf；objcopy 剥成纯二进制 .bin，烧录才合适。板子只需要"从地址 0x87800000 开始是代码"。

</details>

<details>
<summary>loop: b loop 是干嘛的？不加会怎样？</summary>

死循环让 CPU 停在原地。裸机执行完主流程后如果没循环，CPU 会继续向后"滑"到未知内存，行为不可控。裸机入口代码后面通常就是死循环或 hlt。

</details>

> **要带走的** ① 工具链三连 gcc/ld/objcopy + objdump；② 链接地址概念；③ "ldr=地址 + str=写值"的寄存器操作底板。**这一课是 A 系列的地基，更是 Linux 课 L05 的伏笔。**

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 4 章（工具链安装）、第 7 章 7.1-7.2（汇编基础）、第 8 章（led.s + 编译 + imxdownload 烧写）
- 课程速查：[ARM 寄存器与指令速查](/my-blog/posts/arm汇编/reference-arm-cheatsheet/)

**有不清楚的直接问我（agent）**。三连命令报环境、objdump 输出看不懂、imxdownload 报错，贴给我。

| [← 上一课](/my-blog/posts/arm汇编/reference-glossary/) | [课程目录](/my-blog/posts/arm汇编/00-总览/) | [下一课 →](/my-blog/posts/arm汇编/0002-arm-registers-modes/) |
