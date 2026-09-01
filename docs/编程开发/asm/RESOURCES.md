# IMX6ULL 裸机 ARM 汇编 — 资源

## Knowledge

### 主资料（已在手）

- [书：正点原子《I.MX6U 嵌入式 Linux 驱动开发指南 V1.81》](file:///home/lnx/Linux_dev/imx6ull/doc/【正点原子】I.MX6U嵌入式Linux驱动开发指南V1.81.pdf)
  汇编相关章节：第 4 章（开发环境/交叉工具链）、第 6 章（Cortex-A7 架构）、第 7 章（ARM 汇编基础）、第 8 章（汇编 LED 灯实验 / 编译三连 + imxdownload 烧 SD）、第 9 章（启动方式）、第 10 章（C 语言版 LED，start.S+main.c）、第 15 章（按键输入实验）。
- [Linux 课速查表（寄存器表共用）](file:///home/lnx/Linux_dev/imx6ull/course/linux/reference/imx6ull-cheatsheet.html)
  GPIO1 寄存器地址/引脚映射与汇编课互认。

### 高质量补充

- ARM 官方《ARM Architecture Reference Manual — ARMv7-A》寄存器、模式、指令权威定义（选段阅读即可）
- 正点原子 12 个裸机例程源码（资料盘「例程源码→裸机例程」），对着看 start.S 和链接脚本
- `arm-linux-gnueabihf-objdump -D` 反汇编自带的 gcc 启动代码，是最好的"google 不出来的练习册"

## Wisdom (Communities)

- 正点原子论坛（板子专属裸机/烧录问题）
- B 站：正点原子裸机手册配套视频单元

## Gaps

- 汇编阶段烧录用 `imxdownload` 工具是否就位未确认（无则先用 objdump 反汇编验证）
- 板子"从 SD 启动"的拨码/方式未确认
- 用户 L01 采集的 `uname -a` 还没回来——但这不影响汇编课（汇编是裸机，与内核版本无关）