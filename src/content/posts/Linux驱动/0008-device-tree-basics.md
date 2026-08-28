---
title: 设备树入门
published: 2026-08-22
description: Linux 驱动系列第 8 课：设备树入门——节点/属性/compatible 三要素、dts → dtb → 内核的链路、在板子 sysfs 里验证实际生效的设备树，为 platform 驱动铺路。
tags: [Linux, 嵌入式, 驱动开发, 设备树, dtb, compatible]
category: Linux驱动
draft: false
prevTitle: platform 驱动
prevSlug: "linux驱动/0009-platform-driver"
nextTitle: 内核定时器与并发
nextSlug: "linux驱动/0007-timers-concurrency"
---

# 设备树入门

*阶段 2 · 动手约 30 分钟（PC 端 + 板上只读）*

L05 你"写死了" GPIO 的地址和引脚。设备树描述的设备：把**"板子上接了哪些硬件，接在哪"**写成一个数据文件（.dts → .dtb），内核启动时读它，驱动按它在运行时拿资源。从此一个驱动能适配很多块板。

## 设备树到底解决什么

过去：每个板子都要写一堆"板级代码"告诉内核硬件配置，改板子=改内核源码。设备树把"硬件长什么样"和"驱动怎么驱动"**剥离开**：

- **Node（节点）**：描述一个设备，用花括号定义，如 `led { ... }`
- **Property（属性）**：这个设备的具体参数：名字、地址、状态、中断等。
- **compatible**："哦，这个节点应该由哪个驱动来管"——驱动 `of_match_table` 里写同样的字符串，就算配对成功。

```text
/ {                       /* 根节点 */
    leds {
        compatible = "gpio-leds";        /* 指名由谁驱动 */
        led0: led-red {
            label = "red";
            gpios = <&gpio1 3 GPIO_ACTIVE_LOW>;  /* GPIO1_IO03 低电平点亮 */
        };
    };
};
```

## dts → dtb → 内核的旅程

`.dts`（文本）由 `dtc` 编译成 `.dtb`（二进制），u-boot 把 dtb 传给内核（还记得 L01 的那个 `0x83000000` 吗）。如果你已经在内核树里，改名字就行：

```bash
# 在内核源码树里
make ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf- dtbs   # 编译所有 dts
# 生成 arch/arm/boot/dts/imx6ull-alientek-emmc.dtb
```

内核里对应驱动用 `of_*` API 读出属性（如 `of_get_named_gpio`）来配置硬件。

## 在真实板子上验证设备树

> 💡 **板上只读** 设备树被内核解析后的信息，可以在 sysfs 里看到：`/sys/firmware/devicetree/base/` 就是 `/` 根节点的镜像。这是"XX 板子实际生效的设备树"的最直接证据。

## 动手练习

### 练习 L08：看懂你板子的设备树

1. **PC 端**：在你手里的 4.1.15 内核源码里找到 `arch/arm/boot/dts/imx6ull-alientek-emmc.dts`，`grep -n gpio / 找到 led 和 key 节点`，看它的 compatible 和 properties。
2. **板上**：`ls /sys/firmware/devicetree/base/`，找到和 dts 根节点一致的目录结构。`cat /sys/firmware/devicetree/base/soc/.../compatible` 之类，对一对。
3. 在 dts 里把 `led-red` 节点的 `label` 改成你名字，**先不要烧**，只编译 dtb（`make dtbs`），确认编译通过。理解"改一行文本 → 新 dtb"。
4. 回答自己：这个 dts 里 `compatible = "gpio-leds"` 驱动在内核哪？（答案在下一步 L09/L10）

## 自测

### 自测 1

<details>
<summary>compatible 属性的作用？</summary>

声明"我这个节点应该由哪个驱动接管"。驱动里 `of_match_table` 写下相同字符串，与节点配对。它是"设备(节点) ↔ 驱动"的钥匙。

</details>

### 自测 2

<details>
<summary>dts、dtc、dtb 分别是什么？</summary>

dts = 人类写的文本；dtc = 编译器；dtb = 编译出的二进制，给内核烧/传。类比 源码 .c → gcc → 可执行文件。

</details>

### 自测 3

<details>
<summary>设备树是"运行时"还是"编译时"生效？</summary>

两种都有：dts/dtb 编译时确定；但解析发生在内核启动时，驱动运行时读出属性。所以改 dtb 不用重编驱动，重编内核源码也不用动板极电路。

</details>

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 43 章「Linux 设备树」
- [设备树规范官方文档](https://devicetree-specification.readthedocs.io/en/latest/)（权威语法）
- 内部：`Documentation/devicetree/bindings/` ——每种官方驱动怎么描述硬件，范例很多

## 小结

> 💡 **要带走的** ① 设备树=硬件的"描述文件"，节点=设备、compatible=对接密码；② dts→dtb→内核→sysfs 链路；③ 你在板子的 /sys/firmware/devicetree 里"看到"了硬件。下一课把设备树连进自己的平台驱动，真正摆脱"写死地址"。

**有不清楚的直接问我（agent）**。设备树术语多但不难，来来回回就节点/属性/compatible/中断/reg 这几个。看懂你的 dts 比看一百篇教程管用。

| [← 上一课](/my-blog/posts/linux驱动/0007-timers-concurrency/) | [课程目录](/my-blog/posts/linux驱动/00-总览/) | [下一课 →](/my-blog/posts/linux驱动/0009-platform-driver/) |
