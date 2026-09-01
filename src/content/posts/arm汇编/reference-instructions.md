---
title: ARM 指令示例库
published: 2026-08-20
description: ARM 指令逐条示例，随查随用
tags: [ARM, 汇编, 嵌入式, 参考]
category: ARM汇编
draft: false
prevTitle: "ARM 寄存器与指令速查"
prevSlug: "arm汇编/reference-arm-cheatsheet"
nextTitle: "裸机 ARM 汇编课程总览"
nextSlug: "arm汇编/00-总览"
---

# ARM 指令示例库

A03 只讲了"你常碰的 15 条"。这里是完整一些的**示例库**——每条指令一行示例 + 一行注释，按类别分组。**不必背**，当作查表用；配套课程 [A03](/my-blog/posts/arm汇编/0003-asm-instructions/) 里的练习就是拿这里的指令"点兵点将"。

## ① 数据传输（把值/地址送进寄存器）

```text
mov r0, #5              @ r0 = 5（立即数）
mov r0, r1              @ r0 = r1（寄存器拷贝）
mvn r0, #0              @ r0 = ~0 = 0xFFFFFFFF（按位取反再放）
mrs r0, cpsr            @ r0 = cpsr（读状态寄存器）
msr cpsr, r0            @ cpsr = r0（写状态寄存器）
ldr r0, =0X0209C000     @ r0 = 那个"地址值"（伪指令，取立即数）
ldr r1, [r0]            @ r1 = *(r0)（读内存）
str r1, [r0]            @ *(r0) = r1（写内存）
str r1, [r0, #4]        @ *(r0+4) = r1（基址+偏移）
str r1, [r0, #4]!       @ *(r0+4) = r1；且 r0 += 4（! 回写基址）
str r1, [r0], #4        @ *(r0) = r1；然后 r0 += 4（后变址）
```

## ② 算术运算

```text
add r0, r1, r2          @ r0 = r1 + r2
add r0, r0, #1          @ r0 = r0 + 1（自增）
adc r0, r0, #0          @ r0 = r0 + 进位（多精度加法用）
sub r0, r1, r2          @ r0 = r1 - r2
subs r0, r0, #1         @ r0 = r0 - 1，且更新 Z/N 标志（延时循环的灵魂）
sbc r0, r0, #0          @ r0 = r0 - 借位
rsb r0, r1, #10         @ r0 = 10 - r1（反向减法，把"取x=10-x"写成一条）
mul r0, r1, r2          @ r0 = r1 * r2（32 位乘法）
mla r0, r1, r2, r3      @ r0 = r1*r2 + r3（乘加）
umull r0, r1, r2, r3    @ {r1:r0} = r2 * r3（64 位结果，@r0 低32 r1 高32）
udiv r0, r1, r2         @ r0 = r1 / r2（无符号除法，ARMv7 有）
sdiv r0, r1, r2         @ r0 = r1 / r2（有符号除法）
```

## ③ 逻辑 / 位运算（配寄存器就是"开关位"）

```text
and r0, r0, r1          @ r0 &= r1（取交）
orr r0, r0, #(3<<26)    @ r0 |= 3<<26（置位：开时钟就这种）
eor r0, r0, r1          @ r0 ^= r1（异或：翻转位）
bic r0, r0, #(1<<3)     @ r0 &= ~(1<<3)（清 bit3）
tst r0, #(1<<18)        @ 检查 bit18：按位与，只改 Z 标志（不写回 r0）
teq r0, r1              @ 检查 r0==r1：异或判等，只改标志
cmp r0, r1              @ r0 - r1，只改标志（比较）
cmn r0, r1              @ r0 + r1，只改标志（比较反数）
clz r0, r1              @ r0 = r1 前导零个数（找最高位 1 的位置）
```

## ④ 移位（作为"操作数"移位和独立移位指令）

```text
mov r1, r2, lsl #2      @ r1 = r2 << 2（逻辑左移）
mov r1, r2, lsr #2      @ r1 = r2 >> 2（逻辑右移）
mov r1, r2, asr #2      @ r1 = r2 >> 2（算术右移：最高位补符号，用于有符号数）
mov r1, r2, ror #2      @ r1 = r2 循环右移 2 位
mov r0, r1, lsl r3      @ r0 = r1 << r3（移位量可变——数组下标索引很方便）
orr r0, r0, #(1<<3)     @ 立即数里也常配移位：等价于 orr r0, r0, #8，可读性更好
```

