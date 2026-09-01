---
title: 分支·循环·延时
published: 2026-08-26
description: subs+bne 延时循环、bl/mov pc,lr、LED 闪烁
tags: [ARM, 汇编, 嵌入式, 裸机]
category: ARM汇编
draft: false
prevTitle: "栈与汇编调 C"
prevSlug: "arm汇编/0005-stack-and-c"
nextTitle: "指令与寻址方式"
nextSlug: "arm汇编/0003-asm-instructions"
---

# 分支·循环·延时

`b loop` 你会了。真正的程序要"等一会""做 N 次"——这正是分支+循环。这课写一个**汇编延时循环**让 LED 闪烁，把 `cmp/subs/bne` 联动用熟。

## 一个简单的延时循环

```text
@ 让 r2 从 200000 递减到 0，每次还跑两条指令 → 每掉一格约几纳秒
@ 从而"浪费"出一段可感知的时间（这就是最朴素的软延时）

delay:
    subs r2, r2, #1     @ r2 = r2-1，同时更新 Z 标志（关键在 s 后缀）
    bne  delay          @ 若 Z=0（还没减到 0）就跳回去继续减
    @ 减到 0，Z=1，bne 不满足 → 落到下一行继续执行
    mov pc, lr          @ 返回
```

三条要点：

1. `sub**s**` 的 `s` 后缀让减法结果 **更新 CPSR 的 Z 标志**；没有 s 就不改标志，`bne` 就没依据。
1. `bne` = "Not Equal"，其实判断的就是 Z：Z=0（结果非 0）就跳。所以它做的是"还没到 0 就继续"。
1. 这就是 `while(r2-- > 0);` 的汇编形态——你已经在"写 C 的底层逻辑"了。

## 把它接进点灯：LED 闪烁

```text
@ 在 A01 点灯代码后，加一个闪灯主循环：
loop:
    b     blink           @ 或是直接走到下面

blink:
    ldr r0, =0X0209C000   @ GPIO1_DR
    ldr r1, =0X00000000   @ bit3=0 → 亮
    str r1, [r0]
    bl    delay           @ 调用延时（bl 会记录返回地址到 LR）

    ldr r1, =0X00000008   @ bit3=1 → 灭
    str r1, [r0]
    bl    delay

    b     blink           @ 循环：亮 灭 亮 灭...

delay:
    ldr   r2, =200000   
dloop:
    subs  r2, r2, #1
    bne   dloop
    mov   pc, lr          @ 返回调用处（LR = bl 记下的地址）
```

> **为什么这里要 `bl` 而不是 `b`？** `b delay` 只是跳，跳过去就不会回来了；`bl delay` 先存返回地址到 LR，延时完了 `mov pc, lr` 就能回来接着闪灯。A05 会把"跳出去还能回来"这件事讲透。

## 延时的代价：CPU 白忙，但足够应付光感知

软延时让 CPU 空转，缺点是不精确、和主频有关。裸机做毫秒级"等人看得见"完全够用；要精确/省电（Linux 驱动里）就用内核定时器或硬件定时器（EPIT）——那是 L07 和《指南》第 18 章的领域。

### 练习 A04：让 LED 真正闪起来

1. 把 blink + delay 拼到 A01 的 led.s 里，编译三连 + objdump。
1. 在反汇编里找到 `subs` 和 `bne` 的机器码，确认 S 标志后缀真的生成了不同的指令。
1. 改延时初值（比如 200000 → 50000），预测闪烁会变快还是变慢，**先写预测再烧/编验证**。
1. 思考题：把 `subs` 换成 `sub` 会怎样？用反汇编对比两者的区别，然后看懂"标志位被丢弃"导致的死循环。

## 随堂小测

<details>
<summary>subs 的 s 后缀到底在干嘛？</summary>

s 后缀让这条算术指令"更新 CPSR 条件标志"（这里主要是 Z：结果是否为 0）。bne 依赖 Z 判断，没有 s 标志不会变，bne 就永远"相等"或永远"不等"，循环就坏了。

</details>

<details>
<summary>bne delay 的跳转条件是什么？</summary>

Z=0 时跳（结果非 0，也就是 r2 还没减到 0）。注意 bne 名字叫"不等"，实际判的是 Z 标志：subs 结果非零 → Z=0 → 跳。

</details>

<details>
<summary>软延时有什么缺点？什么时候不该用它？</summary>

不精确、和主频/流水线相关、CPU 空转。做"够看的闪烁"很好；做精确计时、省电、就要用硬件定时器/内核定时器。Linux 驱动里几乎不用软延时。

</details>

> **要带走的** ① subs+bne 联动 = 基本循环结构；② bl/mov pc,lr 的"出去还能回来"；③ 软延时的边界认知。**下一课正式玩转"跳出去再回来"——栈与函数调用，也是你要读 C 语言版 LED 和 start.S 的关键。**

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 7 章（分支/循环、条件执行）与第 8 章完整 led.s（含延时闪烁写法）
- [ARM 指令速查表](/my-blog/posts/arm汇编/reference-arm-cheatsheet/)

**有不清楚的直接问我（agent）**。看到 "infinite loop" 或板子表现异常，多半是 subs 忘了 s 或 bne 判断反了。

| [← 上一课](/my-blog/posts/arm汇编/0003-asm-instructions/) | [课程目录](/my-blog/posts/arm汇编/00-总览/) | [下一课 →](/my-blog/posts/arm汇编/0005-stack-and-c/) |
