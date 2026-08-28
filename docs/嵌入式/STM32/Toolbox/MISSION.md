# Mission: 嵌入式工程师工具箱（构建调试 · 代码规范 · 多媒体格式 · CAN 总线）

## Why

LVGL / FreeRTOS / lwIP 三门大课学的是"框架怎么用"，这门课补的是"工程师日常的硬技能"：看懂编译产物、读懂启动文件、会用调试器、写出规范代码、解析多媒体文件、驾驭 CAN 总线。这些零散技能是嵌入式工程师的"工具箱"，决定从"会写代码"到"专业"的差距。

## Success looks like

- 看懂 MDK 编译产物（.o/.axf/.hex/.map），能通过 MAP 文件排查 Flash/RAM 占用与死代码
- 讲清 STM32 从复位到 main 的完整路径（向量表、Reset_Handler、_main）
- 熟练配置 ST-Link/J-Link 并完成在线调试（断点、变量监视、调用栈）
- 写出的代码符合正点原子 C 规范（排版/注释/命名/函数/变量/宏），并能用规范重构自己的旧代码
- 看懂 BMP/WAV/JPEG/GIF 四种文件格式的结构，能在 STM32 上写解析器（BMP→LCD、WAV→DAC）
- 理解 CAN 协议：报文格式、仲裁、位时序、错误处理，能用 STM32 bxCAN 完成双机通信
- 把"文件解析"与 LVGL/FreeRTOS/lwIP 技能组合成完整产品能力

## Constraints

- 教材来源（`参考文档/other/` 下 9 份可读文档）：STM32 启动文件浅析 V1.2、STM32 MAP 文件浅析 V1.1、STLINK 调试补充教程、嵌入式单片机 C 代码规范与风格 V1.1、BMP 图片文件详解、WAV 文件格式分析与应用、E文 JPEG 编解码介绍（ISO 标准英文原版）、GIF Decoder（英文文章）、can 入门教程（瑞萨官方）
- 《电脑游戏机硬件与编程特技》为扫描版（无文字层），无法提取内容，**本课程暂不包含**（可后续 OCR 或人工补充）
- 硬件：STM32F407 探索者；练习环境：当前工程（EmbedOrigin_4s，含 LVGL/FATFS/DAC 波形等）及 FreeRTOS 分支工程
- 课程形式：HTML 互动课程，与前三门课同款（行内样式高亮、三连导航、quiz、真机练习）
- 部分文档很薄（WAV/STLINK），课程会扩展真机实战内容补足深度

## Out of scope

- 电脑游戏机硬件与编程特技（扫描版无法提取）
- JPEG 标准全部细节（课程只挑 DCT/量化/霍夫曼/文件结构核心）
- CAN 的高级主题（CAN FD、TTCAN、高层协议 CANopen/J1939）
- 其他调试器（Ozone、IAR C-SPY 等）与 Linux 开发工具链