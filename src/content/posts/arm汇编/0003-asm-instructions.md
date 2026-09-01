---
title: 指令与寻址方式
published: 2026-08-25
description: mov/mvn、add/sub、and/orr/bic/eor、ldr/str、b/bl 四组指令与寻址方式
tags: [ARM, 汇编, 嵌入式, 裸机]
category: ARM汇编
draft: false
prevTitle: "分支·循环·延时"
prevSlug: "arm汇编/0004-branch-loop-delay"
nextTitle: "寄存器与处理器模式"
nextSlug: "arm汇编/0002-arm-registers-modes"
---

# 指令与寻址方式

不用背 ARM 几百条指令。裸机+驱动你反复用的就那么些——把它们按七组记住，你就能读懂并写出 95% 的 Board 启动汇编。**每一条都配了最短示例**；完整示例库在 [指令示例库](/my-blog/posts/arm汇编/reference-instructions/)，随查随用。

## ① 数据搬运（进寄存器）

```text
mov r1, #5            @ 立即数 5 → r1
mov r1, r2            @ 寄存器拷贝：r1 = r2
mvn r2, #0            @ 按位取反再放（0 → 全 1），常用在置全 1
ldr r1, =0X0209C000   @ 伪指令：把"地址值"塞进 r1（不是读内存！看方括号区分）
mrs r1, cpsr          @ 读状态寄存器：r1 = cpsr（A02 讲过，先混个脸熟）
```

## ② 算术运算

```text
add r3, r1, r2        @ r3 = r1 + r2
add r3, r3, #1        @ 自增：r3 = r3 + 1
sub r3, r3, #1        @ 自减：r3 = r3 - 1（延时循环靠它！）
subs r3, r3, #1       @ 同上，但更新 Z/N 标志（循环判 0 全靠这个 s）
rsb r3, r1, #100      @ 反向减：r3 = 100 - r1
mul r3, r1, r2        @ r3 = r1 * r2
udiv r3, r1, r2       @ r3 = r1 / r2（无符号除法）
```

## ③ 逻辑与位运算（"开关位"才是驱动里的主角）

```text
and r1, r1, r2        @ 按位与（取交，常用来"读某几位"）
orr r1, r1, #(3<<26)  @ 按位或（置位：L05 开时钟就这种！）
eor r1, r1, r2        @ 异或（翻转位）
bic r1, r1, #(1<<3)   @ 清位：把 bit3 清 0
tst r1, #(1<<18)      @ 测试 bit18：只改标志不写回（A06 读按键就是它）
cmp r1, r2            @ 比较：r1-r2，只改标志（if 的地基）
```

## ④ 内存访问（最重要：ldr / str）

```text
ldr r0, =0X0209C000     @ 伪指令：把"地址值"放进 r0
ldr r1, [r0]            @ 读内存：r1 = *(r0)
str r1, [r0]            @ 写内存：*(r0) = r1
ldr r2, [r0, #4]        @ r2 = *(r0+4)（基址+偏移）
str r1, [r0, #4]!       @ 先 *(r0+4)=r1，再把 r0 更新为 r0+4（! 回写基址）
ldr r1, [r0], #4        @ r1 = *(r0)；然后 r0 += 4（后变址）
ldrb r1, [r0]           @ 读 1 字节（b 后缀：字节；h 后缀：半字）
```

> **ldr 的两种面孔要分清** `ldr r0, =值/地址` 是**伪指令**（汇编器帮你生成"取常量"的魔法）；`ldr r0, [r1]` 才是真的"从内存读"。看有没有方括号——有括号读内存，没括号取常量。

## ⑤ 移位与条件后缀（ARM 特色两件套）

```text
mov r1, r2, lsl #2      @ r1 = r2 << 2（左移：×4）
mov r2, r3, lsr #3      @ r2 = r3 >> 3（逻辑右移：÷8）
mov r0, r1, asr #2      @ 算术右移：带符号右移（最高位补符号）
orr r0, r0, #(1<<3)     @ 立即数里配移位："第 3 位"写法，比 #8 可读
cmp r1, r2
beq  equal              @ EQ 相等 (Z=1)
bne  notequal           @ NE 不等 (Z=0)
bgt  big                @ GT 有符号大于（还有 ge/lt/le/hi/ls/…）
moveq r0, #1            @ 条件后缀不只给 b 用：仅当 Z=1 才执行 r0=1
```

