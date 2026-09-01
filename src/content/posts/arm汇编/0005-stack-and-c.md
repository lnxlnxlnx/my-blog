---
title: 栈与汇编调 C
published: 2026-08-27
description: start.S 关狗/设 sp/跳 C、汇编与 C 混编、看门狗
tags: [ARM, 汇编, 嵌入式, 裸机]
category: ARM汇编
draft: false
prevTitle: "按键轮询综合"
prevSlug: "arm汇编/0006-key-scan-comprehensive"
nextTitle: "分支·循环·延时"
nextSlug: "arm汇编/0004-branch-loop-delay"
---

# 栈与汇编调 C

真实裸机工程都是"一小段汇编当电梯 + 大部分 C 写在楼上"。汇编负责把地基铺好（关看门狗、设栈、跳 C）。这课看《指南》第 10 章 C 语言版 LED 的 `start.S`——栈、进入 C 入口，全在这一小段里。

## 为什么 C 需要"栈"？为什么 C 前必须先设 SP？

C 函数的**局部变量、函数调用的返回地址、保存的寄存器现场**全都压在栈上。栈是一个"往哪放"全靠 SP 指针决定的内存区。如果 SP 没设好就调 C 函数，局部变量会写到随机地址 → 立刻崩。

而 A04 里 `bl` 只有**一个**"返回地址寄存器"LR，深层调用会互相覆盖——所以标准做法是调用前把 LR 和现场**压栈**，返回前**弹栈**还原。这就是为什么要花一节课讲栈。

## start.S：裸机第一份"正式工作程序"

```text
.global _start

_start:
    /* 1. 关看门狗：WDOG1 复位寄存器写 0（防止系统被看门狗反复复位）*/
    ldr r0, =0X020C0000
    ldr r1, =0X00000000
    str r1, [r0]

    /* 2. 设置 SVC 模式栈指针：主流程跑在 SVC，栈顶放 0X80200000 */
    ldr sp, =0X80200000

    /* 3. 跳到 C 入口 main() —— bl 记下地址，C 跑完还能回到这（或进死循环）*/
    b main             @ 或 bl main + 末尾 wfi/b
    @ 实际工程常在 return 后加死循环防止跑飞
loop:
    b loop
```

> **为什么栈是"往下长"的？** ARM 约定栈从高地址往下长（满递减栈）。我们 SP 设在 `0X80200000`，压栈时 SP 递减写入。只要这段内存不被别的占用，局部变量就有安全空间。开发中常留几百 KB~MB 给栈。

## main.c 怎么写？（C 语言版点灯，与 A05 汇编对应）

```c
void delay(unsigned int t) { while (t--); }

int main(void) {
    unsigned int *gd, *dr;
    /* 开时钟、复用、电气（用 *(volatile unsigned int*)地址 直接写）*/
    ...
    while (1) {
        /* 亮 → 延时 → 灭 → 延时（和 A04 闪灯一个逻辑，只是用 C 写）*/
    }
}
```

C 编译时这些 `*(addr)` 会被翻译成 `ldr/str`——你在汇编课见过的姿势。C 是"更舒服的汇编"，汇编是"更清楚发生了啥"。

## 混合工程的编译（比 A01 多一步）

```bash
arm-linux-gnueabihf-gcc -c start.s -o start.o
arm-linux-gnueabihf-gcc -c main.c -o main.o
arm-linux-gnueabihf-ld -Ttext 0X87800000 start.o main.o -o main.elf
arm-linux-gnueabihf-objcopy -O binary -S -g main.elf main.bin
```

start.o 和 main.o 合链，`_start` 在 `0X87800000` 处启动，然后 `b main` 或 `bl main` 进入 C 世界。这就是"入口是汇编、逻辑是 C"的标准配方——u-boot、Linux 内核、你的系统全是这个配方。

### 练习 A05：亲手跑通 start.S + main.c

1. 把上面 `start.s` + 一个闪灯 `main.c` 写完整（地址用 A01 那组，逻辑抄 A04 的"亮-灭"），混合编译三连。
1. `objdump -D main.elf`：在汇编里找到 `ldr sp,=0X80200000`，并找到 C 被编译出的 `ldr/str`——确认"你写的 C 其实被你学的汇编组成"。
1. 故意把 `ldr sp` 那行删掉，重新链接、objdump（**先别上板**），想想为什么一上板大概率跑飞——验证你对"栈的必要性"的理解。
1. **可选**：有 SD+imxdownload 可烧到 SD 观察现象（看门狗被杀掉后 LED 该稳定闪）。

## 随堂小测

<details>
<summary>为什么 C 程序跑之前必须先设 SP？</summary>

C 函数局部变量、返回地址、保存的寄存器都压栈。SP 没初始化指向合法内存，压栈会写到任意地址 → 崩溃。start.S 的使命之一就是提前设好 SP。

</details>

<details>
<summary>b main 和 bl main 的区别？</summary>

b 只跳不记返回，main 里 return 后回不了；bl 会先把返回地址存 LR，main return 后能接着执行。裸机里 main 后面通常跟死循环，所以 b 也常见。

</details>

<details>
<summary>看门狗（WDOG）为什么要先关掉？</summary>

看门狗是"防死机狗"：定时必须喂，没喂就复位系统。裸机调试期没喂狗代码会不停复位重启，所以 start.S 先把看门狗关掉（写 0），让程序能安静跑。

</details>

> **要带走的** ① 栈 + SP 的职责；② start.S 三步曲（关狗、设栈、跳 C）；③ 汇编/C 混合编译。**现在你已经能读懂任何"start.S + main.c"的裸机工程了——包括 u-boot 和内核的入口代码。**

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 10 章（C 语言版 LED：完整 start.s + main.c + 编译）
- 第 9 章（启动方式：为什么代码链接在 DDR、BootROM 做了什么）
- [ARM 速查表](/my-blog/posts/arm汇编/reference-arm-cheatsheet/)（含 stmfd/ldmfd 压弹栈指令备用）

**有不清楚的直接问我（agent）**。特别是"删了 sp 会崩"这种反直觉点——强烈建议你亲自动手删一次看现象。

| [← 上一课](/my-blog/posts/arm汇编/0004-branch-loop-delay/) | [课程目录](/my-blog/posts/arm汇编/00-总览/) | [下一课 →](/my-blog/posts/arm汇编/0006-key-scan-comprehensive/) |
