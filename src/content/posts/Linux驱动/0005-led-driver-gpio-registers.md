---
title: LED 驱动：第一次亲手写寄存器
published: 2026-08-19
description: Linux 驱动课程第 5 课:把字符设备骨架接上 GPIO 物理寄存器,让 echo 1 > /dev/led 点亮板上红灯——ioremap + readl/writel 访问寄存器、GPIO 四步配置、读-改-写技巧。
tags: [Linux, 嵌入式, 驱动开发, GPIO, 寄存器, ioremap, LED]
category: Linux驱动
draft: false
prevTitle: GPIO 中断与按键：别傻等，让内核来叫你
prevSlug: "linux驱动/0006-interrupt-button"
nextTitle: 字符设备骨架：从模块到 /dev 节点
nextSlug: "linux驱动/0004-char-device-framework"
---

# LED 驱动：第一次亲手写寄存器

你的起点是"**看得懂寄存器代码但没亲手写过**"。这一课就是那个"亲手"——把字符设备骨架接上 GPIO 物理寄存器，让 `echo 1 > /dev/led` 点亮板上红灯。Register 不再是天书。

## 为什么驱动能"改寄存器"：ioremap

CPU 有两条路碰外设：一是指令直接访问（内存映射 IO），二是专用指令（x86 的 IN/OUT）。i.MX6ULL 用第一种：控制器的每个寄存器都有一个**物理地址**。但 Linux 跑在有 MMU 的保护模式下，应用态/内核也不能随便访问物理地址——要先用 `ioremap` 把物理地址"映射"成内核能用的虚拟地址，再用 `readl/writel` 读写：

```c
#define CCM_CCGR1           0x020C406C   /* GPIO1 时钟开关 */
#define SW_MUX_GPIO1_IO03   0x020E0068   /* GPIO1_IO03 复用功能 */
#define SW_PAD_GPIO1_IO03   0x020E02F4   /* 电气属性 */
#define GPIO1_DR            0x0209C000   /* 数据寄存器 */
#define GPIO1_GDIR          0x0209C004   /* 方向寄存器 */

void __iomem *mux, *pad, *ccgr1, *dr, *gdir;

ccgr1 = ioremap(CCM_CCGR1, 4);
mux   = ioremap(SW_MUX_GPIO1_IO03, 4);
pad   = ioremap(SW_PAD_GPIO1_IO03, 4);
dr    = ioremap(GPIO1_DR, 4);
gdir  = ioremap(GPIO1_GDIR, 4);
```

## 点亮 LED 的四步（你现在要亲手完成）

1. **开时钟**：`CCM_CCGR1` 的 bit27:26 = 11 → 使能 GPIO1 时钟。（裸机课件钟必须，内核驱动里通常由时钟框架搞定；本课为讲寄存器全部手写）
2. **选功能**：`SW_MUX_GPIO1_IO03` 的 MUX_MODE = 5（GPIO 功能，即 ALT5）。
3. **配引脚**：`SW_PAD_GPIO1_IO03` 写 `0x10B0`（上拉、速度、驱动能力）。
4. **方向+电平**：`GDIR` bit3=1 输出；往 `DR` bit3 写 0 → 灯亮（低电平点亮）；写 1 → 灯灭。

```c
writel(readl(ccgr1) | (3 << 26), ccgr1);      /* 开 GPIO1 时钟 */
writel(5, mux);                                /* GPIO1_IO03 → GPIO 功能 */
writel(0x10B0, pad);                           /* 电气属性 */
writel(readl(gdir) | (1 << 3), gdir);          /* bit3 输出 */
writel(readl(dr) | (1 << 3), dr);              /* 先灭灯 */

/* open 时点亮（低有效） */
writel(readl(dr) & ~(1 << 3), dr);   /* 写 0 → LED 亮 */

/* release 时熄灭 */
writel(readl(dr) | (1 << 3), dr);    /* 写 1 → LED 灭 */
```

> 💡 **读-改-写技巧** 操作单个 bit 不能直接整字写，要"先读回来、改那一位、再写回去"——否则会把别的 bit 状态冲掉。上面 `readl(...) | 位` 就是标准读改写（RMW）。

## 对接字符设备

把 L04 骨头的 read/write 换成"点灯/灭灯"语义即可。最简单做法：`write` 从用户读一个字节，0=灭、非0=亮。这样应用侧 `echo 1 > /dev/led` 就能点灯。完整示例对照《指南》第 41 章 led 工程。

### 练习 L05：echo 1 > /dev/led 点灯

1. 写 `myled.c`：L04 骨架 + 上方四步寄存器初始化 + write 控制灯。Makefile 照抄 L03。
2. 交叉编译 → `scp myled.ko` 上板 → `mknod /dev/led c 主号 0` → `insmod myled.ko`。
3. `echo 1 > /dev/led` 灯亮；`echo 0 > /dev/led` 灯灭。成功了就是**你第一次从"看"变成"写"寄存器**。
4. 改一下：把"低有效"和"高有效"互换（把亮/灭的位操作反过来），肉眼验证方向性理解正确。
5. **做完这道，去对照《指南》41 章和《参考手册》8.1 节**：把你写的每行寄存器配置都找到出处。

## 自测

### 自测 1

<details><summary>为什么要 ioremap？直接写 0x0209C000 不行吗？</summary>Linux 保护模式下，物理地址不对应能直接访问的虚拟地址。ioremap 把物理地址映射进内核虚拟空间，之后才用 readl/writel 通过虚拟地址访问。裸机上没 MMU 可以直接写，Linux 上不行。</details>

### 自测 2

<details><summary>GPIO1_IO03 是哪个寄存器的第几位？</summary>GPIO1 的所有寄存器，bit3。DR/PSR/GDIR 这些一律"对应引脚号"定位。所以引脚号就是位号。</details>

### 自测 3

<details><summary>"低电平亮"意味着写 0 亮、写 1 灭。这句话对不对？</summary>对。LED 电路决定：IO 输出低电平时流过 LED 的电流路径才通。驱动写的是"电平"，亮灭是电路翻译出来的。板子特性必须查原理图或文档。</details>

## 推荐阅读

- 《I.MX6U 驱动开发指南 V1.81》第 8 章"i.m6ull GPIO 详解"、第 41 章 led 驱动例程、第 42 章（用 class_create 自动建节点）
- I.MX6ULL 参考手册 GPIO 章节（寄存器位定义）
- 本工作区 IMX6ULL 速查表（`docs/reference/imx6ull-cheatsheet.html`）

## 小结

> 💡 **本课要带走的** ① ioremap + readl/writel 访问寄存器；② GPIO 四步配置；③ 读-改-写别冲掉别的位。**这是你"寄存器"从看懂到写会的一课。**下一课往 GPIO 上接中断，做按键。

**有不清楚的直接问我（agent）**。寄存器这课值得多磨几遍——它打通了"数据手册 ↔ 代码 ↔ 实物"三者的对应，是后面所有驱动的地基。

| [← 上一课](/my-blog/posts/linux驱动/0004-char-device-framework/) | [课程目录](/my-blog/posts/linux驱动/00-总览/) | [下一课 →](/my-blog/posts/linux驱动/0006-interrupt-button/) |