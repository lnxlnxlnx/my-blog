---
title: 任务通知
published: 2026-08-23
description: FreeRTOS 课程第 12 课：任务通知直接把数据写进目标任务 TCB——四种操作方式、Take/Wait 接收 API，以及用通知模拟二值信号量与邮箱的实验。
tags: [FreeRTOS, 嵌入式, RTOS, 任务通知, 轻量通信]
category: FreeRTOS
draft: false
prevTitle: 中断管理与临界区
prevSlug: "freertos/0013-interrupts-and-critical-sections"
nextTitle: 事件标志组
nextSlug: "freertos/0011-event-groups"
---

# 任务通知

这是 FreeRTOS 系列课程笔记的第 12 课：直接钻进任务里的"信使"——最快的轻量通信方式。**本课目标：**前几课的队列、信号量、事件组都是"通讯对象"——要创建、要经过它们中转。任务通知则直接把数据塞进目标任务的 TCB，快且省。学完你能说清：通知值四种操作方式的差别、`ulTaskNotifyTake` 与 `xTaskNotifyWait` 怎么用，并能用通知模拟二值信号量和邮箱（正点原子《FreeRTOS 开发指南 V1.12》第 17 章 PDF p.353~393）。

---

## 1. 直接通讯：不走"中转站"

队列、信号量、事件组都属于**通讯对象**：发送方把数据交给对象，接收方从对象取走——绕了一圈。而任务通知是**直接通讯**：每个任务的 TCB（任务控制块，第 5 课讲过）里都内置了任务通知数组和通知状态数组，发送方直接把通知写进目标任务的 TCB（PDF 17.1 节 PDF p.353）。

- **任务通知数组**：每个元素是一个 32 位无符号通知值。值为 0 表示没有通知，非 0 表示有通知，通知值本身就是内容。
- **任务通知状态数组**：标记对应通知的状态，共三种：**未等待通知**（复位态）、**等待通知**（接收方正在阻塞等待）、**等待接收通知**（通知已发出、接收方还没取走）。

发送方（任务或中断）写通知值时，接收方任务如果正在阻塞等待，会立刻被解除阻塞——整个流程不需要创建任何对象，这就是"直接"二字的含义。

---

## 2. 优势与缺点：快 45%，但有四个"不能"

**优势**（PDF 17.1.2 节 PDF p.354）：

- 🚀 **快**：比队列、信号量、事件组快得多，官方数据约 **快 45%**。因为它没有"创建对象→操作队列→取数据"的间接过程，也不需要互斥保护通讯对象本身。
- 🧠 **省 RAM**：通讯对象用之前得先创建（队列要分配存储区），而任务通知只是 TCB 里固定的几个字节，零额外开销。

**缺点**——四个"不能"（PDF 17.1.3 节 PDF p.354）：

| 场景 | 通讯对象（队列/信号量/事件组） | 任务通知 |
| --- | --- | --- |
| 发送到中断 | 可以（任务→中断） | ❌ 不能，通知依赖 TCB，中断没有 TCB |
| 多个接收者 | 可以（广播） | ❌ 只能指定一个任务接收 |
| 缓冲多个数据 | 可以（队列有深度） | ❌ 通知值只有一个，后发覆盖先发（仅 eIncrement 可计数） |
| 发送方阻塞等待 | 可以（队列满时等空位） | ❌ 发通知不会阻塞 |

> ⚠️ 任务通知"快"的前提是**用对场景**。需要广播、需要缓冲、需要任务→中断时，老老实实用队列/信号量/事件组；一对一的"唤醒+捎带小数据"才是任务通知的主场。教材原文也强调：实际中"多个任务接收同一对象"很少见，所以任务通知的适用面比想象中宽（PDF 17.1.3 节 PDF p.354）。

---

## 3. 发送 API：四种操作方式

发送通知的三大函数（V10.4.6 内核里它们都是宏，最终都调用 `xTaskGenericNotify()`，PDF 17.2.1 节 PDF p.355）：

```c
/* 通用发送函数原型 */
BaseType_t xTaskGenericNotify(TaskHandle_t xTaskToNotify,   /* 发给谁 */
                              UBaseType_t  uxIndexToNotify, /* 通知数组下标（默认 0） */
                              uint32_t     ulValue,         /* 通知值 */
                              eNotifyAction eAction,        /* 操作方式 */
                              uint32_t *   pulPreviousNotificationValue); /* 旧值，可传 NULL */

/* 常用宏封装 */
xTaskNotify(xTask, ulValue, eAction);                    /* 通用发送，不取旧值 */
xTaskNotifyAndQuery(xTask, ulValue, eAction, &old);      /* 通用发送，顺带取旧值 */
xTaskNotifyGive(xTask);                                  /* 等价于 eIncrement：通知值加 1 */

/* 中断版（多一个 pxHigherPriorityTaskWoken 参数） */
xTaskNotifyFromISR(xTask, ulValue, eAction, &xHigherPriorityTaskWoken);
vTaskNotifyGiveFromISR(xTask, &xHigherPriorityTaskWoken);
```

