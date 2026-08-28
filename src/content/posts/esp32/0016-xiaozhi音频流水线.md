---
title: xiaozhi 音频流水线
published: 2026-08-26
description: 音频是 xiaozhi 的心脏。拆成上行(说)和下行(听)两条流水线:Opus 解码、重采样、AFE 唤醒词检测;音频服务只是"管道"不是"业务"。
tags: [ESP32, 嵌入式, xiaozhi, 音频, AFE]
category: ESP32
draft: false
prevTitle: xiaozhi 网络与协议
prevSlug: "esp32/0017-xiaozhi网络与协议"
nextTitle: xiaozhi 板级抽象 boards/
nextSlug: "esp32/0015-xiaozhi板级抽象"
---

# xiaozhi 音频流水线

这是 ESP-IDF 课程系列笔记的第 16 课(预计 25 分钟)。音频是 xiaozhi 的心脏。这课把它拆成两条流水线:**上行(说)和下行(听)**,并指出关键文件。你不需要改它,但要能对着代码讲清楚每一步。

## 知识点 1:下行播放——"服务器说,设备听"

```cpp
// application.cc 收到音频包 → 交给音频服务解码
audio_service_.PushPacketToDecodeQueue(packet);
// audio_service.cc 里:Opus 解码 → PCM
esp_opus_decode(...);
// 采样率不匹配时重采样 → 喂给喇叭(I2S/codec)
output_resampler_.process(...);
```

对照之前的知识:Opus 帧(60ms)→ 解码 → 重采样 → I2S → Codec → 喇叭。服务器发什么它就放什么——这就是为什么"换音色/换歌"全在服务器端做。

## 知识点 2:上行采集——"设备说,服务器听"

```text
麦克风 → Codec ADC → I2S →
AFE(回声消除/降噪/唤醒词) → Opus 编码 → WebSocket 发给服务器
```

唤醒词"小智小智"在 **AFE 本地**检测(乐鑫 esp-sr),不依赖网络。认出唤醒词后才开始"录整句话"上传。

## 知识点 3:音频服务是"管道"不是"业务"

`audio_service.cc` 只管:解码、重采样、推队列;具体"该不该播、播什么"由上层(application/状态机)决定。读它时抓住两个队列:**解码队列(入)和播放队列(出)**。

## 动手实践

打开 `main/audio/audio_service.cc`:
① 搜 `PushPacketToDecodeQueue` 和 `esp_opus_decode`,标出解码入口;
② 找 `output_resampler_` 的初始化参数(采样率 16k?24k?);
③ 打开 `main/application.cc` 搜"收到音频包"的处理函数,确认入队时机。

## 测验

### 测验 1
唤醒词在哪检测?
- A. 本地AFE(正确)
- B. 服务器
- C. 云端

<details>
<summary>答案与解析</summary>

**答案：A**。本地 esp-sr AFE,离线即时。
</details>

### 测验 2
下行音频链路最后一步是?
- A. I2S到喇叭(正确)
- B. Opus编码
- C. NVS存储

<details>
<summary>答案与解析</summary>

**答案：A**。重采样后经 I2S 送 Codec 到喇叭。
</details>

## 推荐阅读

> **xiaozhi 官方《音频驱动/板级音频文档》**与 [esp-adf](https://github.com/espressif/esp-adf) 的音频概念;还有仓库 `docs/` 里 audio 相关说明。

## 下一步

下一课:网络与协议——WebSocket 怎么连、消息怎么封装、断线怎么重连。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/esp32/0015-xiaozhi板级抽象/) | [课程目录](/my-blog/posts/esp32/00-总览/) | [下一课 →](/my-blog/posts/esp32/0017-xiaozhi网络与协议/) |