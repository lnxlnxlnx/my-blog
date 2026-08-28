---
title: 字符设备骨架：从模块到 /dev 节点
published: 2026-08-18
description: Linux 驱动课程第 4 课:让模块变成一个可以 open/read/write 的设备——设备号 + file_operations + /dev 节点三件套,以及 copy_to_user/copy_from_user 跨空间搬运的规矩。
tags: [Linux, 嵌入式, 驱动开发, 字符设备, 设备号, file_operations]
category: Linux驱动
draft: false
prevTitle: LED 驱动：第一次亲手写寄存器
prevSlug: "linux驱动/0005-led-driver-gpio-registers"
nextTitle: 第一次 insmod：让你的代码跑进内核
nextSlug: "linux驱动/0003-first-kernel-module"
---

# 字符设备骨架：从模块到 /dev 节点

上一课的模块只会 printk。这一课你让它成为一个**可以 open/read/write 的设备**——应用能打开 `/dev` 下的节点，跟你的驱动"说话"。这是"驱动-应用接口"的雏形，后面所有驱动都长在这副骨架上。

## 字符设备的三个核心概念

1. **设备号**：驱动在系统里的"身份证号"。`major` 主设备号分工种，`minor` 次设备号分具体实例。用 `register_chrdev` 注册。查 /proc/devices 能看到你注册的主号。
2. **file_operations**：一张"操作表"。应用 open/read/write/ioctl 设备节点时，内核会调用这张表里对应的函数。你填哪几个，驱动就有哪几个能力。
3. **/dev 节点**：应用看到的"文件"。`mknod` 帮你把设备号变成一个文件，或让驱动自动创建（`class_create + device_create`，后面常用）。

```c
/* 字符设备驱动骨架 —— 对应指南 40 章 chrdevbase 例程 */
#include <linux/module.h>
#include <linux/fs.h>
#include <linux/uaccess.h>

#define DEV_MAJOR 200          /* 主设备号 */
#define DEV_NAME  "chrdevbase"

/* 1. 应用调用 open("/dev/chrdevbase") 时，内核调用它 */
static int chrdevbase_open(struct inode *inode, struct file *filp) {
    printk("chrdevbase open!\n");
    return 0;
}

/* 2. 应用调用 read() 时，内核调用它：把内核数据拷贝给用户 */
static ssize_t chrdevbase_read(struct file *filp, char __user *buf,
                               size_t size, loff_t *off) {
    char data[] = "hello driver\n";
    copy_to_user(buf, data, sizeof(data));   /* 用户空间指针要专用 copy_* */
    return sizeof(data);
}

/* 3. 应用调用 write() 时，内核调用它：把用户数据取进来 */
static ssize_t chrdevbase_write(struct file *filp, const char __user *buf,
                                size_t size, loff_t *off) {
    char tmp[100];
    copy_from_user(tmp, buf, size);          /* 注意越界保护 */
    printk("get from user: %s\n", tmp);
    return size;
}

/* 目录：操作表 */
static const struct file_operations chrdevbase_fops = {
    .owner = THIS_MODULE,
    .open  = chrdevbase_open,
    .read  = chrdevbase_read,
    .write = chrdevbase_write,
};

static int __init chrdevbase_init(void) {
    register_chrdev(DEV_MAJOR, DEV_NAME, &chrdevbase_fops);  /* 注册设备号+操作表 */
    printk("chrdevbase init!\n");
    return 0;
}
static void __exit chrdevbase_exit(void) {
    unregister_chrdev(DEV_MAJOR, DEV_NAME);
    printk("chrdevbase exit!\n");
}
module_init(chrdevbase_init);
module_exit(chrdevbase_exit);
MODULE_LICENSE("GPL");
```

> 💡 **重点** 用户在用户态，你在内核态。所以 `buf` 这个指针不能直接解引用——必须用 `copy_to_user / copy_from_user` 跨边界搬运。这是新手驱动最常见 bug 之一。

## 应用侧怎么测

```c
/* app.c —— 交叉编译后在板上运行 */
#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>
int main(void) {
    char buf[64];
    int fd = open("/dev/chrdevbase", O_RDWR);
    read(fd, buf, sizeof(buf));      /* 读到驱动发来的 "hello driver" */
    write(fd, "hi kernel", 9);       /* 驱动里 printk 打出来 */
    close(fd);
    return 0;
}
```

### 练习 L04：把字符设备骨架跑起来

1. 基于上面骨架写一个 `mychrdev.c` + Makefile（抄 L03 的 `obj-m` 模板，加 `file_operations`）。
2. 加载前，先手动建节点：`mknod /dev/chrdevbase c 200 0`（c=字符设备）。
3. `insmod mychrdev.ko` → 应用测试：open 时内核打印 "chrdevbase open!"。
4. 把 read 的返回值改小一点（比如只发 5 个字节），看应用端 buffer 读到多少，理解 read 返回值就是"真正给用户的数据长度"。
5. 故意不建设备节点就 open，体会"没有节点就访问不到设备"。

## 自测

### 自测 1

<details><summary>mknod 需要知道哪两个值？</summary>类型（c/b）+ 主次设备号。类型 c 是字符，b 是块。mknod /dev/名字 c 主号 次号。设备节点本质就是"设备号的门牌"。</details>

### 自测 2

<details><summary>为什么驱动里 copy_to_user 而不是直接 *buf = xxx？</summary>用户空间和内核空间地址空间不同，直接解引用会缺页/崩溃/安全问题。copy_to_user 做跨空间拷贝和权限校验。这是字符驱动必背的一条。</details>

### 自测 3

<details><summary>file_operations 里没填 .read，应用 read() 会怎样？</summary>read 返回 -EINVAL（不支持）。操作的"能力"取决于你填了哪几项。这也是驱动最小化的思路：不需要的能力就不实现。</details>

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 40 章「字符设备驱动开发」40.3 基本步骤 + 40.4 chrdevbase 运行测试
- 本工作区 IMX6ULL 速查表（`docs/reference/imx6ull-cheatsheet.html`）· 术语表（`docs/reference/glossary.html`）

## 小结

> 💡 **本课要带走的** ① 设备号 + file_operations + /dev 节点三件套；② copy_to/from_user 的规矩；③ 一个能收发数据的字符设备。下一课把 read/write 接上**真实的 GPIO 寄存器**，让它真的点亮 LED。

**有不清楚的直接问我（agent）**。卡在哪一步就贴给我——尤其是 mknod、open 返回 EACCES / No such device 这类。

| [← 上一课](/my-blog/posts/linux驱动/0003-first-kernel-module/) | [课程目录](/my-blog/posts/linux驱动/00-总览/) | [下一课 →](/my-blog/posts/linux驱动/0005-led-driver-gpio-registers/) |