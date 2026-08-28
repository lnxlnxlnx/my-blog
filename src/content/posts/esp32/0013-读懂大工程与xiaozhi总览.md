---
title: 读懂大工程与 xiaozhi 总览
published: 2026-08-23
description: 用一套方法论把 xiaozhi 这个几千文件的工程"读薄":读大工程的三个尺度、xiaozhi 全局地图、一句话数据流。这是系列的分水岭。
tags: [ESP32, 嵌入式, xiaozhi, 工程结构]
category: ESP32
draft: false
prevTitle: xiaozhi 启动流程
prevSlug: "esp32/0014-xiaozhi启动流程"
nextTitle: 音频基础：I2S / Codec / Opus
nextSlug: "esp32/0012-音频基础"
---

# 读懂大工程与 xiaozhi 总览

这是 ESP-IDF 课程系列笔记的第 13 课(预计 25 分钟)。前 12 课是零件,这一课开始装机。目标:**用一套方法论把 xiaozhi 这个几千文件的工程"读薄"**。这课是分水岭——后面 5 课都拆 xiaozhi。

## 知识点 1:读大工程的三个尺度

| 尺度 | 问的问题 | 工具 |
|---|---|---|
| 全局 | 有几个子系统?数据怎么流? | 目录树、CMakeLists、README |
| 模块 | 这个组件对谁负责?接口是什么? | 头文件(.h)优先,实现后看 |
| 局部 | 这个函数在哪个线程/事件里跑? | 日志 TAG、调用链、xTaskCreate |

顺序永远是:目录 → 头文件 → 入口 → 事件流,**绝不从 .c 第一行读起**。

## 知识点 2:xiaozhi 全局地图

```text
xiaozhi-esp32-2.2.4/main/
├── main.cc              # 入口:app_main → Application
├── application.cc       # 主应用:状态机 + 事件调度
├── boards/              # 板级抽象(70+ 开发板)
├── audio/               # 音频流水线(采集/播放/AFE)
├── protocols/           # WebSocket / MQTT 通信
├── ota.cc               # OTA 升级
├── settings.cc          # NVS 配置
├── display/  ├── led/    # 屏与灯
└── device_state_machine.cc  # 设备状态机
```

## 知识点 3:一句话数据流

> 麦克风 → `audio` 采集(AFE 唤醒词) → 认到"小智小智" → 录到说话结束 → `protocols` 打包发送(Opus) → 服务器回文本+音频 → `audio` 播放 → `display/led` 同步表情。

## 动手实践

打开 `xiaozhi-esp32-2.2.4`,**只做三件事**:①读根 `CMakeLists.txt` 和 `main/CMakeLists.txt` 看注册了哪些源文件;②数 `boards/` 下有多少个板目录;③在 `application.cc` 里搜 `xTaskCreate`,列出创建了哪几个任务。不用读实现。

## 测验

### 测验 1
读大工程的第一步是什么?
- A. 看目录结构(正确)
- B. 读main.c
- C. 跑一遍

<details>
<summary>答案与解析</summary>

**答案：A**。先建立全局地图,再逐层下钻。
</details>

### 测验 2
xiaozhi 的唤醒流程起点在哪?
- A. audio采集(正确)
- B. protocols
- C. display

<details>
<summary>答案与解析</summary>

**答案：A**。audio 的 AFE 唤醒词检测。
</details>

## 推荐阅读

> **xiaozhi 官方文档目录**([仓库 docs/](https://github.com/78/xiaozhi-esp32/tree/main/docs)):先读 websocket.md 和 custom-board.md 两篇,和这课的全局地图互相印证。

## 下一步

下一课拆启动流程:`main.cc` → `Application` 怎么把上面这堆组件串起来。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/esp32/0012-音频基础/) | [课程目录](/my-blog/posts/esp32/00-总览/) | [下一课 →](/my-blog/posts/esp32/0014-xiaozhi启动流程/) |