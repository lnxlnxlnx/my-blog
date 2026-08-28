---
title: 内核定时器与并发：驱动也会"多线程"
published: 2026-08-21
description: Linux 驱动课程第 7 课:让内核过一段时间后自己调你(jiffies + mod_timer 周期定时),并意识到驱动代码可能同时在多个地方跑——mutex/spinlock/atomic 的并发选型。
tags: [Linux, 嵌入式, 驱动开发, 内核定时器, 并发, mutex, spinlock]
category: Linux驱动
draft: false
prevTitle: ""
prevSlug: ""
nextTitle: GPIO 中断与按键：别傻等，让内核来叫你
nextSlug: "linux驱动/0006-interrupt-button"
---

# 内核定时器与并发：驱动也会"多线程"

两个驱动入门的"隐形关卡"：一是让内核**过一段时间后自己调你**（定时器），二是意识到你的驱动代码可能**同时在多个地方跑**（并发）。这两关不过，复杂驱动会莫名其妙崩。

## 内核定时器：不是 sleep，是"预定闹钟"

想"1 秒后翻转 LED 一次"，能不能在驱动里 `sleep(1)`？不行——内核态阻塞整个系统。正确做法：注册一个 `timer_list`，到期了内核在**软中断上下文**回调你，回调里可以再重新注册，形成周期：

```c
static struct timer_list my_timer;
static void my_timer_cb(struct timer_list *t) {
    /* 到点了：翻转 LED 电平 */
    led_reverse();
    /* 重新安排下一次，形成周期定时 */
    mod_timer(&my_timer, jiffies + msecs_to_jiffies(1000));
}

/* init 里启动 */
timer_setup(&my_timer, my_timer_cb, 0);
mod_timer(&my_timer, jiffies + msecs_to_jiffies(1000));

/* exit 里销毁，否则模块卸载后回调还在 → 崩溃 */
del_timer_sync(&my_timer);
```

`jiffies` 是内核的心跳节拍（HZ 次/秒）。不必深究精度，先能"1 秒一次"稳定跑即可。

## 并发：驱动不是单线程的！

你的 read 回调可能被两个应用同时调用；中断也可能和主流程同时碰同一个变量。这就叫**竞争（race condition）**。内核提供了锁：

| 锁 | 适用 | 手感 |
|------|------|------|
| `mutex`（互斥锁/信号量） | 可以长时间持有、可能睡眠的临界区 | 像拿钥匙：拿不到就排队等着 |
| `spinlock`（自旋锁） | 极短临界区、不能睡眠（如中断下半部） | 拿不到就原地打转，不敢睡觉 |
| 原子变量 `atomic_t` | 就是加加减减的计数器 | 不用锁，硬件保证一次完成 |

> 💡 **新手铁律** 用锁没有最好的，只有"别在持锁时睡眠/做复杂事"。习惯：先加 `mutex` 保护你驱动里的"共享状态"（比如 LED 当前亮灭），再意识到这个状态要是被中断碰，就得注意 spinlock 或原子操作。

### 练习 L07：LED 自动闪烁 + 用互斥锁保护状态

1. 在 L05 的 led 驱动里加定时器：加载后 LED 每 1 秒翻转一次。
2. 应用 `echo 1/0` 手动覆盖时，和定时器翻转**不会打架**（用 mutex 把"读当前状态+改状态"包成临界区）。
3. 故意不加锁跑一下看现象，再加上锁对照，体会"并发"是真实存在的。
4. 然后把闪烁周期改成可配置（通过 file_operations 写入），进阶体会"定时器+状态+锁"三者协作。

## 自测

### 自测 1

<details><summary>驱动里为什么不能用 sleep(1) 实现延迟？</summary>sleep 让当前执行体让出 CPU、整个系统流程不可控（内核态不能随便睡眠挂起）。用 jiffies + 定时器，到期由内核在回调点叫你，不阻塞其他工作。</details>

### 自测 2

<details><summary>mutex 和 spinlock 什么时候选谁？</summary>临界区短且可能在中断上下文 → spinlock（不能睡）；可能睡眠/等待漫长的临界区 → mutex。记：能睡 mutex，不能睡 spinlock。</details>

### 自测 3

<details><summary>定时器回调和 read 同时操作 LED 状态，不加锁会怎样？</summary>可能读到"读到一半"的中间状态，或互相覆盖。驱动共享状态必须被锁或原子操作保护，否则是典型数据竞争 bug。</details>

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 50 章（内核定时器）、第 47/48 章（并发与竞争/实验）
- [Linux 内核锁教程](https://www.kernel.org/doc/html/latest/kernel-hacking/locking.html)（官方权威）
- 本工作区 术语表（`docs/reference/glossary.html`）

## 小结

> 💡 **要带走的** ① jiffies + mod_timer 周期定时；② mutex/spinlock/atomic 的选型直觉；③ 共享状态必须加锁。"并发"意识是写好驱动与只会"照搬例程"的分水岭。

**有不清楚的直接问我（agent）**。定时器/锁概念一次没透没关系，Phase 2 的驱动会反复用到——带着"我到底哪里可能同时在跑?"这个问题学，会越学越清楚。

| [← 上一课](/my-blog/posts/linux驱动/0006-interrupt-button/) | [课程目录](/my-blog/posts/linux驱动/00-总览/) | [下一课 →](/my-blog/posts/linux驱动/0008-device-tree-basics/) |