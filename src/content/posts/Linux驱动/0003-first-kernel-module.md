---
title: 第一次 insmod：让你的代码跑进内核
published: 2026-08-17
description: Linux 驱动课程第 3 课:自己给内核写一小段代码,编成 .ko 模块装进正在跑的 Linux,看到自己打印的日志——module_init/module_exit + printk + dmesg 是驱动调试三板斧。
tags: [Linux, 嵌入式, 驱动开发, 内核模块, insmod, .ko]
category: Linux驱动
draft: false
prevTitle: 字符设备骨架：从模块到 /dev 节点
prevSlug: "linux驱动/0004-char-device-framework"
nextTitle: /proc 与 /sys 体检：看懂运行中的内核
nextSlug: "linux驱动/0002-proc-sys-health"
---

# 第一次 insmod：让你的代码跑进内核

前面都在"看"。今天你要**自己给内核写一小段代码**，编成 `.ko` 模块，装进正在跑的 Linux，看到你打印的日志。这是驱动开发的第一声心跳。

## 为什么用"模块"不把代码写进内核

驱动这块代码的迭代方式有两种：编进 zImage（要重编内核、重刷镜像），或编成模块 `.ko` `insmod` 动态加载。开发期**几乎永远用模块**：改一行 → 重编 .ko → 传板 → insmod → 看 dmesg，几分钟一轮，随时 `rmmod` 复原、不落盘。这就是路线图里"先可逆"的意思。

> 💡 **重要红线** 模块必须对准**正在运行的同一个内核**编译（版本和配置都有校验——vermagic）。你的板子跑哪个 `uname -r`，就从正点原子资料盘拿**同一份**内核源码来编。这就是 L01 让你记录版本号的原因。

## 最小模块长什么样

```c
#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/init.h>

static int __init hello_init(void) {
    printk("hello imx6ull init!\n");   /* 内核日志用 printk，不用 printf */
    return 0;
}
static void __exit hello_exit(void) {
    printk("hello imx6ull exit!\n");
}
module_init(hello_init);
module_exit(hello_exit);
MODULE_LICENSE("GPL");                 /* 不加它，内核会抱怨你的模块"污染"了它 */
```

要点：`module_init/module_exit` 注册入口/出口；`printk` 打到内核日志（`dmesg` 看），不是屏幕。

## 配套的 Makefile

```makefile
obj-m := hello.o
KDIR  := /home/lnx/linux-imx-4.1.15            # 改成你解压的正点原子内核源码路径
PWD   := $(shell pwd)

all:
	make -C $(KDIR) M=$(PWD) modules        # -C 进内核目录，借它的编译系统编我们的模块
clean:
	make -C $(KDIR) M=$(PWD) clean
```

内核源码要先配置过（`make ... imx_v7_defconfig`），模块才能借到符号表和头文件——这就是为什么它跟你板上的内核必须是同一份且有 .config。

### 练习 L03：hello.ko 上板

```bash
# ---- PC 端 ----
# 1. 前置：确认正点原子内核源码在 /home/lnx/linux-imx（L01 已记录板端 uname -r）
source /opt/fsl-imx-x11/4.1.15-2.1.0/environment-setup-cortexa7hf-neon-poky-linux-gnueabi
make ARCH=arm CROSS_COMPILE=arm-linux-gnueabihf- imx_v7_defconfig   # 仅首次
cd hello && make                       # 生成 hello.ko

# ---- 板端（SSH）----
scp hello.ko root@板IP:/home/root/
insmod hello.ko                        # 装进内核
dmesg | tail                           # 看到 "hello imx6ull init!"
cat /proc/modules | grep hello         # 模块在册
rmmod hello.ko && dmesg | tail         # 卸载，看到 exit 日志
```

1. 如果你还没有内核源码包、或编译报 `No rule to make target`，先来找我，把 `uname -a` 发我，我帮你确认该拿哪个源码、路径怎么对齐。
2. 反复 insmod/rmmod 三次，练到不看笔记也能敲完。
3. 故意在 `printk` 里写个 `"init"` 和 `"INIT"` 区分大小写，验证 "改代码 → 重编 → 传板 → 看日志" 闭环真的快。

## 自测

### 自测 1

<details><summary>insmod 之后代码立刻在运行吗？是在用户态还是内核态？</summary>立刻运行，且运行在内核态。这是模块最特别的地方：你的代码获得了内核的最高权限（能碰寄存器、缺 0 保护），所以写错很容易把系统搞挂——好在重启/rmmod 可复原。</details>

### 自测 2

<details><summary>板端内核是 5.4，你却用 4.1.15 源码编模块，结果会怎样？</summary>多半 insmod 失败，报 "Invalid module format" 或 vermagic 不符。版本/配置必须一致。这就是为什么要授权同一份源码。</details>

### 自测 3

<details><summary>rmmod 之后，/proc/modules 里还会有它吗？</summary>不会。rmmod 把模块从内核摘除，/proc/modules 随之消失。insmod/rmmod 是全生命周期。</details>

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 40 章 40.1「字符设备驱动开发基础」与 40.2「驱动程序模块加载/卸载」
- 内核文档：[Driver Basics](https://docs.kernel.org/driver-api/basics.html)（module_init 等的权威说明）
- 内核源码里 `drivers/` 任意一个子目录，找一份真实驱动的 .c 看它的头

## 小结

> 💡 **本课要带走的** ① 模块=驱动迭代的默认形态，可逆；② `module_init/exit + printk + dmesg` 是调试三板斧；③ 内核源码版本必须与板端一致。**下一课开始写真正的字符设备驱动**。

**有不清楚的直接问我（agent）**。重点：编译失败、insmod 报错，把这些错误贴给我，我带你读错误。

| [← 上一课](/my-blog/posts/linux驱动/0002-proc-sys-health/) | [课程目录](/my-blog/posts/linux驱动/00-总览/) | [下一课 →](/my-blog/posts/linux驱动/0004-char-device-framework/) |
