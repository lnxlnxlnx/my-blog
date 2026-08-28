---
title: FreeRTOS任务与事件循环
published: 2026-08-13
description: ESP-IDF 课程第 3 课:任务怎么建(xTaskCreate)、任务间怎么传数据(队列)、事件循环(esp_event)是什么——读 xiaozhi 之前必须过的关。
tags: [ESP32, 嵌入式, FreeRTOS, 任务, 事件循环]
category: ESP32
draft: false
prevTitle: GPIO驱动与日志
prevSlug: "esp32/0004-gpio驱动与日志"
nextTitle: 组件与构建系统
nextSlug: "esp32/0002-组件与构建系统"
---

# FreeRTOS 任务与事件循环

STM32 裸机是"一个大循环 + 中断";ESP32 从开机起就有 FreeRTOS 在跑。这一课搞懂三件事:**任务怎么建、任务间怎么传数据、事件循环是什么**——这是读 xiaozhi 之前必须过的关。

## 知识点 1:任务(xTaskCreate)

```c
void task_blink(void *arg) {
    while (1) {
        gpio_set_level(LED_GPIO, 1);
        vTaskDelay(pdMS_TO_TICKS(500));  // 让出 CPU,不是空转
        gpio_set_level(LED_GPIO, 0);
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}
void app_main(void) {
    xTaskCreate(task_blink, "blink", 2048, NULL, 5, NULL);
}
```

和 STM32 的区别:每个任务像"独立的 while(1)",由调度器按优先级/时间片切换。`vTaskDelay` 是"睡觉让位",不是占 CPU 的延时。

## 知识点 2:任务间通信(队列)

裸机里中断改一个全局变量;FreeRTOS 里用**队列**——生产者和消费者解耦,还能在 ISR 里用 `xQueueSendFromISR`:

```c
QueueHandle_t q = xQueueCreate(10, sizeof(int));
xQueueSend(q, &val, 0);              // 任务里发
xQueueReceive(q, &val, portMAX_DELAY);  // 阻塞等
```

## 知识点 3:事件循环(esp_event)

IDF 的"事件循环"是另一种解耦:谁注册监听,谁事后通知。Wi-Fi 连上、断线、OTA 完成……都是事件。xiaozhi 大量使用这个模式。

```c
// 注册监听(启动时)
esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_wifi_event, NULL);
// 事件来了,回调会被调用
static void on_wifi_event(void* arg, esp_event_base_t base, int32_t id, void* data) {
    ESP_LOGI(TAG, "wifi event id=%ld", id);
}
```

## 动手实践

打开 `basic_routines/01_led` 的 `main.c`:**数一数它建了几个任务、用没用队列、有没有事件循环**。把你的发现写下来。

## 测验

### 测验 1
vTaskDelay 和 HAL_Delay 的本质区别?
- A. 让出CPU(正确)
- B. 同样占CPU
- C. 睡眠模式

<details>
<summary>答案与解析</summary>

**答案：A**。vTaskDelay 让出 CPU 给别的任务,裸机 HAL_Delay 是空转。
</details>

### 测验 2
Wi-Fi 连上后,应用层怎么得知?
- A. 事件循环(正确)
- B. 轮询状态
- C. 串口中断

<details>
<summary>答案与解析</summary>

**答案：A**。esp_event 事件循环,注册回调即可。
</details>

## 推荐阅读(今天就做)

> **乐鑫官方《ESP-IDF FreeRTOS 说明》**([FreeRTOS 文档](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/system/freertos.html)):重点看 Task API 和 Queue API 两张表。

## 下一步

下一课回到外设:GPIO 驱动与日志——把 STM32 的 `HAL_GPIO` 彻底翻译成 IDF 的 `gpio_` 系列。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/esp32/0002-组件与构建系统/) | [课程目录](/my-blog/posts/esp32/00-总览/) | [下一课 →](/my-blog/posts/esp32/0004-gpio驱动与日志/) |