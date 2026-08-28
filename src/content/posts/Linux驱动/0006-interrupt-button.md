---
title: GPIO 中断与按键：别傻等，让内核来叫你
published: 2026-08-20
description: Linux 驱动课程第 6 课:硬件一有动作就打断 CPU——轮询 vs 中断的取舍、request_irq 注册、上半部/下半部两段式、等待队列实现阻塞式读按键。
tags: [Linux, 嵌入式, 驱动开发, 中断, GPIO, request_irq, 等待队列]
category: Linux驱动
draft: false
prevTitle: 内核定时器与并发：驱动也会"多线程"
prevSlug: "linux驱动/0007-timers-concurrency"
nextTitle: LED 驱动：第一次亲手写寄存器
nextSlug: "linux驱动/0005-led-driver-gpio-registers"
---

# GPIO 中断与按键：别傻等，让内核来叫你

上一课点灯靠应用"主动写"。但按键是**板子先发生**的事——应用总不能死循环轮询"按下没？"。这课让硬件一有动作就打断 CPU、叫你起来干活。这就是**中断**，板子上九个软件模块的核心机制。

## 轮询 vs 中断

|  | 轮询 Poll | 中断 IRQ |
|------|------|------|
| 谁主动 | CPU 反复问 | 硬件主动说 |
| 等等 | 浪费 CPU | 空闲时休眠 |
| 适用 | 极高频/IO 简单 | 按键/外部事件 |

你之前 C 应用里 `read` 手柄/触摸常是轮询；驱动侧按键用中断，更省电也更"正统"。

## 中断的两段式：上半部 + 下半部

1. **request_irq** 注册中断处理函数：`request_irq(irq_num, irq_handler, flags, name, data)`，flags 里指定触发方式（如 `IRQF_TRIGGER_LOW` 低电平触发）。
2. **上半部 irq_handler**：在 `irq` 上下文里跑，**必须快**——只能清标志、记状态、唤醒等待队列。绝不能做耗时的 IO。
3. **下半部**（如 `tasklet`/`workqueue`）：把真正耗时的活（往屋里送数据）推到这里做。你是新手，先掌握"上半部快速记状态 + 唤醒"即可。

服务中断后，应用还想要"等待按键"的语义，用**等待队列 + 唤醒**机制：应用在 read 里阻塞睡眠，中断来了被唤起，有数据才醒。

## GPIO 中断的硬件链路（IMX6ULL）

按键 KEY0 = GPIO1_IO18，按下为低。要它产生中断：

1. 让 GPIO1_IO18 的引脚能产生中断：IOMUX 设成 GPIO，GPIO1_ICR1/2 配置触发沿（这里是下降沿），GPIO1_IMR 放开掩码。
2. `request_irq` 申请中断号。IMX6ULL 的 GPIO 中断号可以通过 `gpio_to_irq(GPIO1, 18)` 或从设备树拿（后面 L09 讲）。中断来后看 `> /proc/interrupts` 确认触发。
3. 上半部里读取 GPIO1_ISR 判断是不是这个引脚、清标志。

真机中断还有细节（触发沿选择 ICR、中断掩码 IMR 等，见速查表寄存器表），但这些先把"中断发生 → 处理函数被调 → 应用被唤醒"整条链路跑通最重要。

### 练习 L06：按键中断 → 应用打印 "KEY0 pressed"

1. 写 `mykey.c`：`request_irq` 注册中断处理，上半部打印 `printk("KEY0 irq!\n")` 并计数。
2. 用 `cat /proc/interrupts` 显示那个中断号的次数在变化（链路跑通的最直接证据：按一次，计数 +1）。
3. 再用等待队列改造：应用 `read()` 阻塞等待，中断来时 `wake_up_interruptible`，应用收到通知打印。
4. 进阶：把触发沿从下降沿换成上升沿，观察按键行为变化，理解触发沿。

## 自测

### 自测 1

<details><summary>为什么中断处理函数要"短"？</summary>它运行在中断上下文，长函数长时间占用会拖慢整个系统/丢失其他中断。原则：进得去、干完快、立刻走，耗时的丢给下半部。</details>

### 自测 2

<details><summary>怎么确认中断真的发生了？</summary>`cat /proc/interrupts` 里该中断号计数增长。这是调试中断第一手证据，比 printk 还客观。</details>

### 自测 3

<details><summary>应用想在 read 里等到按键再返回，驱动用什么机制？</summary>等待队列：应用阻塞睡眠，中断到来唤醒它。这叫"阻塞式 IO"，L08/52 章还会深化（poll 等）。</details>

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 51 章「Linux中断」，第 52 章「阻塞与非阻塞 IO」（等待队列）
- 第 17 章 裸机 GPIO 中断（寄存器层的 GIC/GPIO 控制器，如果你想看硬件链路源头）
- 本工作区 速查表（`docs/reference/imx6ull-cheatsheet.html`）（GPIO 中断寄存器偏移）

## 小结

> 💡 **要带走的** ① 轮询 vs 中断的取舍；② request_irq + /proc/interrupts 调中断；③ 下半部思路。**这是系统软件"事件驱动"的核心手感。**

**有不清楚的直接问我（agent）**。中断新手常见的坑：handle 里 printk 太长、忘了清标志导致中断风暴——看到板子像卡死一样狂打印，先 Ctrl+C 再回来找我。

| [← 上一课](/my-blog/posts/linux驱动/0005-led-driver-gpio-registers/) | [课程目录](/my-blog/posts/linux驱动/00-总览/) | [下一课 →](/my-blog/posts/linux驱动/0007-timers-concurrency/) |