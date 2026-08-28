# Mission: µC/OS-III 与手写操作系统内核（MiniOS）

## Why

在 FreeRTOS 原理深入（链表就绪表、PendSV 切换、调度器）的基础上，通过 µC/OS-III 学习第二种经典内核设计（**位图就绪表**），并亲手**实现一个可运行的最小操作系统（MiniOS）**——把"操作系统到底是怎么造出来的"彻底搞懂。造完内核的人，用任何 RTOS 都只是查 API。

## Success looks like

- 独立实现 MiniOS 并跑通：位图就绪表 + PendSV 上下文切换 + 调度器 + 时基与任务延时 + 信号量，多任务在 STM32F407 上正常运行
- 能不看资料讲清 µC/OS-III 的 `OSRdyGrp/OSRdyTbl` 位图算法，以及与 FreeRTOS 链表就绪表的差异与优劣
- 会用 µC/OS-III 的任务/信号量/互斥量/消息队列/事件标志/内存管理 API 做产品开发
- 三内核（MiniOS / µC/OS-III / FreeRTOS）架构对比了然于胸，能说出各自的内存占用与适用场景

## Constraints

- 教材主线：正点原子《µC/OS-III 开发指南 V1.5》（`参考文档/UCOS-III开发指南_V1.5.pdf`）
- 硬件：STM32F407 探索者
- 练习环境：**另一个 git 分支上的 µC/OS-III 工程**（当前分支不动）；MiniOS 在该分支上新建独立目录实现
- 课程形式：HTML 互动课程，与 LVGL/FreeRTOS 课程同款（行内样式代码高亮、三连导航、quiz、真机练习）
- **强衔接**：处处与 FreeRTOS 课程对比（位图 vs 链表、OSSched vs 调度器、临界区实现差异等），建议先完成 FreeRTOS 课程

## Out of scope

- µC/OS-II 及更老版本
- µC/GUI、µC/FS、µC/TCP-IP 等 Micrium 生态组件
- 多核 / SMP 内核
- 商业认证（如 SafeRTOS 的 TÜV 认证流程）