---
title: STM32 bxCAN 实战
published: 2026-08-27
description: 把前三课的理论烧进 STM32F407 探索者：bxCAN 外设资源、HAL 初始化与波特率、只收 0x123 的掩码滤波器、HAL_CAN_AddTxMessage 发帧与中断回调收帧，并完成 Loopback 自发自收验证。
tags: [Toolbox, 嵌入式, STM32, CAN, bxCAN]
category: Toolbox
draft: false
prevTitle: 综合项目：CAN 多媒体节点
prevSlug: "toolbox/0020-final-integration"
nextTitle: CAN 位时序与错误处理
nextSlug: "toolbox/0018-can-timing-errors"
---

# STM32 bxCAN 实战

让 F407 探索者真正开口说 CAN：HAL 初始化、滤波器、收发一封邮件（扩展课）

**本课目标：**把前三课的理论烧进单片机。学完你能在 STM32F407 探索者上配好 bxCAN（波特率、Normal/Loopback 模式），配出"只收 0x123"的掩码滤波器，用 `HAL_CAN_AddTxMessage` 发帧、用中断回调 `HAL_CAN_GetRxMessage` 收帧，并完成"回环自发自收"验证——这是第 20 课综合项目的地基。

## 1. F407 bxCAN 外设简介

F407 的 **bxCAN（Basic Extended CAN）** 硬件资源（参考手册 RM0090）：

- **两个 CAN 控制器：CAN1 和 CAN2**（bxCAN 为双 CAN 设计，共享 28 个滤波器组）
- **3 个发送邮箱**：可以同时排队 3 帧待发
- **2 个接收 FIFO（FIFO0/FIFO1）**：每个可深 3 帧，收到就进 FIFO，主程序慢慢取
- **14 个（单 CAN）或 28 个（双 CAN 共享）滤波器组**：按 ID 决定哪些帧进 FIFO
- **需要外部收发器**：bxCAN 只是控制器，输出的 TX/RX 是 TTL 逻辑电平；要经 **TJA1050 等 CAN 收发器**转成 CAN_H/CAN_L 差分信号才能上总线。好消息：探索者板载了 CAN 收发器，双机/接分析仪时直接用排针引出

## 2. HAL 初始化与波特率

先看工程事实：当前工程 `Core/Src` 下**还没有 can.c**（本课代码里我给了可直接使用的 HAL 初始化写法，你也可以用 CubeMX 使能 CAN1 生成 `MX_CAN1_Init()`，两者等价）。波特率公式沿用第 18 课：

- CAN 时钟 = **APB1（F407 默认 42MHz）**
- **波特率 = 42MHz / (Prescaler × (1 + BS1 + BS2))**
- 采样点 = (1 + BS1) / (1 + BS1 + BS2)，落在 75%~87.5% 附近最佳
- **Normal 模式**：上总线，和其它节点通信；**Loopback 模式**：发送直接环回自己的接收，不上总线——单板调试神器

> 💡 板载收发器 + Normal 模式 = 真上总线；没有第二台设备时，先切 **Loopback** 自发自收验证链路，再上电双机。探索者板载 CAN 收发器，波特率档位和 120Ω 匹配电阻都已经在 PCB 上帮你做好了。

## 3. 接收滤波器

bxCAN 有一个"看门人"：**滤波器**。收到一帧后先过滤波器，匹配才进 FIFO。不配滤波器 = 一只耳聋的 CAN，什么帧都收不到。两种模式（`CAN_FilterTypeDef`）：

- **掩码模式（IDMASK）**：掩码位为 1 的位必须与 ID 完全一致，为 0 的位不管——"1 必须同，0 随便"
- **列表模式（IDLIST）**：必须与列表中的 ID 完全相等——精确点名
- 本课用**掩码模式 + 32 位滤波**，只放行 0x123

## 4. 发送：把帧塞进邮箱

发送三步：① 填好 `CAN_TxHeaderTypeDef`（StdId/IDE/RTR/DLC）② 调 `HAL_CAN_AddTxMessage`，帧进邮箱自动发 ③ 返回值带出 `mailbox` 号。若邮箱全满，`HAL_CAN_AddTxMessage` 会返回 `HAL_BUSY`——要等 TME 位有空位再发。

## 5. 接收：中断回调拿帧

