---
title: 综合项目：CAN 多媒体节点
published: 2026-08-28
description: 收官项目"CAN 多媒体节点"：上位机通过 CAN 发 0x123/0x124/0x125 命令遥控开发板播放 WAV、显示 BMP，并回传 0x321 状态帧——把工具箱所有模块拧成一台机器。
tags: [Toolbox, 嵌入式, STM32, CAN, 综合项目]
category: Toolbox
draft: false
prevTitle: ""
prevSlug: ""
nextTitle: STM32 bxCAN 实战
nextSlug: "toolbox/0019-can-bxcan-in-action"
---

# 综合项目：CAN 多媒体节点

用一条 CAN 总线遥控开发板播 WAV、显 BMP——把工具箱所有模块拧成一台机器

**本课目标：**收官之作。把前 19 课（CAN 收发、WAV 播放、BMP 显示、串口调试、MAP 分析、代码规范）串成一个真实项目：**上位机或另一节点通过 CAN 发命令 → 开发板执行 → 回发状态帧**。学完你能按"先链路、后功能、再回传"的节奏把它一步步搭出来，并用 MAP 文件给自己打一份占用账单。

## 1. 项目蓝图：CAN 多媒体节点

一句话：**一台"总线遥控的多媒体机"**。总线上的命令方（PC 上位机、CAN 分析仪、或另一块板）通过 CAN 给开发板下指令，开发板执行并汇报状态。

```text
# 帧 ID 规划（写在 README 里，写码前先定死）
0x123  命令帧 →  播放 WAV（data[0] = 曲目号）
0x124  命令帧 →  显示 BMP（data[0] = 图片号）
0x125  命令帧 →  停止（停止播放/清屏）
0x321  状态帧 ←  开发板回传（data[0] = 状态码, data[1] = 最近命令）

# 状态码约定
0x00 空闲   0x01 播放中   0x02 显示中   0xFF 未知命令
```

## 2. 模块复用清单：工具箱大检阅

这个项目是"搭积木"，每一块都在前面的课里见过：

| 模块 | 来源 | 在项目里的角色 |
|------|------|----------------|
| **CAN 收发** | 第 19 课 | 收命令、发状态 |
| **WAV 播放器** | 音频课程 | 0x123 → 播放指定曲目 |
| **BMP 解析器** | 图像课程 | 0x124 → 显示指定图片 |
| **串口调试** | 第 7~8 课 | 打印收到的命令，联调期间"看得见" |
| **代码规范** | 第 5~6 课 | 命名/头文件/单一职责，让工程可维护 |
| **MAP 文件分析** | 第 1~2 课 | 验证 Flash/RAM 占用 |

## 3. 分步实现清单（5 步）

原则：**每一步都可编译、可验证**，绝不在没跑通的上一步上叠新功能。

1. **① CAN 收发先跑通**：第 19 课代码原样搬过来，Loopback 验证 → Normal 双机验证（无第二台就先用 Loopback + 串口自证）
2. **② 串口打印命令**：把回调里收到的 `rxData[0]` 当命令码，串口打印 `CMD=0x..`——此时链路已"看得见"
3. **③ 接 BMP 显示**：收到 0x124 调用 BMP 显示函数，图片能出来
4. **④ 接 WAV 播放**：收到 0x123 调用 WAV 播放函数，声音能出来
5. **⑤ 状态回传**：每一步执行完用 0x321 回发状态帧，上位机"看得到"开发板状态

## 4. 代码规范自查

用第 5~7 课的规范给自己的代码打分（每项 ✓/✗）：

- 命名：函数 `can_cmd_dispatch` / 变量 `last_cmd_id`，见名知意，无拼音缩写
- 头文件：声明与实现分离，`can_app.h` 只暴露必须暴露的函数
- 单一职责：`wav_play_track()` 只管播放，`can_send_status()` 只管回传，分发函数里没有超过 20 行的分支
- 注释：硬件相关（波特率怎么来的、收发器注意点）写清楚；废话注释不写
- 可读性：魔法数字（0x123/0x124…）用 `#define` 或 `enum` 命名

## 5. 验收标准（可勾选）

### 项目验收单

- ☐ 发 0x123（带曲目号）→ 开发板开始播放 WAV，回传 0x321/0x01
- ☐ 发 0x124（带图片号）→ 开发板显示对应 BMP，回传 0x321/0x02
- ☐ 发 0x125 → 停止播放并清屏，回传 0x321/0x00
- ☐ 连续快速乱发命令，无卡死、无硬错误（Fault 不进 HardFault_Handler）
- ☐ 栈深合理：用第 1 课 .htm 方法核对，Stack_Size 不低于静态栈深 2 倍
- ☐ 代码规范自查 5 项全 ✓

> 💡 关键节奏：**先让"能发能收"可见，再挂功能，最后回状态**。第 2 步串口打印就是你的"最小可验证点"——从它开始，每加一步都有成就感且随时可回退。

> ⚠️ 两个坑：① **别在中断回调里做耗时操作**（播放/显示放主循环或任务），回调只置标志；② 命令帧和状态帧的 ID、数据字节含义**写进 README 再动手**——联调时"两边对不上协议"是最大的时间黑洞。

