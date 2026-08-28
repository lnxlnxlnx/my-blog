---
title: 编译内核与设备树
published: 2026-08-25
description: Linux 驱动系列第 11 课：编译内核与设备树——.config 的 y/m/n 三态、make menuconfig 到 make 的流程、产出一套可替换的 zImage + dtb。
tags: [Linux, 嵌入式, 驱动开发, 内核编译, .config, menuconfig, zImage, dtb]
category: Linux驱动
draft: false
prevTitle: 根文件系统
prevSlug: "linux驱动/0012-rootfs"
nextTitle: pinctrl 与 GPIO 子系统
nextSlug: "linux驱动/0010-pinctrl-gpio-subsystem"
---

# 编译内核与设备树

*阶段 3 · PC 端编译·不碰板子 · 动手约 45 分钟*

前面把驱动当模块编。这一课把它"编进内核"、并产出一整套可以替换的 `zImage + dtb`。这是系统定制的地基——也是你从"会用板"升级到"DIY 系统"的那一步。

## 内核编译的本质：一块配置 + 一堆 Make 规则

- **.config** 一个"我觉得我的板需要什么功能"的清单。每行一个 `CONFIG_xxx=y/m/n`（y=编进内核，m=编成模块，n=不要）。
- **make menuconfig** 图形工具编辑 .config（在 PC 上有 ncurses 页面）。`make xx_defconfig` 生成默认 .config。
- **make** 按 .config 决定编哪些文件，最后链接成 `arch/arm/boot/zImage`，并生成各板 dtb。

```bash
# 在正点原子内核源码目录
source /opt/fsl-imx-x11/4.1.15-2.1.0/environment-setup-cortexa7hf-neon-poky-linux-gnueabi

make ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf- imx_v7_defconfig   # 用正点原子默认配置
make menuconfig        # 可视化调整（选 CONFIG_LEDS_GPIO 等）
make -j4 ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf-         # 编译
make ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf- dtbs        # 编设备树（或 zImage 时一并）
```

产物：`arch/arm/boot/zImage`（内核）、`arch/arm/boot/dts/imx6ull-alientek-emmc.dtb`（设备树）、`drivers/.../xxx.ko`（模块）。

> ⚠️ **安全提醒** 这一课的**全部动作都在 PC 上**，零风险。真正动板子的烧录在 `L14`，且我会先让你配好备份。现在尽管编。

## 验证你编的东西 :解压 zImage

```bash
# PC 上快速自检
arm-linux-gnueabihf-objdump -i | head -1            # 确认工具链是 arm
ls -l arch/arm/boot/zImage                           # 几 MB 的内核
arch/arm/boot/dts/ 下会按需生成 dtb，不必深究每个文件
```

## 动手练习

### 练习 L11：亲手产出一套 zImage + dtb

1. 解压内核源码（如果没有）→ 按上面命令先 `imx_v7_defconfig` + `make` 编译出 zImage。第一次编译可能 10 分钟+，耐心等。
2. `make menuconfig` 找到 `Device Drivers → LED Support → LED Class + LED Support for GPIO attached LEDs(CONFIG_LEDS_GPIO)`，把 `y`（编进内核）。保存退出。
3. 做出你**自己加上**的那条 led 设备树，`make dtbs`，确认 dtb 更新。
4. 把 `imx_v7_defconfig` 与 `cat /proc/config.gz(若有)` 对比，看看你这台板子上到底开了哪些 CONFIG。

## 自测

### 自测 1

<details>
<summary>CONFIG_LEDS_GPIO=y / =m / 不选，三种情况差别。</summary>

y=编进 zImage（开机就在）；m=编成模块（insmod 才有）；不选=根本没有这块代码。驱动开发用 m 迭代最快，系统定制最终可用 y 固化。

</details>

### 自测 2

<details>
<summary>menuconfig 改完 .config 后需要重新 make 吗？</summary>

要。menuconfig 只是编辑配置文件，真正按它编译是 make。所以流程：defconfig → menuconfig → make。

</details>

### 自测 3

<details>
<summary>zImage 和 dtb 是两个文件，为什么？</summary>

内核与"板子描述"分离：同一份 zImage 可以跑在不同板上，只要换配套 dtb。这也是设备树的意义——系统不写死。

</details>

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 37 章「Linux 内核移植」37.2 配置编译内核
- 内核源码 `Documentation/admin-guide/README`（内核构建权威简介）

## 小结

> 💡 **要带走的** ① .config = 功能清单，y/m/n 三态；② menuconfig 改配置到 make 的流程；③ zImage 与 dtb 分离。你已经"造出"了一个随时可以替换的心脏。下一课造根文件系统，"它要做些什么才能当一个能启动的系统"。

**有不清楚的直接问我（agent）**。编译报错通常是"缺依赖/交叉工具链没 source/磁盘空间"，把报错贴给我。

| [← 上一课](/my-blog/posts/linux驱动/0010-pinctrl-gpio-subsystem/) | [课程目录](/my-blog/posts/linux驱动/00-总览/) | [下一课 →](/my-blog/posts/linux驱动/0012-rootfs/) |
