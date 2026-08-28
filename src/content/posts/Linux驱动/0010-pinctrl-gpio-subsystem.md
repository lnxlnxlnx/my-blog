---
title: pinctrl 与 GPIO 子系统
published: 2026-08-24
description: Linux 驱动系列第 10 课：pinctrl 与 GPIO 子系统——管引脚复用/电气配置与方向/电平的分工、设备树叫官方驱动不写代码点灯、gpiolib 驱动侧 API。
tags: [Linux, 嵌入式, 驱动开发, pinctrl, GPIO, 子系统, gpiolib]
category: Linux驱动
draft: false
prevTitle: 编译内核与设备树
prevSlug: "linux驱动/0011-build-kernel"
nextTitle: platform 驱动
nextSlug: "linux驱动/0009-platform-driver"
---

# pinctrl 与 GPIO 子系统

*阶段 2 · 动手约 35 分钟*

你这几课都在"手搓寄存器"。但 Linux 早把 GPIO 事件封装成了**子系统**：pinctrl（管复用电/引脚下拉等）+ gpio 子系统（管方向和电平）。学会用它们，你的驱动能跑在任何用这套框架的 SoC 上，还自动有了 sysfs 接口。这是从"能点亮"到"工程化"的一课。

## 两个子系统管什么

| 子系统 | 管的活 | 你的 LED 例子里对应 |
|------|------|------|
| **pinctrl** | 引脚复用功能、上下拉/速度/驱动能力的电气配置 | • 选定函数 mux=GPIO alt5 • 配置 pad 属性 |
| **gpio 子系统** | 方向、读写电平、中断请求 | • 方向输出 • DR 写 1/0 |

你把这两块的寄存器调用，换成内核提供的 API。应用侧甚至不用写驱动测试——gpio 子系统自带 `/sys/class/gpio` 用户接口（gpiolib 的 sysfs 导岀），可以 `echo 3 > export` 之后直接 `echo 1/0 > value`。

## 在 GPIO 子系统的用法（设备树 + 驱动 API）

```text
/* 设备树里这样描述 pinctrl 和 gpio */
leds {
    compatible = "gpio-leds";            /* 内核自带的，直接就亮了 */
    led-red {
        gpios = <&gpio1 3 GPIO_ACTIVE_LOW>;
        default-state = "on";
    };
};
```

> 💡 **事件点** 只要设备树有 `compatible = "gpio-leds"`，内核自带的 `leds-gpio` 驱动就会接管，而且 `/sys/class/leds/red` 立即生成。这就是 L10 最大的爽点：**设备树换成官方子系统的描述，驱动都不用写，灯就亮了**。这是 官方驱动 vs 手写驱动的分界。

## 驱动侧 API（你还是要会用）

```c
struct gpio_desc *gpiod_get(struct device *dev, const char *con, int flags);
gpiod_direction_output(gpio, 1);   /* 输出高电平 */
gpiod_set_value(gpio, 0);          /* 写电平 */
gpiod_to_irq(gpio);                /* GPIO 转中断号（L06 里若用中断就用它替代手数） */
```

## 动手练习

### 练习 L10：三个层次点亮同一个 LED

同一个红灯，用三种姿势点它，理解"手写 vs 写半套 vs 不写"：

1. **sysfs 白嫖**：先查 GPIO1_IO03 在 sysfs/gpiolib 里的编号——`cat /sys/kernel/debug/gpio`（无权限则 `dmesg | grep gpio`）找到 "gpio-XX"；然后 `echo XX > /sys/class/gpio/export`、`echo out > /sys/class/gpio/gpioXX/direction`、`echo 0 > /sys/class/gpio/gpioXX/value` 点亮——注意不同板子 gpio 编号基址不同，别照抄，要现场查。
2. **设备树叫官方驱动**：把设备树 led 节点 `compatible = "gpio-leds"`，重编 dtb 上板，看 `/sys/class/leds/red/brightness` 出现，`echo 1 > brightness` 灯亮——**你一行驱动代码都没写**。
3. **驱动里用 gpiolib**：把你的 platform 驱动改成 `gpiod_*` API，删掉手写寄存器。

做完你会彻底明白：为什么 Linux 说"能用子系统就别手搓寄存器"。子系统的价值不在"少写字"，而在**跨平台 + 有标准接口 + 别人能复用**。

## 自测

### 自测 1

<details>
<summary>pinctrl 和 gpio 子系统各自管什么？</summary>

pinctrl 管引脚功能复用电特和电气属性；gpio 管方向和电平。GPIO1_IO03 的"选 GPIO 功能、配置上下拉"是 pinctrl，"设输出、写0/1"是 gpio。

</details>

### 自测 2

<details>
<summary>为什么推荐尽量用子系统而不是手写寄存器？</summary>

跨 SoC 可移植、有标准 sysfs/中断 API、驱动更简洁、内核社区维护且验证充分。缺点是要学它的抽象——但价值大于成本。

</details>

### 自测 3

<details>
<summary>gpio-leds 驱动的设备树里，gpios 怎么写才表示"低电平点亮"？</summary>

在 gpios 属性里加 `GPIO_ACTIVE_LOW` 标志。驱动看到它就知道"电平反转"。这比手写寄存器里记得"低有效"高级——语义化。

</details>

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 45 章「pinctrl 和 gpio 子系统实验」(gpioled)、第 44 章设备树 led(dtsled)
- 内核文档 `Documentation/driver-api/gpio/`

## 小结

> 💡 **要带走的** ① pinctrl/gpio 子系统的职责分工；② "设备树调用官方驱动"三层里最上层的最爽路径；③ gpiolib API。**到这里，你的"点灯"已经能隔着多个抽象层完成——是时候准备重编整个系统镜像了。**

**有不清楚的直接问我（agent）**。特别是"gpiod 怎么拿、拿错了会不会烧板"这类疑虑——问清楚再动手，毕竟之后要碰系统镜像了。

| [← 上一课](/my-blog/posts/linux驱动/0009-platform-driver/) | [课程目录](/my-blog/posts/linux驱动/00-总览/) | [下一课 →](/my-blog/posts/linux驱动/0011-build-kernel/) |
