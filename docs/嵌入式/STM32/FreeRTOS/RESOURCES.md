# FreeRTOS 课程资源

## Knowledge

- [《FreeRTOS 开发指南 V1.12》— 正点原子（本地 PDF）](参考文档/FreeRTOS开发指南_V1.12.pdf)
  课程主线教材，共 20 章：简介/移植/配置/中断管理/任务基础/任务 API/列表/启动流程/任务切换/队列/信号量/软件定时器/事件组/任务通知/低功耗/内存管理。基于 FreeRTOS V10.4.6（v202112.00 官方源码）。**用**：每课主讲来源，先看 PDF 对应章节再上课。

- [FreeRTOS 官网](https://www.freertos.org/)
  官方权威资料入口：Getting Started、Developer Docs、API 参考手册（含每个 API 的参数/返回值/用法示例）。**用**：API 细节核实、源码下载。

- [Mastering the FreeRTOS™ Real Time Kernel（官方教程书）](https://www.freertos.org/Documentation/RTOS_book.html)
  FreeRTOS 官方免费 PDF 书籍，英文，比正点原子教材更贴近上游源码。**用**：原理课的补充阅读，官方术语一手来源。

- [The FreeRTOS™ Reference Manual](https://www.freertos.org/Documentation/api-ref.html)
  官方 API 参考手册。**用**：API 权威速查。

- [《The Definitive Guide to ARM® Cortex®-M3 and Cortex-M4 Processors》— Joseph Yiu](https://www.arm.com/resources/books)
  Cortex-M 架构权威书籍。**用**：第 13 课（中断管理）PendSV/SysTick/异常模型的原理解读。

- 用户另一个 git 分支上的 FreeRTOS 工程
  所有真机练习的目标环境（当前分支 EmbedOrigin_4s 不动）。**用**：移植、实验、综合项目的代码落点。

## Wisdom (Communities)

- [开源电子网 / 正点原子论坛](https://www.openedv.com/forum.php)
  正点原子官方论坛，FreeRTOS 移植与实验问题的高频答案聚集地。**用**：工程相关的疑难杂症。

- [FreeRTOS 官方论坛](https://forums.freertos.org/)
  官方开发者社区，作者级专家答疑。**用**：内核行为疑问、bug 确认、移植疑难。

- 本地：无（暂不加入线下社区）

## Gaps

- 中文的 FreeRTOS V10.4.x 内核逐行源码解析资料较少，本课程的第 5/6/7 课（列表、启动流程、任务切换）以 PDF 第 7/8/9 章 + 官方源码为主线，必要时对照《Mastering the FreeRTOS》英文原文。