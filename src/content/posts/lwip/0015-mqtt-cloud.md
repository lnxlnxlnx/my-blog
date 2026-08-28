---
title: MQTT 物联网上云
published: 2026-08-28
description: lwIP 系列课程收官课：MQTT 发布/订阅模型、QoS 0/1/2 与 CONNECT/PUBLISH/SUBSCRIBE 报文、lwIP MQTT 客户端（paho 移植）、阿里云三元素认证与 OneNET token 鉴权，以及直连环境下用本地 mosquitto 跑通全流程。
tags: [lwIP, 嵌入式, 网络, MQTT, 物联网, 阿里云, OneNET, mosquitto]
category: lwIP
draft: false
prevTitle: ""
prevSlug: ""
nextTitle: 测速与抓包分析
nextSlug: "lwip/0014-bandwidth-and-packet-analysis"
---

# MQTT 物联网上云

发布/订阅模型、paho 移植、阿里云三元素认证、OneNET 接入，以及直连环境下的 mosquitto 本地替代

**本课目标：**课程收官课。学完你能：说清 MQTT 的发布/订阅模型、主题、QoS 0/1/2 和 CONNECT/PUBLISH/SUBSCRIBE 报文；看懂 lwIP 自带 MQTT 客户端（源自 paho 移植）怎么接；明白阿里云三元素认证（ProductKey / DeviceName / DeviceSecret）和 OneNET 的 token 鉴权。同时诚实面对约束：**上云需要外网，直连环境做不了**——本课手把手带你在电脑上装 mosquitto 当本地 broker，先在 `192.168.1.2:1883` 上把"发布/订阅"全流程跑通，联网后换个 broker 地址即可平滑上云。

## 1. MQTT 协议简介：为物联网而生的轻量消息协议

MQTT（Message Queuing Telemetry Transport，消息队列遥测传输协议）是**基于发布/订阅（Publish/Subscribe）模式的轻量级通讯协议**，构建于 TCP/IP 之上，由 IBM 在 1999 年发布，最新版本 v3.1.1（教材第 25.1 节 (PDF p.413)）。它的卖点：**极少的代码和有限的带宽，为远程设备提供实时可靠的消息服务**——特别适合 M2M 通信、卫星链路传感器、医疗设备、智能家居等受限环境。

协议里有三种身份（PDF p.413）：

- **发布者（Publish）**：产生消息的客户端（如你的开发板）
- **代理（Broker）**：服务器，负责消息中转（如阿里云 / OneNET / 本地 mosquitto）
- **订阅者（Subscribe）**：消费消息的客户端（可以是另一台设备、App）

消息分两部分：**Topic（主题）**是消息的类型标签，订阅者订阅主题后就会收到该主题的消息；**Payload（载荷）**是消息的具体内容。注意：MQTT 是**异步通信**——发布者把消息丢给 broker 就完事，broker 再决定怎么推给订阅者，不是端到端立即响应。

> 💡 快递员比喻：broker 是快递中转站，Topic 是地址标签，订阅者提前"订了"这个地址，快递一到就被派送。发布者完全不用知道订阅者是谁、在哪——这就是解耦。

## 2. QoS 等级与关键报文

**QoS（服务质量）**决定消息投递的可靠性（教材 25.1.1 节 (PDF p.415)）：

| QoS | 含义 | 可靠性 | 系统压力 |
|-----|------|--------|---------|
| 0 | 至多一次：broker 转发一次，不确认 | 可能丢 | 最小 |
| 1 | 至少一次：保证双方收到，可能重复 | 不丢但可能重复 | 较大 |
| 2 | 只有一次：保证收到且只收到一次 | 最可靠 | 最大 |

会话由一串报文驱动（PDF p.414~415）：

| 报文 | 方向 | 作用 |
|------|------|------|
| `CONNECT` | 客户端 → broker | 发起连接：携带客户端 ID、账号密码、心跳间隔、遗嘱消息 |
| `CONNACK` | broker → 客户端 | 连接确认（允许 / 拒绝） |
| `SUBSCRIBE` | 客户端 → broker | 订阅主题（带 QoS） |
| `SUBACK` | broker → 客户端 | 订阅确认 |
| `PUBLISH` | 客户端 ⇄ broker | 发布消息；QoS 1/2 还有 PUBACK/PUBREC/PUBCOMP 确认链 |
| `PINGREQ/PINGRESP` | 客户端 ⇄ broker | 心跳保活，broker 据此判断设备是否掉线 |

## 3. 移植 lwIP 的 MQTT 客户端（源自 paho）

lwIP 官方在 `src/apps/mqtt` 提供现成的 MQTT 客户端 `mqtt.c`——它正是**基于 Eclipse Paho MQTT 客户端库移植**而来的，lwIP 2.1.3 里直接可用。教材 25.1.2 的移植步骤（(PDF p.416)）：

