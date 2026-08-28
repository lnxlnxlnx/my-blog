---
title: /proc 与 /sys 体检：看懂运行中的内核
published: 2026-08-16
description: Linux 驱动课程第 2 课:零风险只读,靠几个只读命令就能说出"当前有哪些设备、背后是哪个驱动、注册成了什么号",学会读 /proc 与 /sys 两本"体检报告"。
tags: [Linux, 嵌入式, 驱动开发, /proc, /sys, sysfs]
category: Linux驱动
draft: false
prevTitle: 第一次 insmod：让你的代码跑进内核
prevSlug: "linux驱动/0003-first-kernel-module"
nextTitle: 看清启动全过程：从电源到你的 Qt 界面
nextSlug: "linux驱动/0001-boot-pipeline"
---

# /proc 与 /sys 体检：看懂运行中的内核

上一课看清了**启动时**的系统。这一课看**运行中**的系统：只靠几个只读命令，就能说出"当前有哪些设备、背后是哪个驱动、它注册成了什么号"。

## 两个假文件系统，两本"体检报告"

Linux 把内核内部状态以**文件**的形式暴露给你，你可以用 `cat`/`ls` 随便读，就像翻开报告：

- `/proc` 面向**进程和内核状态**：`/proc/interrupts` 中断统计、`/proc/modules` 已加载模块、`/proc/devices` 注册到系统的设备号、`/proc/cmdline` 启动参数。
- `/sys` 面向**设备和驱动**（sysfs）：它是设备驱动模型在用户态的一面镜子。每个设备、每个驱动、每根总线都在里面有对应的目录。

> 💡 **一句话** `/proc` 是"内核说了什么"；`/sys` 是"驱动和设备长什么样"。写驱动时你盯着 `/sys` 的时间会长得多。

## 驱动是怎么"挂"上去的：/sys 的三角色

在内核的视图里，硬件世界由三类东西组成，sysfs 里各有专门目录：

| 角色 | 目录 | 例子 |
|------|------|------|
| 设备（它真实存在） | `/sys/devices/...` | LED 设备 |
| 驱动（代码，负责控制某类设备） | `/sys/bus/platform/drivers/...` | `led` 驱动目录 |
| 总线（把驱动和设备"配对"） | `/sys/bus/` | `platform` 总线 |

驱动和设备通过总线"对上眼"的过程，就是内核日常发生的一件事。你现在不写驱动，但已经能**观察**到它。

### 练习 L02-A：从 /proc 读内核的"人口统计"

```bash
cat /proc/devices            # 主设备号分配表：Character devices 那半
cat /proc/modules            # 当前加载了哪些内核模块
cat /proc/interrupts         # 中断统计（CTRL+C 退出，打断着呢）
```

1. 在 `/proc/devices` 里找到串口（tty）、rtc、或者 i2c 等，记下它们的主设备号。
2. 对照启动日志：这些设备的驱动是**编进内核**还是**模块加载**？(编进内核的不会出现在 `/proc/modules`)
3. 如果板子有网络，`cat /proc/interrupts | head` 看网卡中断。

### 练习 L02-B：把"一个真实设备"追到它的驱动

以你的**网卡**或**串口**为例（选一个你确定板子上有的）：

```bash
ls /sys/class/net/                # 网卡：看接口名(如 eth0)
ls -l /sys/class/net/eth0/device/driver   # 读到 -> 那个驱动目录就是它背后驱动
readlink /sys/class/net/eth0/device/driver
cat /sys/class/net/eth0/address   # MAC 地址
ls /sys/class/tty/ | head # 串口节点
```

1. 沿着 `device/driver` 这个软链接，读出"这块网卡由哪个驱动管理"。
2. 再 `ls /sys/bus/platform/drivers/ | grep -i eth`，找到那个驱动自己的目录——它俩指向同一个驱动。
3. 技能点：以后你的驱动也走 `platform` 总线，会在这些目录里"活"起来。

## 自测

### 自测 1

<details><summary>驱动是编进内核的，会在 /proc/modules 里看到它吗？</summary>不会。编进内核的驱动开机就在，只有加载成 .ko 模块的才会出现在 /proc/modules。这也是判断"某驱动是模块还是内置"的方法。</details>

### 自测 2

<details><summary>/sys/class/net/eth0/device/driver 这个软链接说明了什么？</summary>说明 eth0 这个设备"被"某个驱动管理：软链接指向驱动目录 = 设备已经绑定驱动。链路是 总线(platform/其他) ↔ 设备 ↔ 驱动。</details>

### 自测 3

<details><summary>主设备号是干什么的？</summary>它标识"这一大类设备由哪个驱动处理"。应用 open("/dev/xxx") 时，内核按主设备号找到对应驱动，再按次设备号区分具体实例。/proc/devices 就是这本"号册"。</details>

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 40 章开头（字符设备驱动的基础概念，和 /proc/devices 对应）
- 本工作区：术语表（`docs/reference/glossary.html`）· 路线图（`docs/reference/roadmap.html`）
- 内核文档：[Documentation/filesystems/sysfs.rst](https://www.kernel.org/doc/html/latest/filesystems/sysfs.html)（sysfs 设计准则）

## 小结

> 💡 **本课要带走的** ① /proc 读"状态"，/sys 读"设备-驱动"关系；② 你能追出任何一个设备的驱动；③ "软链接 = 绑定"这个观察法。下一课让驱动第一次**真正跑在你手上写的代码里**。

**有不清楚的直接问我（agent）**——任何概念、任何命令，可以当场追到底。

| [← 上一课](/my-blog/posts/linux驱动/0001-boot-pipeline/) | [课程目录](/my-blog/posts/linux驱动/00-总览/) | [下一课 →](/my-blog/posts/linux驱动/0003-first-kernel-module/) |