条件后缀全表（`eq ne cs/cc/hs/lo mi/pl vs/vc hi/ls ge/lt gt/le al`）在 [指令示例库 ⑦](/my-blog/posts/arm汇编/reference-instructions/)，用到再查。

## ⑥ 跳转 / 调用：出去还得回来

```text
b   loop       @ 无条件跳（死循环常用，回不来）
bl  delay      @ 调用子程序：把"返回地址"存进 LR，再跳（A04 会用到）
bx  lr         @ 子程序返回：跳到 LR 存的地址
blx r3         @ 调用 r3 指向的函数（函数指针）
```

## ⑦ 栈与多寄存器搬运（A04/A05 的地基）

```text
push {r0-r3, lr}        @ 一条指令压多个：保存现场（函数开头）
pop  {r0-r3, pc}        @ 恢复现场 + 返回（保存了 pc 变体就能"弹出即返回"）
stmfd sp!, {r0,r1, lr}  @ 满递减压栈（= push 的原型）
ldmfd sp!, {r0,r1, pc}  @ 满递增弹栈（= pop + 返回，一条搞定）
```

### 练习 A03：每条指令都跑一遍 objdump

1. 写一个 `ops.s`，把上面 ①-⑦ **每条都抄一行**放进 `loop: b loop` 保护区域（>30 行），工具链三连。
1. `objdump -D ops.elf`：逐行核对每条指令的机器码。重点盯三个"魔法"：

`ldr r0, =0X0209C000` 伪指令实际编成了 `ldr r0, [pc, #...]`（从常量池取数）；
1. `subs` 和 `sub` 的机器码不同（S 标志体现在指令的 S 位）；
1. `push {r0-r3, lr}` 展开成一条 `stmfd sp!, ...`。
1. **实战验证**：用 `orr (...) #(1<<3)` 和 `bic #(1<<3)` 在 r1 上先置位再清位，最后 `mov r2, r1, lsl #1`，全流程推进 Set→Clear→Shift 的位操作手感。
1. 对照 [指令示例库](/my-blog/posts/arm汇编/reference-instructions/)，把还不熟的指令各找一行，抄进 ops.s 再编一遍——"会用 = 亲口编过一次"。

## 随堂小测

<details>
<summary>怎么把 r1 的第 3 位（bit3）清成 0？</summary>

bic r1, r1, #(1<<3)。bic=bit clear：把指定位清 0。前置 # 表示立即数；(1<<3) 就是"构造第 3 位"的写法。

</details>

<details>
<summary>ldr r0, =0X0209C000 和 ldr r0, [r1] 有什么区别？</summary>

前者是伪指令，把常量"地址值"塞进 r0（外设寄存器访问时用）；后者从内存读：r0 = *(r1)。看有没有方括号。

</details>

<details>
<summary>if (a==b) 在汇编里通常是怎样的三步？</summary>

cmp a, b → 只改标志 → 用 beq/bne 条件跳转（或 moveq 条件执行）。cmp 不存结果，只把比较结果写进 CPSR 标志。

</details>

<details>
<summary>push {r0-r3, lr} 和 pop {r0-r3, pc} 是什么关系？</summary>

一对栈操作：push 把现场（含返回地址 LR）压进栈；pop 弹出并直接放进 pc 就"恢复现场并返回"。必须严格配对，否则栈错乱上层函数崩。

</details>

> **要带走的** ① 七组指令各记 2-4 条；② ldr 伪指令 vs 真读内存（看方括号）；③ cmp+条件后缀 = if 的底层；④ 移位 = "第几位"的通用写法。**不懂的指令去 [指令示例库](/my-blog/posts/arm汇编/reference-instructions/) 查——那就是你随身的汇编词典。**

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 7 章（汇编基础，MOV/MRS/LDR/STR/PUSH/STMFD/B/BL/UDIV + 条件后缀）
- 本工作区：[ARM 指令示例库](/my-blog/posts/arm汇编/reference-instructions/) · [ARM 速查表](/my-blog/posts/arm汇编/reference-arm-cheatsheet/)
- 深度参考：*ARM Architecture Reference Manual (ARMv7-A)* 指令集章节

**有不清楚的直接问我（agent）**。立即数/伪指令/条件后缀是三个最常见的小坑；把 exception 和 objdump 输出贴给我，逐条陪你读。

| [← 上一课](/my-blog/posts/arm汇编/0002-arm-registers-modes/) | [课程目录](/my-blog/posts/arm汇编/00-总览/) | [下一课 →](/my-blog/posts/arm汇编/0004-branch-loop-delay/) |