接收（中断模式）三步：① `HAL_CAN_ActivateNotification` 打开 FIFO0 消息挂起中断 ② 在弱回调 `HAL_CAN_RxFifo0MsgPendingCallback` 里取帧 ③ `HAL_CAN_GetRxMessage` 把帧从 FIFO0 拷进你的变量。回调里只做"快取 + 置标志"，真正的业务逻辑放主循环——这是 RTOS 任务 / 裸机 while 都通用的好习惯。

> ⚠️ 两个最常见的"收不到"：**① 忘了配滤波器或掩码写错；② 两端波特率不一致**（现象：发送老是 ACK 错误、接收全是错误帧）。调前先用示波器/逻辑分析仪或 CAN 分析仪确认总线上真有帧，再怀疑软件。

## 代码示例

下面 4 段代码组合起来就是一个能用的 CAN 驱动（API 均来自当前工程的 `stm32f4xx_hal_can.c/.h`）。

```c
/* 示例 1：初始化（等价于 CubeMX 生成的 MX_CAN1_Init）
 * APB1 = 42MHz，Prescaler=7，BS1=9，BS2=2 → 42M/(7×12) = 500kbps，采样点 ≈ 83% */
CAN_HandleTypeDef hcan1;

void MX_CAN1_Init(void)
{
    hcan1.Instance = CAN1;
    hcan1.Init.Prescaler = 7;                    /* 42MHz / 7 = 6MHz → Tq ≈ 166ns */
    hcan1.Init.Mode = CAN_MODE_NORMAL;           /* 双机用 NORMAL；单板自测改 CAN_MODE_LOOPBACK */
    hcan1.Init.SyncJumpWidth = CAN_SJW_1TQ;      /* SJW = 1Tq */
    hcan1.Init.TimeSeg1 = CAN_BS1_9TQ;           /* PBS1 = 9Tq */
    hcan1.Init.TimeSeg2 = CAN_BS2_2TQ;           /* PBS2 = 2Tq */
    hcan1.Init.TimeTriggeredMode = DISABLE;
    hcan1.Init.AutoBusOff = DISABLE;             /* 总线关闭需软件介入处理 */
    hcan1.Init.AutoWakeUp = DISABLE;
    hcan1.Init.ReceiveFifoLocked = DISABLE;
    hcan1.Init.TransmitFifoPriority = DISABLE;
    if (HAL_CAN_Init(&hcan1) != HAL_OK) {
        Error_Handler();
    }
}
```

```c
/* 示例 2：滤波器（掩码模式，只放行 0x123）+ 启动 + 开中断 */
void CAN1_Filter_Start(void)
{
    CAN_FilterTypeDef sFilterConfig;

    /* 32 位滤波：ID 左移 5 位，落在寄存器 STID[10:0] 对应位段 */
    sFilterConfig.FilterIdHigh     = (uint32_t)(0x123 << 5); /* 期望 ID */
    sFilterConfig.FilterIdLow      = 0x0000;
    sFilterConfig.FilterMaskIdHigh = (uint32_t)(0x7FF << 5); /* 掩码 1=必须匹配 */
    sFilterConfig.FilterMaskIdLow  = 0x0000;
    sFilterConfig.FilterFIFOAssignment = CAN_FILTER_FIFO0;   /* 匹配帧进 FIFO0 */
    sFilterConfig.FilterBank       = 0;                      /* 用滤波器组 0 */
    sFilterConfig.FilterMode       = CAN_FILTERMODE_IDMASK;  /* 掩码模式 */
    sFilterConfig.FilterScale      = CAN_FILTERSCALE_32BIT;  /* 32 位滤波 */
    sFilterConfig.FilterActivation = ENABLE;
    if (HAL_CAN_ConfigFilter(&hcan1, &sFilterConfig) != HAL_OK) {
        Error_Handler();
    }

    if (HAL_CAN_Start(&hcan1) != HAL_OK) {                   /* 启动 CAN */
        Error_Handler();
    }
    if (HAL_CAN_ActivateNotification(&hcan1,
            CAN_IT_RX_FIFO0_MSG_PENDING) != HAL_OK) {        /* 开接收中断 */
        Error_Handler();
    }
}
```

