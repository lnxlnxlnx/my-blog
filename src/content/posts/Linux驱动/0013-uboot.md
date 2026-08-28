---
title: U-Boot
published: 2026-08-27
description: Linux 驱动系列第 13 课：U-Boot——开机第一道菜，编译 u-boot、看懂 bootcmd/bootargs 双变量、只读命令安全实践，弄清内核是怎么被加载端上来的。
tags: [Linux, 嵌入式, 驱动开发, U-Boot, bootcmd, bootargs, 启动]
category: Linux驱动
draft: false
prevTitle: 整机烧录与排障
prevSlug: "linux驱动/0014-flashing-troubleshooting"
nextTitle: 根文件系统
nextSlug: "linux驱动/0012-rootfs"
---

# U-Boot

*阶段 3 · 先编译理解·暂不烧写 · 动手约 40 分钟*

L01 你见过的"u-boot 水瓶（等任何键到 autoboot）"就是它。这一课你**编译**一份 u-boot、在串口它交互、看懂 `bootcmd/bootargs`，弄明白"内核是怎么被它五花大绑端上来的"。烧录动作往后放，这里只动脑、动命令、不动存储。

## U-Boot 的职责一句话

在 **DDR 可用之后、内核启动之前**，把内核和设备树（zImage + dtb）从介质加载到内存指定地址，再把跳转地址交给内核。中间留给你的，是一个可交互的**命令环境**。

## 编译 U-Boot（只编译，不烧）

从正点原子资料盘取 u-boot 源码，与内核一样的交叉编译姿势：

```bash
source /opt/fsl-imx-x11/4.1.15-2.1.0/environment-setup-cortexa7hf-neon-poky-linux-gnueabi
make ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf- distclean
make ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf- mx6ull_14x14_ddr512_emmc_defconfig
make -j4 ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf-
```

产物 `u-boot.bin`，还要加工头才烧（`u-boot.imx`）。这课你只要编译出来、看得懂在哪里，**不烧**。

## 两个最重要的环境变量

```
bootcmd   = 开机自动执行的命令序列，典型如:
            tftp 80800000 zImage;tftp 83000000 imx6ull-alientek-emmc.dtb;bootz 80800000 - 83000000
bootargs  = 传给内核的参数，典型:
            console=ttymxc0,115200 root=/dev/mmcblk1p2 rootwait rw
            （或 root=/dev/nfs nfsroot=IP:/path ip=... 如果你用 NFS 开发）
```

`bootz` 三个参数：zImage 地址、ramdisk("-"无)、dtb 地址。地址你已在速查表见过：zImage @ `0x80800000`，dtb @ `0x83000000`。

> ⚠️ **安全红线** 本课你在串口里只用**只读命令**（`help / printenv / mmc info / mmc list / fatls`）。`saveenv` 会把环境变量写进 eMMC/SD——**定位烧写层，L14 之前一律不 save**。临时 `setenv` 不保存，重启即还原，所以大胆试、别 save。

## 动手练习

### 练习 L13：在串口里读 u-boot，在 PC 上编 u-boot

1. L01 已有串口：重启板子，u-boot 倒计时窗口按任意键停住，进入 `U-Boot >` 提示符。
2. 依次敲（都只读）：`help`、`printenv`（找 bootcmd/bootargs）、`mmc list`、`fdinfo mmc`、`fatls mmc 1:1`（看分区1有没有 zImage 和 dtb）。把 printenv 结果记下。
3. 把 printenv 里 bootcmd 和 bootargs 逐段拆解翻译成中文（哪一步加载什么文件、什么地址、传给谁）。
4. PC 端把 u-boot 源码编一遍，找到 `u-boot.bin`，确认你明白了"编译 u-boot"这个动作。不烧。

## 自测

### 自测 1

<details>
<summary>bootcmd 和 bootargs 的分工？</summary>

bootcmd 是 u-boot 自己的动作：加载哪些文件、用什么地址、怎么启动（bootz）。bootargs 是交给内核的字符串：console/root 等。一个管"u-boot 干什么"，一个管"内核拿什么参数"。

</details>

### 自测 2

<details>
<summary>saveenv 放在什么时候用？</summary>

确认想永久改环境变量时。它会写进 eMMC/SD（持久危险）。开发期用 setenv 不 save + reboot 即可实现"尝试不落地"。

</details>

### 自测 3

<details>
<summary>为什么 zImage 和 dtb 有固定加载地址？</summary>

DDR 内存很大但布局必须约定：zImage 自解压要预留空间，dtb 放在不冲突的地址（如 0x83000000）。乱放会导致启动失败或内存被覆盖。

</details>

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 30 章「U-Boot 使用实验」、第 32 章「启动流程」、第 33 章「移植」
- u-boot 源码里 `doc/`、`configs/mx6ull_*_defconfig`（答案都在 defconfig 里）

## 小结

> 💡 **要带走的** ① u-boot 的职责 + 编译方法；② bootcmd/bootargs 双变量掌握；③ 只读命令安全实践。**你已经看懂"开机第一道菜"的菜谱了。下一课(最后)把 u-boot/kernel/rootfs 串起来做成完整的、可烧、可回退的镜像流程。**

**有不清楚的直接问我（agent）**。u-boot 就是一堆命令和变量的纪律性游戏——把 printenv 输出贴给我，我陪你逐行翻译。

| [← 上一课](/my-blog/posts/linux驱动/0012-rootfs/) | [课程目录](/my-blog/posts/linux驱动/00-总览/) | [下一课 →](/my-blog/posts/linux驱动/0014-flashing-troubleshooting/) |