1. 把 `lwip\src\apps\mqtt` 路径下的 `mqtt.c` 添加进工程（放 `Middlewares/lwip/src/apps` 分组）
2. 在 `lwip_app` 分组添加 `hmac_sha1` 和 `sha1` 文件（阿里云官方下载）——用来计算认证密钥
3. 配置 `LWIP_MQTT` 宏使能 MQTT 应用

连接的核心 API（lwIP 2.1.3 官方接口）：

```c
/* 创建客户端控制块 */
struct mqtt_client *mqtt_client_new(void);

/* 连接 broker：IP + 端口 + 回调 + 客户端信息 */
err_t mqtt_client_connect(struct mqtt_client *client,
                          const ip_addr_t *ip_addr, u16_t port,
                          mqtt_connection_cb_t cb, void *arg,
                          const struct mqtt_connect_client_info_t *client_info);

/* 订阅主题 */
err_t mqtt_subscribe(struct mqtt_client *client, const char *topic,
                     u8_t qos, mqtt_request_cb_t cb, void *arg);

/* 发布消息 */
err_t mqtt_publish(struct mqtt_client *client, const char *topic,
                   const void *payload, u16_t payload_length,
                   u8_t qos, u8_t retain,
                   mqtt_request_cb_t cb, void *arg);

/* 注册"收到发布"回调 */
void mqtt_set_inpub_callback(struct mqtt_client *client,
                             mqtt_incoming_publish_cb_t pub_cb,
                             mqtt_incoming_data_cb_t data_cb, void *arg);
```

> ⚠️ 移植别漏关键一环：MQTT 建立在 **TCP 之上**，所以板子先得具备第 12 课的 TCP 客户端能力；同时域名要转 IP——例程里用 `gethostbyname()` 解析阿里云域名，直连环境下 DNS 不可用，这也是直连跑不了上云实验的原因之一。

## 4. 阿里云接入：三元素认证

阿里云物联网平台用**三元素**唯一标识一台设备：**ProductKey（产品密钥）、DeviceName（设备名称）、DeviceSecret（设备密钥）**（教材 25.1.3 节 (PDF p.416~418)）。在平台上"新建产品 → 添加设备"后，就能拿到这三个参数，非常重要。

例程把它们换算成 MQTT 的 CONNECT 报文（教材 25.2.2.3 节 (PDF p.420~422)）：

```c
/* lwIP 连接阿里云：解析域名、计算密码、配置客户端信息 */
void lwip_demo(void)
{
    struct hostent *server;
    static struct mqtt_connect_client_info_t mqtt_client_info;
    char *PASSWORD;

    /* 1. DNS 解析阿里云域名 → IP */
    server = gethostbyname((char *)HOST_NAME);
    memcpy(&mqtt_ip, server->h_addr, server->h_length);

    /* 2. 用 hmac_sha1(DeviceSecret, 签名内容) 算出 password */
    PASSWORD = mymalloc(SRAMIN, 300);
    lwip_ali_get_password(DEVICE_SECRET, CONTENT, PASSWORD);

    /* 3. 配置 MQTT 客户端信息（三元素在此登场） */
    memset(&mqtt_client_info, 0, sizeof(mqtt_client_info));
    mqtt_client_info.client_id   = (char *)CLIENT_ID;   /* 设备名称 */
    mqtt_client_info.client_user = (char *)USER_NAME;   /* 产品 ID */
    mqtt_client_info.client_pass = (char *)PASSWORD;    /* 计算出的密码 */
    mqtt_client_info.keep_alive  = 100;                 /* 心跳保活秒数 */
    mqtt_client_info.will_msg = NULL;   /* 遗嘱消息，本例不启用 */

    /* 4. 创建客户端并连接服务器 */
    mqtt_client = mqtt_client_new();
    mqtt_client_connect(mqtt_client, &mqtt_ip, MQTT_PORT,
                        mqtt_connection_cb,            /* 连接回调 */
                        LWIP_CONST_CAST(void*, &mqtt_client_info),
                        &mqtt_client_info);

    while (1)
    {
        /* 5. 连接成功后每秒发布一次温湿度数据 */
        if (publish_flag == 1)
        {
            temp  = 30 + rand() % 10 + 1;
            humid = 54.8 + rand() % 10 + 1;
            sprintf((char *)payload_out,
                    "{\"params\":{\"CurrentTemperature\":%0.1f,"
                    "\"RelativeHumidity\":%0.1f},"
                    "\"method\":\"thing.event.property.post\"}",
                    temp, humid);
            payload_out_len = strlen((char *)payload_out);
            mqtt_publish(mqtt_client, DEVICE_PUBLISH, payload_out,
                         payload_out_len, 1, 0, mqtt_publish_request_cb, NULL);
        }
        vTaskDelay(1000);
    }
}

/* 连接回调：连上后订阅下行主题 */
static void mqtt_connection_cb(mqtt_client_t *client, void *arg,
                               mqtt_connection_status_t status)
{
    err_t err;
    if (status == MQTT_CONNECT_ACCEPTED)     /* 连接被接受 */
    {
        if (mqtt_client_is_connected(client))
        {
            /* 注册收到发布的回调 */
            mqtt_set_inpub_callback(mqtt_client,
                                    mqtt_incoming_publish_cb,
                                    mqtt_incoming_data_cb, NULL);
            /* 订阅服务器下行主题，QoS 1 */
            err = mqtt_subscribe(client, DEVICE_SUBSCRIBE, 1,
                                 mqtt_request_cb, arg);
        }
    }
    else
    {
        printf("Disconnected, reason: %d\n", status);
    }
}
```

