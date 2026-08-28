---
title: UART与I2C与SPI
published: 2026-08-18
description: ESP-IDF 课程第 8 课:UART/I2C/SPI 三大总线的 STM32 HAL 对照翻译,外加 ESP32 特有的"任意引脚映射总线(管脚矩阵)"。
tags: [ESP32, 嵌入式, UART, I2C, SPI]
category: ESP32
draft: false
prevTitle: Wi-Fi与网络
prevSlug: "esp32/0009-wi-fi与网络"
nextTitle: 内存Flash与分区表
nextSlug: "esp32/0007-内存flash与分区表"
---

# UART / I2C / SPI 通信

STM32 的 `HAL_UART_Transmit`、`HAL_I2C_Mem_Read`、`HAL_SPI_Transmit`……IDF 里对应 `uart_`、`i2c_`、`spi_` 系列,且**多半是"先传配置结构体,再收发"**。这一课给出三个总线的对照翻译,外加 ESP32 特有的"任意引脚映射总线(管脚矩阵)"。

## 知识点 1:UART 对照

```c
uart_config_t cfg = {
    .baud_rate = 115200,
    .data_bits = UART_DATA_8_BITS,
    .parity = UART_PARITY_DISABLE,
    .stop_bits = UART_STOP_BITS_1,
    .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
};
uart_param_config(UART_NUM_1, &cfg);
uart_set_pin(UART_NUM_1, TX_PIN, RX_PIN, -1, -1);  // 任意引脚!管脚矩阵
uart_driver_install(UART_NUM_1, 1024 * 2, 0, 0, NULL, 0);
uart_write_bytes(UART_NUM_1, "hello", 5);
```

## 知识点 2:I2C 对照(读寄存器风格)

```c
i2c_master_bus_config_t bus_cfg = { .i2c_port = I2C_NUM_0, .sda_io_num = SDA, .scl_io_num = SCL };
i2c_new_master_bus(&bus_cfg, &bus);
i2c_master_bus_add_device(bus, &dev_cfg, &dev);
i2c_master_transmit_receive(dev, reg, 1, buf, len, -1);  // 写寄存器读数据
```

对照记忆:STM32 的 `HAL_I2C_Mem_Read` ≈ IDF 的 `i2c_master_transmit_receive`(新 driver 风格)。

## 知识点 3:总线的"管脚矩阵"特权

ESP32 的 UART/I2C/SPI 大部分信号**可以映射到任意 GPIO**(S3 部分引脚受限)。这意味着换引脚只改配置、不改硬件设计——xiaozhi 各开发板差异大,全靠这套。

## 动手实践

去 `basic_routines/09_iic_exio`(I2C)和 `12_spilcd`(SPI)看例程:**找出"配置→驱动→读写"三步分别调用了哪几个 API**,写下来。再去 `xiaozhi-esp32-2.2.4/main/boards/bread-compact-wifi/config.h` 看 OLED 的 I2C 引脚定义——体会"引脚可配"。

## 测验

### 测验 1
ESP32 的总线引脚有什么特权?
- A. 任意映射(正确)
- B. 固定分配
- C. 自动扫描

<details>
<summary>答案与解析</summary>

**答案：A**。管脚矩阵,信号可映射到大部分 GPIO。
</details>

### 测验 2
I2C 读寄存器的新 driver 函数是?
- A. i2c_master_transmit_receive(正确)
- B. i2c_read
- C. HAL_I2C_Mem_Read

<details>
<summary>答案与解析</summary>

**答案：A**。i2c_master_transmit_receive,写寄存器地址再读数据。
</details>

## 推荐阅读(今天就做)

> **乐鑫官方 I2C/SPI/UART 驱动文档**([I2C](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/peripherals/i2c.html)):各读"Overview + 例程"即可。

## 下一步

下一课进入网络:Wi-Fi 连接与事件——这是 xiaozhi 的命脉,也是 ESP32 与 STM32 最大的分水岭。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/esp32/0007-内存flash与分区表/) | [课程目录](/my-blog/posts/esp32/00-总览/) | [下一课 →](/my-blog/posts/esp32/0009-wi-fi与网络/) |