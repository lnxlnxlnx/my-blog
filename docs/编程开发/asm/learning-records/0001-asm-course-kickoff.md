# LR-0001 汇编课程开课并以《驱动开发指南》汇编章节为准绳

为支撑 Linux 驱动课的"亲手写寄存器"基线，用户请求增设裸机 ARM 汇编课。已建 course/asm（A01-A06+参考速查+术语表），全部指令/寄存器/工具链事实按《驱动开发指南 V1.81》第 4/6/7/8/9/10/15 章核实。

要点固化：工具链三连（gcc=汇编编译 → ld -Ttext 0X87800000 → objcopy）与烧录仅走 SD 卡（imxdownload，不动 eMMC，单板安全）；注释用 @ 开头；`subs+bne`=延时循环、`ldr=地址`为伪指令取常量、"声明栈 = 设 SP 后才能调 C"。start.S 三步曲（关看门狗、ldr sp,=0X80200000、b/bl main）。

Implications：A 系列与 Linux 课 L05/L06 术语打通（PSR/DR/GDIR 同一组地址）；用户可以在不烧板的前提下用 objdump 反汇编完成大部分练习（先编先验），烧录推迟到必要时且仅 SD。

Evidence：6 个 lesson 文件 + reference/arm-cheatsheet.html + reference/glossary.html 已生成并通过结构校验。