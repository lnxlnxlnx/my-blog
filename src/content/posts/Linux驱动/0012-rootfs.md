---
title: 根文件系统
published: 2026-08-26
description: Linux 驱动系列第 12 课：根文件系统——目录骨架 + 程序 + 启动脚本、init 的 busybox/systemd 两种风格、NFS 根文件系统迭代法、往 rootfs 里塞应用和驱动。
tags: [Linux, 嵌入式, 驱动开发, rootfs, 根文件系统, NFS, init]
category: Linux驱动
draft: false
prevTitle: U-Boot
prevSlug: "linux驱动/0013-uboot"
nextTitle: 编译内核与设备树
nextSlug: "linux驱动/0011-build-kernel"
---

# 根文件系统

*阶段 3 · 动手约 40 分钟*

L01 里"第四棒"就是它。内核启动最后一步是挂载 `/`、启动 init 进程。那个 `/` 上的目录树、/bin 里的命令、开机后启动哪些服务，全由根文件系统说了算。这课把它拆开看，并学会**往里面加你自己的应用和驱动**。

## 一个根文件系统 = 目录骨架 + 程序 + 启动脚本

```
/          挂载点，bootargs 里 root= 指定
/bin init /sbin...  基本命令(busybox)
/etc        配置文件、初始化脚本(rcS/inittab)
/dev       设备节点(udev 或静态)
/lib       运行库(C库、Qt 库)
/usr /opt   应用、你的 Qt 程序
/proc /sys 内核虚拟文件系统(启动时挂载)
/home/root 用户主目录
```

你不必从零手搓——正点原子资料盘有做好的 rootfs（busybox / buildroot / yocto，你的板就是 Yocto 味道）。你要学的是**看结构、改内容、加东西**。

## 启动 init 的两种风格

- **busybox 风格**（轻量，无 systemd）：`/etc/inittab` + `/etc/init.d/rcS` 脚本，顺序执行启动项。适合小系统教学。
- **systemd 风格**（现代发行版/部分 Yocto）：unit 文件，并行管理。你的板可能是它。

无论哪种，加开机自启的思路相同：写一个启动脚本，把它挂进系统初始化链条，脚本里 insmod 模块/启动应用。

## 把"应用+驱动"塞进去（核心技能）

```bash
# 以挂载/拷贝的方式，在 PC 端操作 rootfs 目录
# 把你的驱动模块、编译好的应用拷进 rootfs
cp myled.ko  rootfs/lib/modules/4.1.15/
cp myapp     rootfs/usr/bin/

# 开机脚本：加两行
cat > rootfs/etc/init.d/S99myapp <<'EOF'
#!/bin/sh
insmod /lib/modules/4.1.15/myled.ko
/usr/bin/myapp &
EOF
chmod +x rootfs/etc/init.d/S99myapp
```

## 两种最常用的接入方式

1. **NFS 根文件系统**（开发期）：PC 上做一个 rootfs 目录，板子经网络把它当 `/` 挂载。改 PC 文件即生效，无需烧录——极适合迭代。`root=/dev/nfs ... nfsroot=IP:/path`。
2. **烧进 eMMC/SD**（最终交付）：用工具写入镜像。危险区，放 L14 讲。

## 动手练习

### 练习 L12：给你的 rootfs 加进 LED 驱动 + 开机自启

1. 第一件事：确认你的板根文件系统是哪类（`ls /etc/inittab /etc/init.d 检查`；`ps -p 1 -o comm` 看 init 进程是 busybox 还是 systemd）。
2. **实验用 NFS 方式**（若你有网络开发环境）：按指南 38 章做 rootfs，配好 NFS，板子 `root=/dev/nfs` 挂载（这是开发期不碰板子的最佳法，L14 之前都用它）。
3. 把你在 L05/L09 编译好的 myled.ko、还有板上的 Qt 程序（如 systemui）放进 rootfs，改初始化脚本让它们开机自启。
4. 重启板子，确认"开机即跑你的驱动+应用"。这比手输命令"高端"得多。

## 自测

### 自测 1

<details>
<summary>内核挂载根文件系统的信息在 Bootargs 里哪一段？</summary>

root= 指定根设备(/dev/mmcblk1p2 或 /dev/nfs)，rootfstype= 指定格式。内核启动到那里就去找这个设备挂载 /。

</details>

### 自测 2

<details>
<summary>为什么 init(/etc/inittab 或 systemd) 那么重要？</summary>

它是内核启动后用户态第一个进程（PID1），负责拉起整个用户世界：挂载/init.d 里的服务、起 shell、跑你的应用。它死了整个系统崩。

</details>

### 自测 3

<details>
<summary>开发期用 NFS rootfs 的好处是什么？</summary>

改 PC 上 rootfs 目录立即生效，不必反复烧录，迭代快且不碰板子存储（安全）。交付时才把最终 rootfs 刻进 eMMC/SD。

</details>

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 38 章「根文件系统构建」、附录 A1/A2(buildroot/Yocto)
- busybox 官方 `init.d` 文件章节目录
- 你板子实际根文件系统的资料（正点原子 Yocto 文档）

## 小结

> 💡 **要带走的** ① rootfs = 目录骨架 + 程序 + 启动脚本；② init(1) 是用户态总指挥；③ 开发期 NFS 根文件系统是"不烧板"的利器。**你已经能"定制系统内容"了。下一课补上最前面那两棒之一：u-boot。**

**有不清楚的直接问我（agent）**。rootfs 主要是"目录 + 脚本"的组合拳，术语少、细节多——把脚本报错、insmod 失败信息贴给我。

| [← 上一课](/my-blog/posts/linux驱动/0011-build-kernel/) | [课程目录](/my-blog/posts/linux驱动/00-总览/) | [下一课 →](/my-blog/posts/linux驱动/0013-uboot/) |
