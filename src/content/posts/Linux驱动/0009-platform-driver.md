---
title: platform 驱动
published: 2026-08-23
description: Linux 驱动系列第 9 课：platform 驱动——compatible 匹配设备树节点、probe/remove 生命周期、从设备树读 GPIO 取代写死地址，实现"驱动/设备树/板子"三方解耦。
tags: [Linux, 嵌入式, 驱动开发, platform, 设备树, compatible, probe]
category: Linux驱动
draft: false
prevTitle: pinctrl 与 GPIO 子系统
prevSlug: "linux驱动/0010-pinctrl-gpio-subsystem"
nextTitle: 设备树入门
nextSlug: "linux驱动/0008-device-tree-basics"
---

# platform 驱动

*阶段 2 · 关键转折点 · 动手约 40 分钟*

L05 的 LED 驱动把地址写死在 #define。这课把它改成 **platform 驱动**：`compatible` 匹配上设备树节点，然后从设备树里**读**出 GPIO/中断/寄存器地址来初始化。驱动从此"不认识具体板子"，却能在任何一块按同样设备树描述的板子上工作。

## platform：没有总线，就给你一根"虚拟总线"

不是所有外设都有 PCI/USB 那种物理总线。设备树里的节点，最终都由 **platform bus**（一根虚拟总线）来配对：设备树节点 → `platform_device`，驱动 → `platform_driver`，两者按 `compatible` 对上，总线调驱动的 probe 函数。

```c
static const struct of_device_id myled_of_match[] = {
    { .compatible = "alientek,led", },
    { /* 空白结束 */ }
};

static int myled_probe(struct platform_device *pdev) {
    /* 从设备树拿资源：
       设备树里 gpios = <&gpio1 3 GPIO_ACTIVE_LOW>
       换成运行时可用的 gpio 描述结构 */
    /* 拿到 GPIO 号 + 时钟使能 + ioremap... */
    printk("myled probe! 设备树节点:%s\n", pdev->dev.of_node->name);
    return 0;
}

static int myled_remove(struct platform_device *pdev) {
    /* 清理 */
    return 0;
}

static struct platform_driver myled_drv = {
    .probe  = myled_probe,
    .remove = myled_remove,
    .driver = {
        .name = "myled",
        .of_match_table = myled_of_match,
    },
};
module_platform_driver(myled_drv);   /* 代替 module_init/exit 的一行式 */
```

这段代码没有"写死任何地址"。GPIO 号、电气配置都来自设备树节点，运行时查出。这就是"驱动"与"板子"分离。

## 设备树 VS 写死：两条路都要练

> 💡 **别急躁** "写死寄存器"和"读设备树"，两条路你都要练过才算真懂。写死版逼你在 L05 亲手摸寄存器，设备树版让你明白"为什么 Linux 大厂都用设备树"。先写死、再改设备树版，收益最大。

## 动手练习

### 练习 L09：把 L05 的 led 驱动改成 platform 版

1. 在你的 4.1.15 内核源码里，新建设备树就照 `imx6ull-alientek-emmc.dts`，给 led 加一行 `compatible = "alientek,led";` 并保留 `gpios` 属性。重新 `make dtbs`。
2. 写 `myled_platform.c`：用 `platform_driver + of_match_table`，probe 里用 `of_get_named_gpio()` / `gpiod_get()` 拿 GPIO。
3. 编译 .ko 上板，insmod 后 `ls /sys/bus/platform/drivers/myled` 看驱动有没有"匹配到设备"（dmesg 应打印 probe）。
4. 改设备树里 LED 的引脚（比如 NO 别的引脚别用错），重编 dtb 上板——**同一个 .ko 不用改，就看它适配新描述**。这一下你才彻底理解设备树的意义。
5. 记得：修改之后不要乱烧——先只在 PC 编译 .dtb，把"改描述"和"烧录"分开。

## 自测

### 自测 1

<details>
<summary>设备树节点和 platform_driver 是怎么"对上"的？</summary>

靠 compatible：节点里的 `compatible` 字符串和驱动的 `of_match_table` 匹配，匹配成功 platform 总线调 probe。probe 收到的 pdev 里就有设备树节点。

</details>

### 自测 2

<details>
<summary>probe 是什么时候被调用的？</summary>

insmod 驱动 + 设备树节点里已经有匹配设备时，总线把两者配对后调用。或者内核启动时设备树节点先有、驱动(内置)后来注册，也会触发 probe。

</details>

### 自测 3

<details>
<summary>为什么说"驱动不认识具体板子"了？</summary>

因为地址/GPIO/中断等从设备树运行时给出。驱动只写"怎么驱动这类设备"，板子差异全在设备树里描述。同一份 .ko 换板子或改描述都不用重编译。

</details>

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 54 章「platform 设备驱动」、第 55 章「设备树下的 platform 驱动」、第 44 章「设备树下的 LED 驱动」(dtsled)
- 内核文档 `Documentation/driver-api/driver-model/platform.rst`

## 小结

> 💡 **要带走的** ① compatible 匹配 + probe/remove 生命周期；② 从设备树读 GPIO 取代写死地址；③ "驱动 / 设备树 / 板子"三方解耦。这是从"码农例程"到"Linux 驱动正统写法"的跨越。

**有不清楚的直接问我（agent）**。probe 不打印、驱动名不对、设备树没生效——这类是平台驱动最常见的坑，把 dmesg 和 dts 贴给我。

| [← 上一课](/my-blog/posts/linux驱动/0008-device-tree-basics/) | [课程目录](/my-blog/posts/linux驱动/00-总览/) | [下一课 →](/my-blog/posts/linux驱动/0010-pinctrl-gpio-subsystem/) |
