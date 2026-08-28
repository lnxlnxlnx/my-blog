# 先验知识：FreeRTOS 原理深入进行中，目标手写操作系统内核

用户披露：裸机熟练（F407 + LVGL + FATFS）；FreeRTOS 课程（courses/FreeRTOS）为原理深入型，已完成第 1 课，将掌握链表就绪表、PendSV 切换、调度器原理；另一个 git 分支有 µC/OS-III 工程；明确要求 UCOS 课程"讲解怎么实现一个操作系统"，选择贯穿式手写 MiniOS 内核 + 与 FreeRTOS 强衔接对比。

**影响**：课程不再重复"什么是 RTOS/为什么用 RTOS"这类基础，直接进入 UCOS 机制与 FreeRTOS 的对照；第 7~12 课 MiniOS 系列每课产出一段可运行的内核代码，最终在 F407 上跑通；UCOS 应用部分（13~16 课）精选任务/信号量/互斥/队列/事件/内存管理。

**风险提示**：用户同时维护三套课程（LVGL/FreeRTOS/UCOS），进度可能交叉；MiniOS 系列依赖 FreeRTOS 课程已讲过的 PendSV/调度点概念，若 FreeRTOS 未学完就开 UCOS 课，第 7~12 课会用到前置知识，需在课程里标注前置依赖。