---
title: 综合项目 — LVGL × FreeRTOS 产品多任务架构
published: 2026-08-28
description: FreeRTOS 课程收官课：用 FreeRTOS 重构"智能设备控制台"为多任务产品——任务划分、LVGL 带 OS 移植、队列通信与分步验收清单。
tags: [FreeRTOS, 嵌入式, RTOS, LVGL, 综合项目]
category: FreeRTOS
draft: false
prevTitle: ""
prevSlug: ""
nextTitle: 空闲任务与低功耗 Tickless
nextSlug: "freertos/0016-idle-task-and-low-power"
---

# 综合项目 — LVGL × FreeRTOS 产品多任务架构

这是 FreeRTOS 系列课程笔记的第 17 课：把 LVGL 第 12 课的"智能设备控制台"从裸机升级成多任务产品——任务划分 → LVGL 集成 → 队列通信 → 分步验收。**本课目标：**毕业设计收官。用 FreeRTOS 重构你在 LVGL 课程第 12 课做的"智能设备控制台"：界面变成一个独立 GUI 任务，数据采集、存储、按键各归其位，任务之间用队列/信号量通信。学完你能独立规划多任务架构、完成 LVGL 的带 OS 移植（参考《LVGL 开发指南 V1.5》第 3 章 PDF p.51~56），并逐项验收"界面流畅、数据实时、栈无溢出"。

---

## 1. 架构设计：先分任务，再写代码

裸机版的控制台是"一个大 while 循环"：扫描按键 → 分发页面 → `lv_timer_handler()` 刷界面。多任务化的核心思路是**把"顺序排队"改成"各管一摊"**——每个职责一个任务，用通信机制连起来。参考 LVGL 指南 3.2 节《编写 FreeRTOS 相关代码》的任务划分方式（PDF p.52），本产品建议分成 5 个任务：

| 任务 | 优先级 | 栈大小（字） | 职责 | 运行节奏 |
| --- | --- | --- | --- | --- |
| start_task | 1 | 128 | 创建其他任务后删除自己 | 仅启动时 |
| key_task | 2 | 128 | 按键扫描 → 二值信号量/队列通知 GUI | 10ms 轮询 |
| storage_task | 3 | 256 | 收数据 + 事件组触发，写 SD 卡 | 事件驱动 |
| acq_task | 4 | 256 | ADC 采样 → 队列发给 GUI（波形数据） | 100ms 周期 |
| gui_task | 5 | 1024 | `lv_timer_handler()` + 收队列更新控件 | 5ms 循环 |

优先级设计的两条原则：**数字越大优先级越高**；**"谁丢数据谁更高"**——采集丢了就断波形，所以 acq 高于 storage；存储写卡很慢，放低了才不会把 GUI 卡死；GUI 渲染单次调用通常控制在几毫秒内，放最高也安全，但如果你发现采集被挤压，就把 gui_task 降到和 acq 同级再观察。栈大小是起点不是终点，第 2 节练习会用 `uxTaskGetStackHighWaterMark()` 实测校准。

> 💡 定时器服务任务（daemon）提醒：如果你的界面大量使用 `lv_timer_create`，那是 LVGL 自己的定时器、由 `lv_timer_handler()` 驱动，不进 FreeRTOS 的软件定时器。只有用 `xTimerCreate` 才需要关注 `configTIMER_TASK_PRIORITY` 和 `configTIMER_TASK_STACK_DEPTH`——本课程不深讲，知道存在即可。

---

## 2. LVGL 集成要点：时基、显示与互斥

### 2.1 时基：别再手动喂 lv_tick_inc

裸机版靠定时器中断调 `lv_tick_inc()` 喂时基；有了 FreeRTOS，直接让 LVGL 从系统 tick 读时间。改 lv_conf.h（LVGL 指南 3.1 节 PDF p.51）：

```c
/* ===== lv_conf.h：时基切换到 FreeRTOS ===== */
/* 使用自定义 tick 源，不再需要手动更新 lv_tick_inc() */
#define LV_TICK_CUSTOM                1
#if LV_TICK_CUSTOM
    #define LV_TICK_CUSTOM_INCLUDE        "FreeRTOS.h"   /* 引入系统头文件 */
    /* 计算当前毫秒的表达式 */
    #define LV_TICK_CUSTOM_SYS_TIME_EXPR  (xTaskGetTickCount())
#endif
```

