---
title: 看清启动全过程：从电源到你的 Qt 界面
published: 2026-08-15
description: Linux 驱动课程第 1 课:零风险只读,按一下电源亲眼看着芯片走完 BootROM → u-boot → 内核 → 根文件系统四段启动接力,学会抓 boot 日志、反推自家板子的真实布局。
tags: [Linux, 嵌入式, 驱动开发, 启动流程, u-boot, 设备树]
category: Linux驱动
draft: false
prevTitle: /proc 与 /sys 体检：看懂运行中的内核
prevSlug: "linux驱动/0002-proc-sys-health"
nextTitle: ""
nextSlug: ""
---

# 看清启动全过程：从电源到你的 Qt 界面

今天不写任何代码、不改任何东西。目标：按一下电源，你亲眼看着这颗芯片走完整个启动流水线，并把它每一步对应到你板子上真实的"镜像放哪、日志长什么样"。

## 启动一共是哪四棒

嵌入式 Linux 的启动不是"一个东西启动了"。它是四段程序接力：

1. **BootROM**（芯片内部固化，出厂写死）：上电先跑，做最小初始化，然后按启动拨码去存储介质里找 u-boot。
2. **u-boot**（引导程序）：初始化 DDR、串口、网卡等，把 **zImage（内核）** 和 **dtb（设备树）** 加载进内存，跳转执行内核。
3. **Linux 内核**：打印启动日志，根据 dtb 认硬件、匹配驱动，最后挂载 **根文件系统** 并启动 init 进程。
4. **根文件系统里的用户态**：init → 各种服务 → 你的 Qt/systemui。之后的"整个世界"都在这一层。

记住这句话：**前三棒负责"把系统激活"，第四棒负责"活成什么样"。**

## 它们在存储介质里的典型布局

以最常见的 SD/eMMC 布局为例（你的板子可能略有不同，练习里要自己求证）：

| 位置 | 内容 | 由谁读取 |
|------|------|------|
| 最前部（如偏移 1KB 处） | u-boot.imx（带 IVT 头的 u-boot） | BootROM |
| 一个可读分区（FAT/ext4） | zImage + dtb | u-boot（按 bootcmd 加载） |
| 挂载为 / 的分区（ext4） | 根文件系统 | 内核（按 bootargs 里 root= 挂载） |

u-boot 传给内核的启动参数叫 **bootargs**（也叫 cmdline）。它变成内核里的 `/proc/cmdline`。这是全流程串起来的"胶水"。详见术语表（`docs/reference/glossary.html`）。

## 抓一份真实的 boot 日志

你要做的第一步永远是**记录现场**。接上串口线，开串口终端，复位板子：

```bash
# 1. 先确认串口设备名（插拔后有新行出现的就是）
dmesg | tail -20                 # 找 ttyUSB0 / ttyACM0

# 2. 打开串口终端，115200 波特率（screen 最轻量）
screen /dev/ttyUSB0 115200

# 3. 拨/按复位，或断电重上电 —— 你会看到满屏日志开始滚动
#    建议同时用 script 存一份：
script -c "screen /dev/ttyACM0 115200" ~/boot1.log
```

### 练习 L01-A：在日志里找到四段接力棒

把日志里出现以下"特征行"的位置找出来，标出它们各自属于哪一段：

1. `U-Boot 20xx.xx-...` 或 `Hit any key to stop autoboot` → u-boot 段
2. `Starting kernel ...`、`Linux version 4.1.15-...` → 内核段
3. `VFS: Mounted root (ext4) filesystem` 或 `mount_root` → 挂载根文件系统
4. 出现登录提示符或 shell/systemui 字样 → 用户态起来了

小技巧：`Ctrl-A` `然后 k` 退出 screen。日志长的话可以先 `Ctrl-A` `[` 进入翻页模式。

## 从运行中的系统反推布局

光看启动日志还不够——你要证明"我知道它从哪读的"。上板（SSH 或串口 shell）跑下面这些只读命令，和**你自己的板子**对答案：

```bash
uname -a                                # 内核版本，记下来！
cat /proc/cmdline                       # = u-boot 传给内核的 bootargs
cat /proc/partitions                    # 看 SD/eMMC 分了几个区，各多大
mount | grep -E 'mmcblk|root'           # 根文件系统挂在哪个设备
ls /sys/class/block/                    # 块设备都有哪些
```

### 练习 L01-B：反推你板子的真实布局

1. 把 `/proc/cmdline` 逐项拆开：`console=`、`root=`、`rootfstype=` 都在说什么？
2. 根据 `/proc/partitions` 和 `mount` 结果，画出你这块板子 eMMC/SD 的布局草图（u-boot 大致、内核分区、rootfs 分区）——和上面表格比一比
3. 把**内核版本**写进 `linux-learning/NOTES.md` 的环境速查里。← 重要：Phase 0/1 编译模块必须对准这个版本

## 自测

### 自测 1

<details><summary>启动时内核和 u-boot，谁先启动？</summary>BootROM → u-boot → 内核 → rootfs。u-boot 负责把内核加载进内存，内核不是"自带"在芯片里的。芯片出厂只有 BootROM。</details>

### 自测 2

<details><summary>设备树 dtb 是被谁读进内存、传给谁的？</summary>u-boot 把 dtb（和 zImage）加载进内存，跳转时把 dtb 地址传给内核。内核靠它才知道"这块板子上接了哪些硬件"。</details>

### 自测 3

<details><summary>如果你改了一个驱动的逻辑，最可能要重编译的是哪个东西？</summary>驱动编译成内核模块(.ko)或编进内核(zImage)。注意：**不需要**动 u-boot，也通常不动 rootfs——这理解对了，后面的路就顺了。</details>

## 推荐阅读

- 你手上的《I.MX6U 驱动开发指南 V1.81》第三章「系统烧写 / 开发环境」，对照你自己板子的烧录方式。
- 本工作区：学习路线图（`docs/reference/roadmap.html`）· 术语表（`docs/reference/glossary.html`）
- Linux 官方：[内核管理文档](https://www.kernel.org/doc/html/latest/admin-guide/)（/proc、/sys 的官方说明）

## 小结

> 💡 **本课要带走的** ① 启动是四段接力；② 每段对应"镜像在哪、由谁读"；③ 你对自家板子的布局和内核版本有了**书面证据**。下一课我们从 `/proc` 和 `/sys` 继续给系统做体检。

**有不清楚的直接问我（agent）**——我就是你的老师，任何概念、任何命令，可以当场追到底。做练习时卡在哪一步，贴给我看。

| — | [课程目录](/my-blog/posts/linux驱动/00-总览/) | [下一课 →](/my-blog/posts/linux驱动/0002-proc-sys-health/) |
