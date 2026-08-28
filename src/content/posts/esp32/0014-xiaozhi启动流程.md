---
title: xiaozhi 启动流程
published: 2026-08-24
description: 从 main.cc 第一行走到 app.Run():入口只有四步、Initialize 干的三类事、Run() 是"状态机 + 事件"的引擎。
tags: [ESP32, 嵌入式, xiaozhi, 启动流程]
category: ESP32
draft: false
prevTitle: xiaozhi 板级抽象 boards/
prevSlug: "esp32/0015-xiaozhi板级抽象"
nextTitle: 读懂大工程与 xiaozhi 总览
nextSlug: "esp32/0013-读懂大工程与xiaozhi总览"
---

# xiaozhi 启动流程

这是 ESP-IDF 课程系列笔记的第 14 课(预计 20 分钟)。上一课画了全局地图,这课从 `main.cc` 第一行走到 `app.Run()`——看 xiaozhi 怎么把"配置、硬件、网络、音频"串成一台能说话的设备。

## 知识点 1:入口只有四步

```cpp
extern "C" void app_main(void)
{
    nvs_flash_init();                        // 1. 配置存储(和 00_basic 一样)
    auto& app = Application::GetInstance();   // 2. 单例
    app.Initialize();                          // 3. 初始化一切
    app.Run();                                 // 4. 事件循环,永不返回
}
```

全部秘密在 `Application::Initialize()` 和 `Run()` 里——去 `application.cc` 找这两个函数。

## 知识点 2:Initialize 干的三类事

```cpp
// application.cc 里 Initialize 的大致分工(自己核对)
board → 引脚/屏幕/喇叭初始化         // boards/ 层
protocols → websocket/mqtt 客户端    // 网络层
audio → 音频服务 + AFE               // 音频层
settings → 读 NVS 配置               // 配置层
```

读代码技巧:`Initialize()` 里 **按调用顺序编号**——每个子系统的初始化函数各占一段,先看名字就能猜职责。

## 知识点 3:Run() 是"状态机 + 事件"的引擎

`Run()` 不写死流程,而是:**注册事件回调(按键、唤醒、网络)+ 起任务 + 进入循环**。设备的行为(待机/唤醒/对话/OTA)由 `device_state_machine.cc` 的状态机驱动——不同状态下,同样的事件行为不同。

## 动手实践

打开 `application.cc`,回答三个问题(只搜不细读):
① `Initialize()` 调用了哪些 `xxx::Init` 类函数?
② `Run()` 里注册了哪几类事件回调?
③ 找到 `device_state_machine.cc` 里状态机的状态枚举,列出来。

## 测验

### 测验 1
app.Run() 返回后程序会怎样?
- A. 不会返回(正确)
- B. 退出重启
- C. 进入睡眠

<details>
<summary>答案与解析</summary>

**答案：A**。Run() 跑事件循环,永不返回。
</details>

### 测验 2
设备行为切换靠什么驱动?
- A. 状态机(正确)
- B. 硬编码if
- C. 外部复位

<details>
<summary>答案与解析</summary>

**答案：A**。device_state_machine.cc 的状态机。
</details>

## 推荐阅读

> **xiaozhi 仓库 README_zh.md**:先看"架构"章节,和这课对答案。

## 下一步

下一课:板级抽象 boards/——一块开发板是怎么被"定义"出来的,你的面包板组合板在哪。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/esp32/0013-读懂大工程与xiaozhi总览/) | [课程目录](/my-blog/posts/esp32/00-总览/) | [下一课 →](/my-blog/posts/esp32/0015-xiaozhi板级抽象/) |