前提：`configTICK_RATE_HZ` 必须是 **1000**（1 tick = 1ms，教材工程默认就是），否则 LVGL 所有动画、延时时间全错。如果你不想用 `LV_TICK_CUSTOM`，也可以保留裸机的 `lv_tick_inc()`，改由一个 1ms 周期任务喂——两种都行，本课用官方推荐的 `LV_TICK_CUSTOM`。

### 2.2 显示缓冲与刷新线程模型

你的 `lv_port_disp.c`（EXTERNAL/LVGL/porting/ 下）已经说明了刷新机制：LVGL 把控件画进 `buf_1`（320×10 行，约 6.4KB 单缓冲），画完通过 `disp_flush()` 回调交给 `lcd_color_fill()` 上屏，最后必须调 `lv_disp_flush_ready(disp_drv)` 告知"可以画下一块了"。关键认知：**flush 回调是在 GUI 任务（lv_timer_handler 的调用者）的上下文里执行的**，所以单缓冲同步刷新时，整个"渲染+刷屏"都发生在 gui_task 里——这是最简单的模型，也意味着 gui_task 的栈要够大（1024 字起步）。

想提速：把 `lv_port_disp.c` 里注释掉的"双缓冲 + DMA"打开（Example 2 的 `buf_2_1/buf_2_2`），LVGL 画下一块的同时 DMA 在传上一块，刷屏和渲染并行。注意 DMA 模式下要等 DMA 传输完成再调 `lv_disp_flush_ready()`。这个优化留作进阶，验收标准不强制。

### 2.3 LVGL API 互斥保护

LVGL 和 RTOS 一样是"大循环 + 定时器"模型，官方文档（Operating system and interrupts 一节）明确警告：**多个任务同时调 LVGL API 是线程不安全的**。推荐的官方模板是"lvgl_thread 模式"：一个专职线程跑 `lv_timer_handler()`，其他线程访问 LVGL 必须加锁。落到我们的架构上，最稳妥的做法：

- **默认策略：LVGL API 只在 gui_task 里调用**。其他任务一律通过队列/信号量把"数据"或"事件"发给 gui_task，由它统一更新控件——天然无锁，这是最推荐的架构。
- **万一必须跨任务碰控件**（比如 storage_task 要直接改状态标签），就上互斥信号量：创建一把全局锁，任何碰 LVGL 的代码段先 `xSemaphoreTake` 再 `xSemaphoreGive`（注意不能在锁里 `vTaskDelay`，小心死锁）。

---

## 3. 任务间通信设计：数据走队列，事件走信号量

| 链路 | 机制 | 说明 |
| --- | --- | --- |
| acq_task → gui_task | 队列 | 每 100ms 发一个采样值；gui_task 阻塞接收，喂给 chart（波形页）和 meter（主页） |
| key_task → gui_task | 二值信号量 / 队列 | 按键按下给信号量（只关心"有事件"）；要区分哪个键就用队列传键值 |
| acq_task → storage_task | 队列 + 事件组 | 数据入队；攒满 N 条或收到"保存"事件（事件组位）才触发一次落盘 |

为什么要队列而不是全局变量？回顾第 8 课：全局变量在任务间共享有读写冲突问题，队列自带阻塞、容量和生产者-消费者语义。GUI 消费速度可能比采集慢，队列深度就是"缓冲水位"——深度不够会丢数据，深度太大延迟变高。先给 64 个采样值的容量，验收时统计丢包率再调。

---

## 4. 分步实现清单：五步走

1. **Step 1 移植验证**：在 FreeRTOS 分支工程里先只建 gui_task，跑通你现有的控制台界面（LVGL 初始化 + `lv_timer_handler` 循环）。这一步先别拆任务，验证"LVGL 在 RTOS 里活着"。
2. **Step 2 GUI 任务化**：把裸机 main 循环的按键扫描拆成 key_task，页面分发逻辑收进 gui_task，按键事件走信号量/队列。
3. **Step 3 采集任务**：建 acq_task，100ms 周期采样（先用模拟数据或简单 ADC），数据进队列。
4. **Step 4 通信打通**：gui_task 阻塞收队列，波形页 chart 实时滚动、主页 meter 联动；需要时补互斥锁。
5. **Step 5 存储落盘**（可选加分）：storage_task 收数据 + 事件组触发，写 SD 卡，写卡时界面不许卡。