关键在 `eAction`（`eNotifyAction` 枚举，PDF 17.2.1 节 PDF p.357）：

| eAction 取值 | 行为 | 像什么 |
| --- | --- | --- |
| `eSetBits` | 通知值按位或上 ulValue | 事件标志组 |
| `eIncrement` | 通知值加 1 | 计数型信号量 |
| `eSetValueWithOverwrite` | 无条件覆写通知值为 ulValue | 队列（xQueueOverwrite） |
| `eSetValueWithoutOverwrite` | 只有没有待处理通知时才覆写，否则返回 pdFAIL | 长度 1 的队列 |
| `eNoAction` | 不动通知值，仅唤醒任务 | 二值信号量（只唤醒） |

四种操作方式（用户常归纳为 eSetValue/eIncrement/eSetBits/eNoAction 四类）加上"覆写/不覆写"两个变体，几乎覆盖了所有轻量通信场景。

---

## 4. 接收 API：Take 与 Wait

接收通知有两个函数（PDF 17.2.2 节 PDF p.368）：

```c
/* 1. ulTaskNotifyTake：把通知值当"计数器"用 */
uint32_t ulTaskNotifyTake(BaseType_t xClearCountOnExit,  /* pdTRUE=成功后清零, pdFALSE=成功后减 1 */
                          TickType_t xTicksToWait);      /* 阻塞时间 */
/* 返回 0：失败/超时；返回非 0：通知值 */

/* 2. xTaskNotifyWait：把通知值当"位图/数据"用 */
BaseType_t xTaskNotifyWait(uint32_t ulBitsToClearOnEntry, /* 等待前清零哪些位 */
                           uint32_t ulBitsToClearOnExit,  /* 成功后清零哪些位 */
                           uint32_t *pulNotificationValue, /* 传出通知值 */
                           TickType_t xTicksToWait);
/* 返回 pdTRUE：等到通知；pdFALSE：超时 */
```

- `ulTaskNotifyTake(pdTRUE, …)` 成功接收后清零通知值 → 值只有 0/非 0 两种 → 模拟**二值信号量**。
- `ulTaskNotifyTake(pdFALSE, …)` 成功接收后通知值减 1 → 值可以累积 → 模拟**计数型信号量**。
- `xTaskNotifyWait(0x00, 0xFFFFFFFF, &val, …)` 把整个通知值取走并清零 → 模拟**消息邮箱**（一次性传一个 32 位值）。
- `xTaskNotifyWait(0x00, 0x00, &val, …)` + 发送端用 `eSetBits` → 模拟**事件标志组**（教材 17.6 实验：KEY0 置 bit0、KEY1 置 bit1，task2 收到后按位判断，凑齐再刷新 LCD，PDF 17.6.2 节 PDF p.390）。

---

## 5. 教材实验：模拟二值信号量与邮箱

先看模拟二值信号量（教材 17.3 实验，PDF 17.3.2 节 PDF p.376）：

```c
/* task1：按键发送通知（等价于"给出信号量"） */
void task1(void *pvParameters)
{
    uint8_t key = 0;

    while (1)
    {
        key = key_scan(0);
        if (key == KEY0_PRES)
        {
            /* 通知值加 1，等价于 xSemaphoreGive */
            xTaskNotifyGive(Task2Task_Handler);
        }
        vTaskDelay(10);
    }
}

/* task2：阻塞接收通知（等价于"获取信号量"） */
void task2(void *pvParameters)
{
    uint32_t notify_val = 0;

    while (1)
    {
        /* 成功接收后清零通知值，模拟二值信号量 */
        notify_val = ulTaskNotifyTake(pdTRUE, portMAX_DELAY);

        if (notify_val != 0)
        {
            printf("收到通知，LCD 刷新\r\n");
        }
    }
}
```

再看模拟消息邮箱（教材 17.5 实验，PDF 17.5.2 节 PDF p.385）：

```c
/* task1：按键，把键值作为通知值"装进邮箱" */
void task1(void *pvParameters)
{
    uint8_t key = 0;

    while (1)
    {
        key = key_scan(0);
        if ((Task2Task_Handler != NULL) && (key != 0))
        {
            /* 无条件覆写通知值：像往邮箱里塞了一封信 */
            xTaskNotify(Task2Task_Handler, key, eSetValueWithOverwrite);
        }
        vTaskDelay(10);
    }
}

/* task2：等通知，取出通知值（相当于读邮箱） */
void task2(void *pvParameters)
{
    uint32_t notify_val = 0;

    while (1)
    {
        /* 等待前不清位，成功接收后把 32 位全部清零 */
        xTaskNotifyWait(0x00000000, 0xFFFFFFFF, &notify_val, portMAX_DELAY);

        switch (notify_val)
        {
            case KEY0_PRES: printf("收到 KEY0\r\n"); break;
            case KEY1_PRES: printf("收到 KEY1\r\n"); break;
            default:        printf("未知键值 %d\r\n", notify_val); break;
        }
    }
}
```

