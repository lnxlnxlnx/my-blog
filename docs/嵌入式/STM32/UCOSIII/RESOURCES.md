# µC/OS-III 课程资源

## Knowledge

- [《µC/OS-III 开发指南 V1.5》— 正点原子（本地 PDF）](参考文档/UCOS-III开发指南_V1.5.pdf)
  课程主线教材，19 章：简介/移植/配置/中断管理/任务基础/任务 API/启动流程/任务切换/信号量/互斥量/消息队列/事件标志/软件定时器/时间戳/内存管理。**用**：每课主讲来源，先看 PDF 对应章节。

- [µC/OS-III API 参考（Weston Embedded Solutions，Micrium 后继者）](https://weston-embedded.com/uc-os-iii)
  µC/OS-III 官方 API 手册，函数原型/参数/返回值权威来源。**用**：API 细节核实。

- [《µC/OS-III: The Real-Time Kernel》— Jean Labrosse（官方书）](https://weston-embedded.com/uc-os-iii)
  内核作者亲写的权威书籍。**用**：内核设计思想（位图就绪表、事件标志、任务内嵌对象）的一手解释。

- [FreeRTOS 课程（本地）](courses/FreeRTOS/index.html)
  本课程的对比基准：链表就绪表、vTaskSwitchContext、队列实现等处处对照。**用**：每课的"对比 FreeRTOS"小节。

- 《The Definitive Guide to ARM® Cortex®-M3 and Cortex-M4 Processors》— Joseph Yiu
  Cortex-M 架构权威书籍。**用**：第 6 课（中断/临界区）与 MiniOS 汇编部分的 PendSV/异常模型。

- 用户另一个 git 分支上的 µC/OS-III 工程
  真机练习目标环境；MiniOS 内核代码也在该分支新建目录实现。**用**：移植、实验、MiniOS 的代码落点。

## Wisdom (Communities)

- [开源电子网 / 正点原子论坛](https://www.openedv.com/forum.php)
  µC/OS-III 移植与实验问题的高频答案聚集地。**用**：工程疑难杂症。

- [Stack Overflow — embedded / freertos 标签](https://stackoverflow.com/questions/tagged/embedded)
  通用嵌入式问题，UCOS 与 FreeRTOS 实现对比问题常有人讨论。**用**：内核实现疑问。

- 本地：无（暂不加入线下社区）

## Gaps

- µC/OS-III 最新源码需向 Weston Embedded 申请，教材例程基于较老的 µC/OS-III V3.08 左右版本；内核原理不受版本影响，代码行号以分支工程实际源码为准。