> ⚠️ **一步一烧录，别攒着一起调**：嵌入式调试最贵的是"定位"，每步编译烧录验证一次，炸了范围最小。尤其 Step 1 没过之前不要动 Step 2——先确认"LVGL+FreeRTOS"这个组合本身没问题，再谈架构。

---

## 5. 验收标准清单：逐项勾选

- ☐ **界面流畅**：LVGL 性能监控（lv_conf.h 已开 `LV_USE_PERF_MONITOR`）显示静止 FPS ≥ 25，动态数据时 ≥ 20
- ☐ **数据实时**：波形曲线 ≤ 100ms 延迟滚动，表针连续转动无跳变
- ☐ **写卡不卡**：Step 5 完成后，storage 写 SD 期间 GUI 不掉帧（验证优先级设计的正确性）
- ☐ **栈无溢出**：所有任务 `uxTaskGetStackHighWaterMark()` 余量 ≥ 20%，连续运行 1 小时稳定
- ☐ **无数据丢失**：acq→gui 队列不丢点（记录 drop 计数为 0），或明确记录丢弃率
- ☐ **内存稳定**：用第 15 课的 `xPortGetFreeHeapSize()` 观察，长时间运行剩余堆不下降
- ☐ **互斥正确**：多任务碰 LVGL 时 30 分钟压力测试无花屏、无死锁（若采用单任务访问策略，写明该策略即可）
- ☐ **版本配套**：在工程 README 或笔记里写明 FreeRTOS V10.4.6 + LVGL v8.3.11 的配套说明与移植要点

---

## 6. 代码示例：骨架、GUI 任务与采集任务

### 6.1 主框架：初始化 + 创建任务 + 启动调度器

```c
/* ===== lvgl_demo.c：参考《LVGL 开发指南 V1.5》3.2 节（PDF p.52~54） ===== */
#include "lvgl_demo.h"
#include "FreeRTOS.h"
#include "task.h"
#include "semphr.h"
#include "queue.h"
#include "lvgl.h"
#include "lv_port_disp.h"
#include "lv_port_indev.h"
#include "app_console.h"          /* LVGL 第 12 课的控制台模块 */

/* ---- 任务配置 ---- */
#define GUI_TASK_PRIO     5
#define GUI_STK_SIZE      1024
TaskHandle_t GuiTask_Handler;

#define ACQ_TASK_PRIO     4
#define ACQ_STK_SIZE      256
TaskHandle_t AcqTask_Handler;

#define KEY_TASK_PRIO     2
#define KEY_STK_SIZE      128
TaskHandle_t KeyTask_Handler;

void lvgl_demo(void)
{
    lv_init();                    /* lvgl 系统初始化 */
    lv_port_disp_init();          /* 显示接口初始化，在 lv_init() 之后 */
    lv_port_indev_init();         /* 输入接口初始化（触摸），在 lv_init() 之后 */

    Console_Init();               /* 创建"智能设备控制台"界面（复用 LVGL 第 12 课代码） */

    /* 创建 start_task：由它统一创建其余任务（参照 LVGL 指南的写法） */
    xTaskCreate(start_task, "start_task", 128, NULL, 1, NULL);

    vTaskStartScheduler();        /* 开启任务调度（正常情况下不会返回） */
}

void start_task(void *pvParameters)
{
    taskENTER_CRITICAL();         /* 进临界区，防止创建过程中被调度 */

    xTaskCreate(gui_task, "gui_task", GUI_STK_SIZE, NULL, GUI_TASK_PRIO, &GuiTask_Handler);
    xTaskCreate(acq_task, "acq_task", ACQ_STK_SIZE, NULL, ACQ_TASK_PRIO, &AcqTask_Handler);
    xTaskCreate(key_task, "key_task", KEY_STK_SIZE, NULL, KEY_TASK_PRIO, &KeyTask_Handler);

    taskEXIT_CRITICAL();
    vTaskDelete(NULL);            /* 删除自己，收尾交给空闲任务 */
}
```

### 6.2 GUI 任务模板：刷屏 + 收队列 + 互斥

