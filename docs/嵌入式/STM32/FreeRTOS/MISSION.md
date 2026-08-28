# Mission: FreeRTOS 实时操作系统（原理 + 产品多任务化）

## Why

在已有的裸机开发能力（STM32F407 探索者 + LVGL 产品界面）之上，系统掌握 FreeRTOS：既要**深入内核原理**（任务调度、列表数据结构、PendSV 切换、同步通信机制），也能把 LVGL 产品界面**多任务化**（GUI 任务 / 采集任务 / 存储任务分离），让界面永不卡顿，具备真正的产品级工程能力。

## Success looks like

- 不看文档能讲清：任务调度流程、PendSV 切换机制、列表数据结构、队列/信号量/事件组/任务通知的实现原理
- 完成全部课程真机练习（在 FreeRTOS 分支工程上），并能解释每个实验的现象与原理
- 把 LVGL 界面跑在 FreeRTOS 上：GUI 任务 + 采集任务 + 存储任务，通过队列/信号量通信（对应 LVGL 课程的综合项目）
- 掌握 FreeRTOSConfig.h 全部关键配置项，能按需求裁剪与调优
- 会用任务栈规划与 heap_4/5 内存管理，能诊断栈溢出与内存问题

## Constraints

- 教材主线：正点原子《FreeRTOS 开发指南 V1.12》（`参考文档/FreeRTOS开发指南_V1.12.pdf`，基于 FreeRTOS V10.4.6）
- 硬件：STM32F407 探索者，320×240 触摸屏
- 练习环境：**用户另一个 git 分支上的 FreeRTOS 工程**，当前分支（EmbedOrigin_4s）不动
- 课程形式：HTML 互动课程，与 LVGL 课程同款样式与导航（含 VSCode 浅色代码高亮）
- 深度：原理深入型——列表、系统启动流程、任务切换逐行源码分析

## Out of scope

- µC/OS、RT-Thread 等其他 RTOS 的对比深究
- 多核 SMP FreeRTOS
- FreeRTOS-Plus 组件（TCP/FAT/NVS/CLI 等）
- 与 lwIP 协议栈集成（属于 lwIP 课程）