> 💡 一个容易忽略的点：模拟二值信号量时，`xTaskNotifyGive()` 在任务上下文调用；在中断里要换成 `vTaskNotifyGiveFromISR()`，并检查 `pxHigherPriorityTaskWoken` 决定是否 `portYIELD_FROM_ISR()`——这是第 13 课中断管理的预热。

---

## 动手练习

### 练习 12.1：中断通知模拟二值信号量

- 1️⃣ 在你的 FreeRTOS 分支工程里，用 1Hz 定时器中断 + `vTaskNotifyGiveFromISR()` 模拟"每秒给出一次信号量"。
- 2️⃣ 任务里用 `ulTaskNotifyTake(pdTRUE, portMAX_DELAY)` 接收并打印，观察是否严格 1Hz 输出。
- 3️⃣ 把 `pdTRUE` 改成 `pdFALSE`（计数模式）再观察：任务偶尔慢半拍时，通知值会累积，输出会"追平"——这正是计数型信号量的行为。

### 练习 12.2：用通知值做"邮箱"传一个值

- 1️⃣ 仿照教材 17.5 实验：task1 扫描按键，把键值用 `xTaskNotify(…, eSetValueWithOverwrite)` 发给 task2；task2 用 `xTaskNotifyWait` 取出并解析。
- 2️⃣ 对比 `eSetValueWithOverwrite` 与 `eSetValueWithoutOverwrite`：快速连按两次按键，观察"后一次是否覆盖前一次"的差异。
- 3️⃣ 验收标准：串口能正确输出每次按键的键值，且你能说出两种覆写方式的语义差别。

---

## 自测

### 随堂小测 1

任务通知相比队列/信号量最大的两个优势是？

- A. 更快且更省 RAM
- B. 支持广播且支持缓冲
- C. 支持中断发送且不限接收者

<details>
<summary>查看答案</summary>

A。直接写入目标任务 TCB，无对象创建与中转开销，官方称约快 45%（PDF 17.1.2 节，p.354）。B、C 恰恰是任务通知的缺点。
</details>

### 随堂小测 2

xTaskNotify 的 eIncrement 操作等价于哪种通讯对象？

- A. 二值信号量
- B. 计数型信号量
- C. 消息队列

<details>
<summary>查看答案</summary>

B。eIncrement 把通知值加 1，配合 ulTaskNotifyTake(pdFALSE) 减 1，正是计数型信号量的行为（PDF 17.2.1 节，p.357）。
</details>

### 随堂小测 3

下列哪种场景不适合用任务通知？

- A. 中断唤醒一个高优先级任务
- B. 一个事件通知多个任务
- C. 任务间传递一个 32 位数值

<details>
<summary>查看答案</summary>

B。任务通知只能发给指定任务，不能广播；广播请用事件标志组（PDF 17.1.3 节，p.354）。
</details>

### 随堂小测 4

ulTaskNotifyTake(pdTRUE, portMAX_DELAY) 成功接收通知后，通知值会？

- A. 清零
- B. 减 1
- C. 保持不变

<details>
<summary>查看答案</summary>

A。xClearCountOnExit=pdTRUE 时清零，值只剩 0/非 0 两种状态，从而模拟二值信号量（PDF 17.2.2 节，p.368）。
</details>

---

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 17 章（PDF p.353~393）——四个模拟实验（二值/计数信号量、邮箱、事件组）全部依据
- 🌐 [FreeRTOS API 参考：Task Notifications API](https://freertos.org/Documentation/02-Kernel/04-API-references/05-Direct-to-task-notifications/00-RTOS-task-notifications)——通知函数完整原型
- 📚 [FreeRTOS 官方文档：Task Notifications as Mailboxes](https://www.freertos.org/Documentation/02-Kernel/02-Kernel-features/03-Direct-to-task-notifications/05-As-mailbox)——通知当邮箱用的专门讲解

---

## 下一步

有问题随时问我。下一课预告：第 13 课——中断管理与临界区，原理硬核课：PendSV 为什么要最低优先级？FreeRTOS 的临界区到底关了哪些中断？该揭开 Cortex-M 内核的面纱了。

| [← 上一课](/my-blog/posts/freertos/0011-event-groups/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0013-interrupts-and-critical-sections/) |
| --- | --- | --- |