```c
/* ===== gui_task：LVGL 专属线程（lvgl_thread 模板） ===== */
static SemaphoreHandle_t s_lvgl_lock;   /* LVGL API 互斥锁（默认策略下极少用到） */

void gui_task(void *pvParameters)
{
    int16_t sample;

    while (1)
    {
        /* 从采集队列取数据（阻塞 100ms 超时），更新控件 */
        while (xQueueReceive(s_data_queue, &sample, pdMS_TO_TICKS(100)) == pdPASS)
        {
            /* 队列里可能积压了多条，一口气消化完再刷屏 */
            xSemaphoreTake(s_lvgl_lock, portMAX_DELAY);   /* 跨任务碰 LVGL 才需要锁 */
            Console_PushSample(sample);   /* 更新 chart 与 meter（你的控制台模块） */
            xSemaphoreGive(s_lvgl_lock);
        }

        xSemaphoreTake(s_lvgl_lock, portMAX_DELAY);
        lv_timer_handler();               /* LVGL 引擎：处理定时器、渲染、flush */
        xSemaphoreGive(s_lvgl_lock);

        vTaskDelay(pdMS_TO_TICKS(5));     /* 让出 CPU：给低优先级任务喘息的机会 */
    }
}
```

### 6.3 采集任务模板：采样 + 队列发送

```c
/* ===== acq_task：100ms 周期采样，数据走队列 ===== */
#define SAMPLE_QUEUE_LEN   64            /* 队列深度：缓冲水位 */
QueueHandle_t s_data_queue;

void acq_task(void *pvParameters)
{
    TickType_t xLastWakeTime = xTaskGetTickCount();   /* 绝对周期基准（第 14 课） */
    int16_t    sample;

    while (1)
    {
        sample = adc_read_channel(0);     /* 换成你的实际采样代码 */

        /* 队列满就丢弃并计数（用于验收 drop 指标），不阻塞采集 */
        if (xQueueSend(s_data_queue, &sample, 0) != pdPASS)
        {
            s_dropped_count++;            /* 全局计数，GUI 任务可读取展示 */
        }

        vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(100));   /* 绝对周期 */
    }
}
```

注意采集任务用的是第 14 课的 `vTaskDelayUntil`——100ms 采样周期绝不能漂。按键任务照葫芦画瓢：扫描到按下就给 gui_task 发一个二值信号量或键值队列，GUI 侧收到后走 `Console_GoPage()` 切页。

---

## 动手练习

### 练习 17.1：完成清单第 1~3 步——GUI 任务化 + 采集任务 + 队列通信

- 1️⃣ **Step 1**：在你的 FreeRTOS 分支工程里只建 gui_task，把 lv_conf.h 的 `LV_TICK_CUSTOM` 按第 2.1 节配好，复用 LVGL 第 12 课的控制台代码，确认界面在 RTOS 下正常显示、触摸可用。
- 2️⃣ **Step 2**：把裸机 main 循环里的按键扫描拆成 key_task，按键事件用队列发给 gui_task，页面分发逻辑收进 GUI 侧。
- 3️⃣ **Step 3**：建 acq_task（先发模拟波形数据，如正弦），每 100ms 一个点，数据入队列；gui_task 收队列喂给波形页 chart。
- **观察什么：**波形应像裸机版一样平滑滚动；把 gui_task 的 `vTaskDelay(5)` 改成 `vTaskDelay(50)`，观察波形变"卡"的临界点——这能帮你理解 GUI 任务的刷新节奏对体验的影响。

### 练习 17.2：uxTaskGetStackHighWaterMark 校准任务栈

- 1️⃣ 在 start_task 里为每个任务保存句柄，另开一个"体检任务"（或复用 gui_task 的某个空闲时机）周期性调用：

    ```c
    /* 栈水位体检：返回任务创建以来从未用过的栈深度（字） */
    void health_task(void *pvParameters)
    {
        UBaseType_t gui_left, acq_left, key_left;

        while (1)
        {
            gui_left = uxTaskGetStackHighWaterMark(GuiTask_Handler);
            acq_left = uxTaskGetStackHighWaterMark(AcqTask_Handler);
            key_left = uxTaskGetStackHighWaterMark(KeyTask_Handler);
            printf("gui:%u acq:%u key:%u\n",
                   (unsigned)gui_left, (unsigned)acq_left, (unsigned)key_left);
            vTaskDelay(pdMS_TO_TICKS(1000));
        }
    }
    ```

