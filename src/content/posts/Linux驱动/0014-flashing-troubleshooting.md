---
title: 整机烧录与排障
published: 2026-08-28
description: Linux 驱动系列第 14 课（完结）：整机烧录与排障——三条安全铁律（备份/SD 试玩/不 save）、四种镜像到三段介质、TFTP/SD/MFG 三种烧录法、按证据链逐段排障。
tags: [Linux, 嵌入式, 驱动开发, 烧录, 排障, eMMC, SD, 备份]
category: Linux驱动
draft: false
prevTitle: ""
prevSlug: ""
nextTitle: U-Boot
nextSlug: "linux驱动/0013-uboot"
---

# 整机烧录与排障

*阶段 3 · 全课最高风险区 · 动手约 60 分钟*

这是你唯一一块板，前面都做了铺垫。现在是**烧录**课——持久写入 eMMC/SD，弄坏可能救不回来。所以这一课先教你怎么"不弄坏"，再教怎么烧怎么写，最后教**如果坏了怎么诊断**。

## 三条铁律（先立规矩再动手）

1. **先做整盘备份**：万一烧坏能回退。用 `dd` 把整块 eMMC/SD 镜像拷到 PC（`sudo dd if=/dev/mmcblk1 of=backup.img bs=4M`）。备份是"后悔药"，先备再做。
2. **优先用 SD 卡当"试验场"**：开发期所有新 u-boot/zImage/dt/rootfs，先写进一张 SD 卡，让板子**从 SD 启动**（不影响 eMMC 出厂系统）。玩坏了拔卡就回到出厂。
3. **调整 bootargs 用 setenv 不 save**：跑歪了重启即还原。

## 要烧哪些东西：一张总表

| 镜像 | 来源（你已会编/会找） | 写到介质哪一段 |
|------|------|------|
| u-boot.imx | L13 编译产物 | eMMC/SD 起始偏移 1KB 处 |
| zImage | L11 编译产物 | boot 分区（分区1，FAT） |
| imx6ull-alientek-emmc.dtb | L11 编译产物 | 同一 boot 分区（分区1） |
| rootfs | L12 构建产物 | 根分区（分区2，ext4） |

三种典型烧录法（分别对应开发期/批量/裸机救砖）：

- **TFTP/NFS 起网启动**（开发期最安全）：u-boot 下 `tftp 80800000 zImage;...`，rootfs 用 NFS。不改任何存储，跑的是"内存里的系统"。
- **SD 卡 dd 写入**（易控制）：把镜像按分区表 dd 到 SD。
- **MFG 烧录工具**（正点原子出厂版）：USB 连 PC，软件自动烧全镜像，最"官方"但覆盖面大，出问题要重刷。

## 动手练习

### 练习 L14：一次有退路的完整系统烧录演练

1. **备份**(必须先做)：`sudo dd if=/dev/mmcblk1 of=~/backup-emmc.img bs=4M`，确认文件大小>0 且校验 OK（`ls -l`）。备份放 PC。
2. **准备 SD 试玩卡**：拿一张 SD，把出厂你的 u-boot.imx/zImage/dtb/rootfs 用分区分文件的方式布置（做法参考指南 39.2，或用正点原子的打包工具）。
3. **从 SD 启动**：拨码切 SD 启动，`printenv` 确认在用新镜像。玩坏就拔卡回出厂。
4. **最后（可选、且保证备份后）**用 MFG 或 dd 把整套镜像写进 eMMC，重启验证是"你自己的内核+你自己的驱动"。

## 排障套路：看图找病

```
现象             可能原因                      取证
u-boot 都没出来     启动介质/u-boot 没烧对/坏     串口有无任何输出
u-boot出来内核没起   内核/dtb 加载地址错、镜像损坏  u-boot 打印+fatls 确认文件
内核起一半挂了       bootargs 的 root= 错、dtb不匹配  内核日志最后几行+dmesg提前
Freeze在挂载rootfs   rootfs 分区不存在/格式不对     /proc/cmdline 对比实际
起来但没驱动         设备树不匹配/CONFIG没编        /proc/modules + dmesg | grep
```

核心心法：**每次只改一个变量**，用 `dmesg` 和串口日志当"证据链"逐段定位，别乱试。

## 自测

### 自测 1

<details>
<summary>为什么单板开发要先做整盘 dd 备份？</summary>

烧录是持久操作，一次失误可能救不回。dd 备份把 eMMC/SD 原样存入 PC，等于买保险：烧坏就能整盘回写恢复。没备份别碰烧录。

</details>

### 自测 2

<details>
<summary>开发期临时改 bootargs 为什么不 saveenv？</summary>

saveenv 会把改动持久写入 eMMC/SD。不 save 时 setenv 只改 DRAM 里的环境变量，重启即恢复出厂，风险降到最低。

</details>

### 自测 3

<details>
<summary>内核只跑到一半，最后该看什么？</summary>

先看 u-boot 打印（文件加载/启动地址），再看内核最后几行日志(死在哪一步)，结合 /proc/cmdline（实际上 bootargs 改没改到）。按"加载→传参→挂载→起驱动"逐段。一次只改一个变量。

</details>

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 39 章「系统烧写」—— 三种方法的详细操作
- 第 37 章末尾（内核启动失败常见排查）与附录（`bootargs` 常见例子）

## 小结

> 💡 **要带走的** ① 三条安全铁律(备份/SD试玩/不save)；② 四种镜像→三段介质；③ 排障按"证据链"逐段定位。**到这里，你完成了从"会用板"到"能拆装系统、会写驱动、能排障"的全链闭环。恭喜——你已经是合格的嵌入式 Linux 开发工了。**接下来按 Phase 4 综合质检，回头把 L04-L10 的驱动在你自制的系统里全部跑通。

**烧录成功了/失败了，都回来找我汇报**——这课的全流程我陪你过，特别是需要判断"是不是该动 MFG"的时候，别自己硬来。

| [← 上一课](/my-blog/posts/linux驱动/0013-uboot/) | [课程目录](/my-blog/posts/linux驱动/00-总览/) |  |