```c
/* 示例 3：发送一个标准数据帧 */
HAL_StatusTypeDef CAN1_Send(uint16_t std_id, uint8_t *data, uint8_t len)
{
    CAN_TxHeaderTypeDef txHeader;
    uint32_t mailbox = 0;

    txHeader.StdId = std_id;               /* 标准 ID：0x000 ~ 0x7FF */
    txHeader.IDE   = CAN_ID_STD;           /* 标准帧 */
    txHeader.RTR   = CAN_RTR_DATA;         /* 数据帧 */
    txHeader.DLC   = len;                  /* 0~8 */
    txHeader.TransmitGlobalTime = DISABLE;

    return HAL_CAN_AddTxMessage(&hcan1, &txHeader, data, &mailbox);
}

/* 使用：周期发一帧 0x123，数据 {0xAA, 0x55} */
uint8_t d[] = {0xAA, 0x55};
CAN1_Send(0x123, d, 2);
```

```c
/* 示例 4：接收中断回调（弱函数，重写它） */
void HAL_CAN_RxFifo0MsgPendingCallback(CAN_HandleTypeDef *hcan)
{
    CAN_RxHeaderTypeDef rxHeader;
    uint8_t rxData[8];

    if (hcan->Instance == CAN1) {
        HAL_CAN_GetRxMessage(hcan, CAN_RX_FIFO0, &rxHeader, rxData);
        if (rxHeader.StdId == 0x123) {
            /* 收到 0x123 命令帧：rxData[0] 是命令码 */
            printf("CAN cmd = 0x%02X, len = %u\r\n", rxData[0], rxHeader.DLC);
        }
    }
}
```

## 动手练习

### 练习 19.1（练习 A）：回环模式验证收发链路

1. 把 `Mode` 改为 `CAN_MODE_LOOPBACK`，配好滤波器（收 0x123）并 `HAL_CAN_Start` + 开中断。
2. 主循环里每秒用 `CAN1_Send(0x123, data, 2)` 发一帧，串口打印回调收到的内容。
3. 验收：串口每 1 秒打印一次 `CAN cmd = 0x..` 且数据一致——回环链路通了，说明波特率/滤波器/收发函数全部正确。

### 练习 19.2（练习 B）：双机通信（有第二块板或分析仪时）

1. 两端都切 `CAN_MODE_NORMAL`，统一 500kbps，共地（GND 相连）。
2. ID 规划：A 板发 **0x123 命令帧**，B 板发 **0x321 状态帧**；各自滤波器只收对方 ID。
3. 验收：A 板每发一帧，B 板串口打印出来；B 板回一帧 0x321，A 板打印出来。用掩码模式各收各的，验证互不干扰。

## 自测

### 随堂小测

**Q1. F407 bxCAN 有几个发送邮箱？**

- A. 3 个，可同时排队 3 帧
- B. 2 个，收发各一个
- C. 8 个，按优先级排队

<details><summary>查看答案</summary>

A。bxCAN 有 3 个发送邮箱、2 个接收 FIFO（参考手册 RM0090）。

</details>

**Q2. 收不到任何消息，最常见的排查方向是？**

- A. 先查滤波器与波特率是否配对
- B. 加大发送数据长度到 16 字节
- C. 把滤波器全部改成列表模式

<details><summary>查看答案</summary>

A。滤波器忘配/掩码错、两端波特率不一致是"收不到"的两大元凶。

</details>

**Q3. Loopback（回环）模式的作用是？**

- A. 双机远距离长线通信
- B. 单板自发自收，验证收发链路
- C. 降低波特率以省电

<details><summary>查看答案</summary>

B。Loopback 发送直接环回接收，不上总线，适合单板自测。

</details>

**Q4. 接收中断回调里应该做什么？**

- A. 调用 GetRxMessage 快取帧并置标志
- B. 播放 WAV 再回显到屏幕
- C. 阻塞等待下一帧数据到达

<details><summary>查看答案</summary>

A。回调里只做快取 + 置标志，耗时业务放主循环/任务，避免阻塞中断。

</details>

## 推荐阅读

- 📖 ST 参考手册 RM0090 第 25 章 bxCAN——外设寄存器与滤波器位段权威说明
- 📖 当前工程 `Drivers/STM32F4xx_HAL_Driver/Src/stm32f4xx_hal_can.c` 顶部注释——HAL 使用流程（Init→ConfigFilter→Start→AddTxMessage/GetRxMessage）

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 20 课——综合项目"CAN 多媒体节点"：用 0x123/0x124/0x125 三个命令遥控开发板播放 WAV、显示 BMP，并回传状态帧，把工具箱所有模块拧成一台机器。

| [← 上一课](/my-blog/posts/toolbox/0018-can-timing-errors/) | [课程目录](/my-blog/posts/toolbox/00-总览/) | [下一课 →](/my-blog/posts/toolbox/0020-final-integration/) |