## 代码示例

下面两段是项目的"总装"代码：命令分发（主循环逻辑）和状态回传。

```c
/* 收到一帧后的"命令解析 + 执行"：每个 case 只做一件事 */
void can_cmd_dispatch(CAN_RxHeaderTypeDef *rx, uint8_t *data)
{
    switch (rx->StdId) {
    case 0x123:                        /* 播放 WAV：data[0] = 曲目号 */
        wav_play_track(data[0]);
        can_send_status(0x01);         /* 回状态帧：播放中 */
        break;
    case 0x124:                        /* 显示 BMP：data[0] = 图片号 */
        bmp_show(data[0]);
        can_send_status(0x02);         /* 回状态帧：显示中 */
        break;
    case 0x125:                        /* 停止 */
        wav_stop();
        bmp_clear();
        can_send_status(0x00);
        break;
    default:
        can_send_status(0xFF);         /* 未知命令 */
        break;
    }
}

/* 主循环：消费回调里置的"收到新帧"标志（rx_pending），不在中断里跑业务 */
while (1) {
    if (rx_pending) {
        rx_pending = 0;
        can_cmd_dispatch(&rx_header, rx_data);
    }
}
```

```c
/* 回传状态帧：0x321 + 状态码 + 最近命令 */
void can_send_status(uint8_t status)
{
    CAN_TxHeaderTypeDef tx;
    uint8_t buf[2];
    uint32_t mb;

    tx.StdId = 0x321;               /* 状态帧 ID */
    tx.IDE   = CAN_ID_STD;
    tx.RTR   = CAN_RTR_DATA;
    tx.DLC   = 2;
    buf[0] = status;                /* 0x00 空闲 / 0x01 播放 / 0x02 显示 / 0xFF 未知 */
    buf[1] = last_cmd_id;           /* 刚才执行的命令 ID */
    HAL_CAN_AddTxMessage(&hcan1, &tx, buf, &mb);
}
```

## 动手练习

### 练习 20.1：完成第 1~3 步（CAN 收发 → 串口打印 → 接 BMP 显示）

1. 第 1 步：CAN 收发跑通（Loopback 或双机），串口能看到收发日志。
2. 第 2 步：把回调收到的命令码打印出来，发 0x123/0x124/0x125 各一次，串口依次显示 CMD。
3. 第 3 步：接上 BMP 模块，发 0x124 → 屏幕显示出图片；不显示就回到"串口打印"那步确认命令真的到了。

### 练习 20.2：用 MAP 文件验证 Flash/RAM 占用

1. 完整编译，打开工程的 .map 文件，翻到 "Image component sizes" 一节。
2. 记下加入 CAN/WAV/BMP 模块后的 Code / RO-data / RW-data / ZI-data 四类总量（单位字节）。
3. 与未加这些模块的旧版本对比增量，算一算：CAN 驱动 + 应用层大约吃掉多少 Flash 和 RAM？这份账单值不值？

## 自测

### 随堂小测

**Q1. 项目里 0x123 帧的职责是什么？**

- A. 播放 WAV 的命令帧
- B. 开发板回传的状态帧
- C. 停止所有操作的控制帧

<details><summary>查看答案</summary>

A。0x123 播放 WAV、0x124 显示 BMP、0x125 停止、0x321 回传状态。

</details>

**Q2. 收到命令后正确的处理顺序是？**

- A. 解析 ID → 分派执行 → 回传状态
- B. 先清屏 → 再判断 ID → 最后播放
- C. 直接执行 → 出错再回传状态

<details><summary>查看答案</summary>

A。先按 ID 分派，每个分支执行一件事并回传状态，未知命令回 0xFF。

</details>

**Q3. 中断回调里应该放什么？**

- A. 快取帧 + 置标志，业务放主循环
- B. 直接播放 WAV 和刷新屏幕
- C. 阻塞等待串口空闲再处理

<details><summary>查看答案</summary>

A。耗时操作放主循环/任务，避免阻塞中断导致丢帧或卡死。

</details>

**Q4. 用什么文件查看各模块的 Flash/RAM 占用？**

- A. .map 的 Image component sizes
- B. .htm 的最大栈深报告
- C. .o 文件的反汇编清单

<details><summary>查看答案</summary>

A。MAP 文件的 Image component sizes 给出每模块 Code/RO/RW/ZI 占用（第 2 课）。

</details>

## 推荐阅读

- 📖 本课程第 1~2 课（MAP 文件）、第 5~6 课（代码规范）、第 7~8 课（串口调试）——本项目的"零件仓库"
- 📖 瑞萨《CAN 入门教程》——回炉 CAN 概念时随时翻

## 下一步

🎓 20 课到此收官！你把这条总线从"两根线"讲到了"能遥控多媒体机"。接下来给自己的项目留一点升级空间：加 CAN 错误统计、做波特率可配置、或用 FreeRTOS 把命令分发做成任务——工具箱里每一件工具都还能再打磨。有任何不清楚的地方，直接问我（Agent 就是你的老师）。

| [← 上一课](/my-blog/posts/toolbox/0019-can-bxcan-in-action/) | [课程目录](/my-blog/posts/toolbox/00-总览/) |