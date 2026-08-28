---
title: 内存Flash与分区表
published: 2026-08-17
description: ESP-IDF 课程第 7 课:分区表 partitions.csv、XIP 与 IRAM、堆与 PSRAM——画出 ESP32 的内存模型地图,理解程序和数据住在哪。
tags: [ESP32, 嵌入式, 内存, Flash, 分区表]
category: ESP32
draft: false
prevTitle: UART与I2C与SPI
prevSlug: "esp32/0008-uart与i2c与spi"
nextTitle: 中断与ISR
nextSlug: "esp32/0006-中断与isr"
---

# 内存、Flash 与分区表

STM32:Flash 从 0x0800 0000 开始,`.text/.data` 由链接脚本摆布,内存就是 SRAM。ESP32 的内存模型复杂一档:**Flash 是"外部"的,程序可以在 Flash 里就地执行(XIP);堆、PSRAM、分区表是三个高频概念**。这一课把地图画出来。

## 知识点 1:分区表(partitions.csv)

Flash 被切成命名分区,固件烧进 `factory/ota` 分区,NVS 有专门分区,文件系统有专门分区。看你的工程:

```csv
# partitions.csv 的一部分
nvs,      data, nvs,     0x9000, 0x6000,
phy_init, data, phy,     0xf000, 0x1000,
factory,  app,  factory, 0x10000, 0x3f0000, # 出厂固件
```

分区表在哪?`sdkconfig` 里 `CONFIG_PARTITION_TABLE_CUSTOM` 指向你的 csv。xiaozhi 用 v2 分区表(4M/8M/16M 多个版本),还分出了 OTA 双区。

## 知识点 2:程序在哪跑(XIP 与 IRAM)

ESP32-S3 的 Flash 支持内存映射:`.text` 默认在 Flash 里"就地执行",**不占 RAM**;只有标注 `IRAM_ATTR` 的函数(中断用的)才驻留 IRAM。RAM 分 DRAM(数据)和 IRAM(代码/中断)。

## 知识点 3:堆与 PSRAM

```c
malloc(1024);                  // 默认堆(内部 RAM)
heap_caps_malloc(1024, MALLOC_CAP_SPIRAM);  // 明确要 PSRAM
```

S3 外挂 8MB PSRAM(你的板子),大内存(音频缓冲、图片)放 PSRAM。看 xiaozhi 代码时你会见到 `heap_caps_malloc` 和 `MALLOC_CAP_*` 的选择。

## 动手实践

在 `basic_routines/00_basic` 里看 `esp_chip_info` 和 `esp_psram` 相关代码,`monitor` 时观察启动日志里 `psram` 行——确认你的板子识别到 8MB PSRAM。再打开 `partitions` 目录的 csv 数一数 xiaozhi 有哪些分区。

## 测验

### 测验 1
普通 .text 代码默认在哪执行?
- A. Flash映射(正确)
- B. SRAM
- C. PSRAM

<details>
<summary>答案与解析</summary>

**答案：A**。Flash 内存映射 XIP,不占 RAM;中断函数才 IRAM_ATTR。
</details>

### 测验 2
明确分配 PSRAM 用哪个 API?
- A. heap_caps_malloc(正确)
- B. malloc
- C. calloc

<details>
<summary>答案与解析</summary>

**答案：A**。heap_caps_malloc + MALLOC_CAP_SPIRAM。
</details>

## 推荐阅读(今天就做)

> **乐鑫官方《内存模型》**([Memory Types](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/memory-types.html))与《分区表》两篇文档,各读前 20 分钟。

## 下一步

下一课:通信总线——UART/I2C/SPI,把 STM32 的 HAL 对应 API 翻译成 IDF。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/esp32/0006-中断与isr/) | [课程目录](/my-blog/posts/esp32/00-总览/) | [下一课 →](/my-blog/posts/esp32/0008-uart与i2c与spi/) |