## ⑤ 多寄存器搬运：PUSH/POP 与 LDM/STM（栈和现场保存）

```text
push {r0-r3, r12}       @ 把 r0..r3、r12 压栈（一条代替多条 str）
push {lr}               @ 保存返回地址（函数开头必做）
pop  {lr}               @ 恢复返回地址
pop  {r0-r3, r12}       @ 恢复现场
stmfd sp!, {r0-r3, lr}  @ 满递减压栈：sp 先减，再存（= push 的原型）
ldmfd sp!, {r0-r3, pc}  @ 满递增弹栈并把最后存的送给 pc（= pop + 返回 一条搞定）
```

> **栈是"后进先出"** push 和 pop 必须**严格配对**：函数开头 `push {lr}`，结尾 `pop {lr}`（或 `ldmfd sp!, {..., pc}` 一口气返回）。压栈/弹栈顺序反了，现场就乱了，上层函数返回必然崩。

## ⑥ 跳转 / 调用

```text
b    label              @ 无条件跳转（不回来）
bl   func               @ 调用子程序：把返回地址存 LR，再跳
bx   lr                 @ 返回（跳到 LR 指向的地址）
bx   r3                 @ 跳到 r3 里的地址（函数指针）
blx  r3                 @ 调 r3 指向的函数（带返回）
blx  func               @ 等价形式，顺便可能切 Thumb 模式
loop:              @ 标签本身不是指令，只是地址记号
     subs r2, r2, #1
     bne  loop          @ Z=0 就跳（还没减到 0）
```

## ⑦ 条件执行后缀全表（挂在任意指令后面）

```text
cmp r0, r1
beq  done       @ EQ：相等        (r0==r1)   Z=1
bne  done       @ NE：不等        (r0!=r1)   Z=0
bcs  done / bhs @ CS/HS：无符号 >= (进位/高或相同)  C=1
bcc  done / blo @ CC/LO：无符号 <  （借位/更低）   C=0
bmi  done       @ MI：负数        N=1
bpl  done       @ PL：非负        N=0
bvs  done       @ VS：溢出        V=1
bvc  done       @ VC：无溢出      V=0
bhi  done       @ HI：无符号 >   (且 Z=0)  C=1 且 Z=0
bls  done       @ LS：无符号 <=  C=0 或 Z=1
bge  done       @ GE：有符号 >=   N==V
blt  done       @ LT：有符号 <    N!=V
bgt  done       @ GT：有符号 >    (Z=0 且 N==V)
ble  done       @ LE：有符号 <=   Z=1 或 N!=V
bal  done       @ AL：总是（默认）
@ 后缀不只用于 b，也用于普通指令：
moveq r0, #1    @ 仅当 Z=1 才执行：r0 = 1
addne r0, r0, #1 @ 仅当 Z=0 才加
```

## ⑧ 特殊 / 软中断 / 杂项

```text
svc 0x13        @ （旧名 swi）软中断：陷入内核/异常，Linux 系统调用就是它
nop             @ 空操作（占位/对齐）
yield           @ 提示 CPU 可让出（多核友好）
wfi / wfe       @ 等中断/等事件（省电睡眠，被唤醒才继续）
dmb / dsb / isb @ 内存屏障：保证读写顺序（多核/与外设通信时防乱序）
```

## 看注释过的一条：怎么"读"陌生指令

```text
str r1, [r2, #4]!
@ 从右往左读：先算地址 r2+4，做存储(把 r1 写进去)，! 表示把算出的地址写回 r2。
@ 拆解词典：str=存到内存  [r2,#4]=基址+偏移  !=回写基址。
```

还配了逐条练习：[A03 指令与寻址](/my-blog/posts/arm汇编/0003-asm-instructions/)；寄存器表见 [ARM 速查表](/my-blog/posts/arm汇编/reference-arm-cheatsheet/)。

| [← 上一课](/my-blog/posts/arm汇编/00-总览/) | [课程目录](/my-blog/posts/arm汇编/00-总览/) | [下一课 →](/my-blog/posts/arm汇编/reference-arm-cheatsheet/) |