教材 25.2.2.1 总结的配置步骤（(PDF p.419)）：① 配置 MCU 为 TCP 客户端 → ② `gethostbyname` 解析域名 → ③ `mqtt_client_connect` 连接 → ④ 连接成功后订阅/发布 → ⑤ 循环每秒发布数据。下载验证时，打开阿里云平台页面就能看到设备上报的温湿度曲线（PDF p.423）。

## 5. OneNET 接入：token 鉴权（第 26 章）

OneNET（中移动物联网平台）流程类似，差别在**鉴权方式**（教材第 26 章 (PDF p.425~430)）：

1. 平台侧：注册账号 → 创建产品（物模型选 OneJSON / 数据流选数据流）→ 添加设备 → 拿到**产品 ID、设备名称、设备 key**
2. 密钥计算：OneNET 用 **token 算法**（res 格式 `products/{pid}/devices/{device_name}` + 过期时间 et + 设备 key）算出核心密钥，存进 `client_pass`——注意它和阿里云的 hmac_sha1 算法不同，不能混用（教材 26.2 节 (PDF p.428)）
3. 工程侧：从 OneOS 源码 `components/cloud/onenet/mqtt-kit/authorization` 复制 token 计算文件进工程，其余连接流程与阿里云例程几乎一致

> 💡 阿里云 vs OneNET 一表记：认证三元素不同（PK/DN/DS vs 产品ID/设备名/key），密码算法不同（hmac_sha1 vs token），但 MQTT 连接、订阅、发布的代码骨架完全一样——学会一个，另一个只换"钥匙"。

## 6. 实验：上云需联网，直连先用 mosquitto 跑通全流程

> ⚠️ **直连环境的现实约束**：阿里云 / OneNET 的 broker 在公网，直连环境没有外网出口，`gethostbyname` 也解析不了域名。所以"板子上云"现在做不了，需要联网环境（**手机热点 / 路由器**）。但别空手——下面这个直连替代方案，能让你完整体验 MQTT 发布/订阅全流程。

**直连替代方案：本地 mosquitto broker（完全可行）**

