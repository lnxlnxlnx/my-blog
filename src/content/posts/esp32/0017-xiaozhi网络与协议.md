---
title: xiaozhi 网络与协议
published: 2026-08-27
description: 把设备端和服务器连起来看:开机 → OTA 握手 → WebSocket 长连接 → 语音消息往来。控制走 JSON,音频走裸二进制帧,断线指数退避重连。
tags: [ESP32, 嵌入式, xiaozhi, WebSocket, 协议]
category: ESP32
draft: false
prevTitle: 实战收尾：改自己的板子
prevSlug: "esp32/0018-实战改板与加功能"
nextTitle: xiaozhi 音频流水线
nextSlug: "esp32/0016-xiaozhi音频流水线"
---

# xiaozhi 网络与协议

这是 ESP-IDF 课程系列笔记的第 17 课(预计 25 分钟)。这一课把设备端和服务器连起来看:**开机 → OTA 握手 → WebSocket 长连接 → 语音消息往来**。读完你就能对着 `protocols/websocket_protocol.cc` 讲"设备是怎么和服务器说话的"。

## 知识点 1:连接启动顺序

```text
Wi-Fi 连上 → 拿到 IP(IP_EVENT_STA_GOT_IP)
→ HTTP POST /xiaozhi/ota/  ← 服务器返回 WebSocket 地址 + 配置
→ 连接 ws://服务器:8000/xiaozhi/v1/ ← 长连接
→ 发 hello 消息,协商音频参数
```

这就是咱们服务器日志里 `OTA接口运行正常,向设备发送的websocket地址是...` 的由来——那个接口就是 `ota_handler.py` 在答。

## 知识点 2:WebSocket 消息格式(JSON)

```json
{ "type": "hello", "audio_params": "opus_24000_1_60" }
{ "type": "listen", "state": "detect" }
音频 = 二进制 Opus 帧(不经过 JSON)
```

控制走 JSON,音频走**裸二进制帧**——这是 xiaozhi 协议的核心分界,服务器端 `websocket_server.py` 也是这么拆的。

## 知识点 3:断线重连

`websocket_protocol.cc` 里注册了连接断开事件,断线后**指数退避重连**。看代码时留意 `reconnect` 相关的字段和状态机切换。

## 动手实践

打开 `main/protocols/websocket_protocol.cc`:
① 找 `esp_websocket_client` 的 URL 来源(应该来自 OTA 响应);
② 找 `on_data` 回调,看它怎么区分"JSON 消息"和"音频帧";
③ 顺藤摸瓜:音频帧交到哪个模块(应该就是 `audio_service_`)。

## 测验

### 测验 1
音频数据在 WebSocket 里怎么传?
- A. 二进制帧(正确)
- B. JSON嵌套
- C. base64

<details>
<summary>答案与解析</summary>

**答案：A**。裸二进制 Opus 帧,控制消息才是 JSON。
</details>

### 测验 2
设备从哪拿到 WebSocket 地址?
- A. OTA响应(正确)
- B. 编译写死
- C. 按键配置

<details>
<summary>答案与解析</summary>

**答案：A**。开机 POST /xiaozhi/ota/ 的响应里下发。
</details>

## 推荐阅读

> **xiaozhi 官方《WebSocket 通信协议》**([docs/websocket.md](https://github.com/78/xiaozhi-esp32/blob/main/docs/websocket.md)):整篇读一遍,和这课互证。

## 下一步

最后一课:实战收尾——把课上学到的用在"改自己的板子"上。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/esp32/0016-xiaozhi音频流水线/) | [课程目录](/my-blog/posts/esp32/00-总览/) | [下一课 →](/my-blog/posts/esp32/0018-实战改板与加功能/) |