- 2️⃣ 让系统"满负荷"跑一轮（切页、滚波形、狂按按键），读三分钟打印。**观察什么：**余量是否 ≥ 20%？gui_task 若余量 < 200 字（≈20%），就把栈从 1024 加到 1536；key_task 余量常年 100+ 字，可以降到 96 省 RAM。
- 3️⃣ 收尾：把最终栈配置写进代码注释，并在工程 README 记录 FreeRTOS V10.4.6 + LVGL v8.3.11 版本配套说明。

---

## 自测

### 随堂小测 1

把 LVGL 时基从裸机 lv_tick_inc 切换到 FreeRTOS 的正确做法是？

- A. lv_conf.h 里 LV_TICK_CUSTOM=1，表达式用 xTaskGetTickCount()
- B. 在 SysTick 中断里直接调 lv_timer_handler()
- C. 删掉 lv_tick_inc，LVGL 会自动用系统时间

<details>
<summary>查看答案</summary>

A。LV_TICK_CUSTOM=1 配合 xTaskGetTickCount()（且 configTICK_RATE_HZ=1000）；B 在中断里跑 LVGL 是大忌；C 不配置就没有时基（PDF p.51）。
</details>

### 随堂小测 2

多任务环境下 LVGL API 最安全的访问策略是？

- A. 所有任务随时都能调，LVGL 自带线程安全
- B. LVGL API 只集中在 gui_task 调用，其他任务发队列/信号量
- C. 每个任务复制一份 LVGL 实例

<details>
<summary>查看答案</summary>

B。官方 lvgl_thread 模板：专职线程跑 lv_timer_handler，其他任务通过消息/队列间接更新控件；跨任务直调必须加互斥锁。
</details>

### 随堂小测 3

采集任务与 GUI 任务之间传波形数据，首选机制是？

- A. 全局数组 + 中断标志
- B. 消息队列，带容量与阻塞语义
- C. 直接把数据写进 chart 内部结构

<details>
<summary>查看答案</summary>

B。队列自带生产者-消费者语义、容量缓冲与阻塞机制；全局变量有读写冲突问题（第 8 课）。
</details>

### 随堂小测 4

检查任务栈是否够用的标准 API 是？

- A. xPortGetFreeHeapSize()
- B. uxTaskGetStackHighWaterMark()
- C. xTaskGetTickCount()

<details>
<summary>查看答案</summary>

B。uxTaskGetStackHighWaterMark 返回"从未使用过的栈深度"，余量应 ≥ 20%；A 查的是堆不是栈。
</details>

---

## 推荐阅读

- 📖 正点原子《LVGL 开发指南 V1.5》第 3 章 LVGL 带操作系统移植（PDF p.51~56）——带 OS 移植的官方参考，本课集成方案依据
- 📖 正点原子《FreeRTOS 开发指南 V1.12》——第 12 章时间管理（p.211）、第 20 章内存管理（p.411）回查必备
- 🌐 [LVGL 官方文档：Operating system and interrupts（v8.3）](https://docs.lvgl.io/8.3/porting/os.html)——线程模型与互斥的官方说明
- 🌐 [Mastering the FreeRTOS Real Time Kernel](https://www.freertos.org/Documentation/RTOS_book.html)——官方免费书，任务设计与队列章节常读常新
- 🔧 你工程里的 `EXTERNAL/LVGL/porting/lv_port_disp.c`——显示缓冲与刷新机制的活教材（双缓冲 DMA 方案在注释里）

---

## 下一步

🎓 17 课到此收官。从"移植跑通"到"多任务产品"，你走完了 FreeRTOS 的全流程。以后做任何产品，都记得这条主线：**先分任务、再定通信、小步验证、栈和堆都要体检、逐项验收**。有任何不清楚的地方，随时回来问我（Agent 就是你的老师）——课程到这里结束，下一站由你来定。

| [← 上一课](/my-blog/posts/freertos/0016-idle-task-and-low-power/) | [课程目录](/my-blog/posts/freertos/00-总览/) |  |
| --- | --- | --- |