1. 电脑安装 [mosquitto](https://mosquitto.org/download/)（Windows 版），启动后默认监听 `1883` 端口（局域网内可匿名连接）
2. 把板子例程里的 broker 地址改成电脑 IP `192.168.1.2`、端口 1883，关闭账号密码与算法计算（本地 broker 匿名）
3. 电脑上再用一个 MQTT 客户端工具（如 [MQTTX](https://mqttx.app/) 或 mosquitto 自带的 `mosquitto_sub` / `mosquitto_pub`）订阅板子的主题，就能看到板子每秒发布的温湿度 JSON；用工具反向发布一条消息，板子回调里也能收到

```c
/* 直连替代：板子连本地 mosquitto（192.168.1.2:1883），匿名即可 */
void lwip_demo(void)
{
    static struct mqtt_connect_client_info_t mqtt_client_info;

    /* 本地 broker 不需要域名解析，直接用 IP 字面量 */
    IPADDR4_ADDR(&mqtt_ip, 192, 168, 1, 2);
    mqtt_port = 1883;

    memset(&mqtt_client_info, 0, sizeof(mqtt_client_info));
    mqtt_client_info.client_id   = "stm32f407_board";  /* 任意唯一 ID */
    mqtt_client_info.client_user = NULL;               /* 本地匿名，免认证 */
    mqtt_client_info.client_pass = NULL;
    mqtt_client_info.keep_alive  = 60;

    mqtt_client = mqtt_client_new();
    mqtt_client_connect(mqtt_client, &mqtt_ip, mqtt_port,
                        mqtt_connection_cb,
                        LWIP_CONST_CAST(void*, &mqtt_client_info),
                        &mqtt_client_info);

    while (1)
    {
        if (publish_flag == 1)
        {
            sprintf((char *)payload_out, "{\"temp\":%0.1f,\"humid\":%0.1f}",
                    temp, humid);
            mqtt_publish(mqtt_client, "stm32/dev/data", payload_out,
                         strlen((char *)payload_out), 1, 0,
                         mqtt_publish_request_cb, NULL);
        }
        vTaskDelay(1000);
    }
}
```

**联网后补做**：手机开热点或接路由器 → broker 地址换回阿里云 / OneNET → 恢复三元素认证与密码计算 → 平台网页上看数据曲线。代码骨架一行都不用重写，只换"连接信息"和"主题"。这正是 MQTT 的优雅之处：**协议不变，换个 broker 就是换个家**。

## 动手练习（约 40 分钟）

### 练习 15.1：本地 mosquitto 全流程（直连可行）

- 1️⃣ 电脑安装并启动 mosquitto，确认监听 1883 端口（`netstat -an | findstr 1883`）。
- 2️⃣ 按第 6 节代码改板子例程（broker = 192.168.1.2，匿名），编译下载。
- 3️⃣ 电脑用 MQTTX（或 mosquitto_pub/sub）订阅主题 `stm32/dev/data`，确认每秒收到温湿度 JSON；再用工具往订阅主题发消息，看板子回调收到数据。

### 练习 15.2：上云预备与补做清单

- 1️⃣ 现在就在阿里云物联网平台注册、创建产品、添加设备，把 ProductKey / DeviceName / DeviceSecret 抄下来（不联网也能注册，只需手机验证码）。
- 2️⃣ 在 OneNET 平台做同样的事，体验两种平台的配置差异。
- 3️⃣ 联网后：板子接热点/路由器，恢复三元素认证，观察平台上出现数据曲线；把截图作为本课成果。

## 自测（答完再点答案）

### 随堂小测 1

Q1. MQTT 消息在发布者和订阅者之间如何传递？

- A. 发布者直接单播给每个订阅者
- B. 经 broker 中转，按主题分发
- C. 通过广播地址发送到全网

<details>
<summary>查看答案</summary>

B。broker 是消息代理，发布/订阅双方完全解耦（PDF p.413）。

</details>

### 随堂小测 2

Q2. QoS 1（至少一次）的特点是什么？

- A. 可能丢失，系统压力最小
- B. 保证送达，但可能重复
- C. 保证送达且只送达一次

<details>
<summary>查看答案</summary>

B。QoS 1 保证收到但可能重复；QoS 0 可能丢；QoS 2 唯一一次（PDF p.415）。

</details>

### 随堂小测 3

Q3. 阿里云设备认证的三元素是？

- A. IP 地址、端口、MAC 地址
- B. ProductKey、DeviceName、DeviceSecret
- C. 账号、密码、验证码

<details>
<summary>查看答案</summary>

B。三元素唯一标识设备，密码由 DeviceSecret 经 hmac_sha1 计算（PDF p.416~418）。

</details>

### 随堂小测 4

Q4. 直连环境下想跑通 MQTT 全流程，正确做法？

- A. 板子直连电脑，直接连阿里云 broker
- B. 电脑装 mosquitto 当本地 broker 模拟
- C. 改用 HTTP 协议代替 MQTT 上云

<details>
<summary>查看答案</summary>

B。本地 mosquitto（192.168.1.2:1883）跑通发布/订阅，联网后换 broker 地址（本课第 6 节）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 25 章（PDF p.413~424）、第 26 章（PDF p.425~430）——本课全部依据
- 🌐 [mosquitto 官网](https://mosquitto.org/)——本地 broker 下载；[MQTTX](https://mqttx.app/)——跨平台调试客户端
- 📕 lwIP 2.1.3 源码 `src/apps/mqtt/mqtt.c`——基于 Eclipse Paho 移植的 MQTT 客户端实现
- 📘 阿里云物联网平台 / OneNET 开发者文档——产品创建、设备接入与主题规范

## 下一步

15 课全部完结，恭喜走到这里！🎉 从裸机移植到 Socket，从 HTTP/NTP 到 MQTT 上云，你已经走完了"让开发板真正联网"的全链路。有任何不清楚的地方，随时问我（Agent 就是你的老师）。接下来推荐动手方向：把板子的真实传感器数据接进 MQTT 上报、用 Wireshark 复盘一遍 MQTT 报文、或者试试 lwIP 的 DHCP 自动获取 IP。

| [← 上一课](/my-blog/posts/lwip/0014-bandwidth-and-packet-analysis/) | [课程目录](/my-blog/posts/lwip/00-总览/) | |
