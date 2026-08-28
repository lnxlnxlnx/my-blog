# NOTES — 教学偏好记录

- **语言**：全程中文教学；代码注释用中文；html 页面 UTF-8。
- **课程形式**：与 LVGL/FreeRTOS 课程同款——HTML 互动课程、行内 style 代码高亮（VSCode Light+ 色板，`tools/prehighlight.js` 静态预渲染）、底部三连跳转、quiz 自测、真机练习。
- **核心诉求**：用户明确要求"讲解怎么实现一个操作系统" → 课程核心是 **MiniOS 手写内核系列**（第 7~12 课）：TCB/位图就绪表 → 上下文切换汇编 → 调度器/临界区 → 时基延时 → 信号量 → 验收对比。
- **强衔接 FreeRTOS 课程**：每课设"对比 FreeRTOS"小节；用户 FreeRTOS 课程为原理深入型，已掌握链表就绪表/PendSV/调度器，UCOS 课在此之上讲位图算法与两种实现的差异。
- **练习环境**：另一个 git 分支的 µC/OS-III 工程（当前分支 EmbedOrigin_4s 不动）；MiniOS 在分支上新建目录实现。
- **教材**：《µC/OS-III 开发指南 V1.5》，19 章。
- **UCOS 特色概念**（区别于 FreeRTOS）：优先级数值越小越高、OSRdyGrp/OSRdyTbl 位图就绪表、任务内嵌信号量/消息队列、OSTimeDlyHMSM、内存分区管理。
- 2026-08-27：课程体系定型为 16 课（见 index.html），第 1 课与基础文档已交付。