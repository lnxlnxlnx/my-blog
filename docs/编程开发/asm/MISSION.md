# Mission: 掌握 IMX6ULL 裸机 ARM 汇编（为驱动课补"寄存器地基"）

## Why

Linux 驱动课的 L05 要求你"亲手写寄存器"，但你的起点是"看得懂寄存器、没亲手写过"。寄存器操作在裸机上最早是用汇编直接表达的。汇编课让你把"GPIO 四步走"用汇编亲手写一遍，建立"代码 ↔ 寄存器 ↔ 数据手册"的肌肉记忆；同时为看懂 u-boot/kernel 的 start.S、将来做 fork 移植打底。

## Success looks like

- 用交叉工具链三连（gcc/ld/objcopy）把一段 `.s` 编成能烧进 SD 卡的 `.bin`，并理解链接地址含义
- 用汇编写出"点灯四步"：开时钟 → 复用 GPIO → 配电气属性 → 方向/电平
- 说得清 r0-r15 / sp / lr / pc / cpsr 各管什么，能判断当前处理器模式
- 会用 mov/ldr/str/add/sub/and/orr + cmp + b/bl/bx 写延时循环和按键轮询
- 看得懂 start.S（关看门狗、设 sp、bl main）这类裸机入口代码
- 能把汇编/C 混合的裸机工程编译、烧录到 SD（走 imxdownload，不动 eMMC）

## Constraints

- 只有一块板：汇编阶段烧录**只走 SD 卡**（启动拨码切 SD），绝不写 eMMC；SD 镜像先备份
- 工具链：`arm-linux-gnueabihf-`（fsl-imx-x11 SDK 内已含）；指南第 6/7/8/9/10/15 章为主线
- 动手为主：每课一条能编译/反汇编验证的汇编片段，能上板才上板
- 与 `../linux` 驱动课互认术语（寄存器表参考 Linux 课的速查表）

## Out of scope

- 完整 ARM 指令集百科全书、Thumb/Thumb2、NEON
- 中断/异常处理深水区（驱动课的 L06 用 Linux 中断讲）
- 复杂移植、DDR3/RGB LCD 这类高级裸机实验