---
title: xiaozhi 板级抽象 boards/
published: 2026-08-25
description: xiaozhi 支持 70+ 开发板靠的是板级抽象:一个板 = config.json + config.h + board.cc 三个文件,换屏改引脚不动业务代码。
tags: [ESP32, 嵌入式, xiaozhi, 板级抽象]
category: ESP32
draft: false
prevTitle: xiaozhi 音频流水线
prevSlug: "esp32/0016-xiaozhi音频流水线"
nextTitle: xiaozhi 启动流程
nextSlug: "esp32/0014-xiaozhi启动流程"
---

# xiaozhi 板级抽象 boards/

这是 ESP-IDF 课程系列笔记的第 15 课(预计 20 分钟)。xiaozhi 支持 70+ 开发板,靠的不是 70 份 if-else,而是**板级抽象**:每块板一个目录,统一暴露"初始化接口"。这一课把你的面包板组合板拆开看——这也是"换屏/换引脚"教程的地基。

## 知识点 1:一个板 = 三个文件

```text
boards/bread-compact-wifi/
├── config.json        # 目标芯片 + 出几种固件 + sdkconfig 追加项
├── config.h           # 引脚/分辨率/镜像等板级宏
└── compact_wifi_board.cc  # 开机初始化:屏幕/喇叭/按键/网络
```

## 知识点 2:config.json 决定"出什么固件"

```json
{
  "target": "esp32s3",
  "builds": [{
    "name": "bread-compact-wifi",
    "sdkconfig_append": ["CONFIG_OLED_SSD1306_128X32=y"]
  }]
}
```

还记得咱们把 `CONFIG_OTA_URL` 加在这里吗?这就是"用配置出固件"的入口。同一块板要出"0.91 屏版 + 0.96 屏版"就加两个 build。

## 知识点 3:config.h 决定"引脚长什么样"

```c
// config.h 里的典型定义
#define DISPLAY_SDA_PIN  41
#define DISPLAY_SCL_PIN  42
#define DISPLAY_MIRROR_X false
```

换屏、改引脚、屏幕方向不对——改这里,不动业务代码。

## 动手实践

打开 `main/boards/bread-compact-wifi/config.h`,**列出这块板的:屏幕引脚、喇叭引脚、按键引脚、麦克风引脚**。再对比 `main/boards/common/` 下共用的初始化代码,体会"公共 vs 板级"的边界。

## 测验

### 测验 1
改屏幕 I2C 引脚去哪个文件?
- A. config.h(正确)
- B. config.json
- C. application.cc

<details>
<summary>答案与解析</summary>

**答案：A**。config.h,引脚/分辨率都在这。
</details>

### 测验 2
同一块板出两种屏的固件靠什么?
- A. builds变体(正确)
- B. 复制代码
- C. 宏开关

<details>
<summary>答案与解析</summary>

**答案：A**。config.json 里加 build 变体。
</details>

## 推荐阅读

> **xiaozhi 官方《custom-board.md》**([docs/custom-board.md](https://github.com/78/xiaozhi-esp32/blob/main/docs/custom-board.md)):照着做一遍,你就能加自己的板。

## 下一步

下一课:音频流水线——声音怎么从麦克风进、从喇叭出。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/esp32/0014-xiaozhi启动流程/) | [课程目录](/my-blog/posts/esp32/00-总览/) | [下一课 →](/my-blog/posts/esp32/0016-xiaozhi音频流水线/) |