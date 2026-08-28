---
title: 测速与抓包分析
published: 2026-08-27
description: lwIP 系列课程第 14 课：用 JPerf / lwiperf 测出板子 TCP/UDP 真实吞吐量，用 Wireshark 亲眼看 ARP、三次握手挥手、UDP 载荷与 IP 分片，掌握高频过滤表达式。
tags: [lwIP, 嵌入式, 网络, JPerf, Wireshark, 测速, 抓包, iperf]
category: lwIP
draft: false
prevTitle: MQTT 物联网上云
prevSlug: "lwip/0015-mqtt-cloud"
nextTitle: HTTP 与 NTP
nextSlug: "lwip/0013-http-and-ntp"
---

# 测速与抓包分析

JPerf 给开发板"跑个分"，Wireshark 把看不见的协议变成看得见的包

**本课目标：**验证前面 13 课的所有理论。学完你能：用 JPerf 测出板子 TCP/UDP 的真实吞吐量并读懂结果（直连环境完全可行）；用 Wireshark 亲眼看到 ARP 请求应答、TCP 三次握手与挥手、UDP 载荷甚至 IP 分片；掌握几个高频过滤表达式，让抓包从"大海捞针"变成"按图索骥"。

## 1. JPerf 网络测速工具：给网络链路"跑分"

开发中掉包、堵塞、延迟抖动，多半是收发速率的问题——如果网速达不到 PHY 芯片的理论上限，就要怀疑代码或配置（教材第 24.1 节 (PDF p.406)）。**JPerf** 是跨平台的网络性能测试工具（支持 Win/Linux/Mac/Android/iOS，基于经典的 iperf），它能：

- ✅ 测**最大 TCP 带宽**：客户端连上服务端，拼命灌数据，统计吞吐
- ✅ 测**最大 UDP 带宽**：按设定速率发包，报告带宽、延迟抖动（jitter）和数据包丢失
- ✅ 可调参数：传输时间 / 字节总量、并发流、TCP 窗口、UDP 包大小（默认 1470 字节）、TTL、ToS 等

JPerf 界面几个关键区（PDF p.406~408）：

| 区域 | 关键项 | 说明 |
|------|--------|------|
| 服务端设置 | Listen Port | 监听端口（默认 5001），可限制客户端数量 |
| 客户端设置 | Server address / Port | 要连的服务器 IP 与端口 |
| 应用层设置 | Transmit / Dual | 按时间或字节量测；Dual 勾选做双向测试 |
| 传输层设置 | TCP 窗口 / UDP 带宽 | TCP 窗口与 MSS；UDP 设定最大带宽和包大小 |
| IP 层设置 | TTL / ToS | 生存时间与服务类型 |
| 显示区 | 折线图 + 文本输出 | 实时速率曲线与最终统计报告 |

> 💡 原理一句话：iperf 就是"一个客户端使劲发、一个服务端使劲收，最后对账"。TCP 模式下靠滑动窗口限速，UDP 模式下按你设定的带宽限速——所以 UDP 测试还能顺便暴露丢包率和抖动，很能说明链路质量。

## 2. 实验：直连环境测 TCP 吞吐

教材第 24.2 节的做法：把 lwIP 的 `lwiperf` 应用（`src/apps/lwiperf`）移植进工程，板子作为 **iperf 服务器**，电脑 JPerf 作为客户端连接并灌流量（(PDF p.408)）。

```c
/* 报告回调：测试结束时打印统计结果（教材 24.2.2.1 节） */
static void lwiperf_report(void *arg,
                           enum lwiperf_report_type report_type,
                           const ip_addr_t *local_addr, u16_t local_port,
                           const ip_addr_t *remote_addr, u16_t remote_port,
                           u32_t bytes_transferred, u32_t ms_duration,
                           u32_t bandwidth_kbitpsec)
{
    printf("-----------------------------------------------\r\n");
    if (report_type < (sizeof(report_type_str)/sizeof(report_type_str[0]))
        && local_addr && remote_addr)
    {
        printf(" %s \r\n", report_type_str[report_type]);   /* 如 TCP_DONE_SERVER */
        printf(" Local address  : %u.%u.%u.%u  Port %d \r\n",
               ((u8_t *)local_addr)[0], ((u8_t *)local_addr)[1],
               ((u8_t *)local_addr)[2], ((u8_t *)local_addr)[3], local_port);
        printf(" Remote address : %u.%u.%u.%u  Port %d \r\n",
               ((u8_t *)remote_addr)[0], ((u8_t *)remote_addr)[1],
               ((u8_t *)remote_addr)[2], ((u8_t *)remote_addr)[3], remote_port);
        printf(" Bytes Transferred %d  Duration (ms) %d \r\n",
               bytes_transferred, ms_duration);
        printf(" Bandwidth (kbitpsec) %d \r\n", bandwidth_kbitpsec);
    }
    else
    {
        printf(" IPERF Report error\r\n");
    }
}

/* 板子作为 iperf 服务器：电脑 JPerf 客户端连过来灌流量 */
void lwip_demo(void)
{
    if (lwiperf_start_tcp_server_default(lwiperf_report, NULL))
    {
        printf("IPERF Server example\r\n");
        printf("IPv4 Address : %u.%u.%u.%u\r\n", lwipdev.ip[0],
               lwipdev.ip[1], lwipdev.ip[2], lwipdev.ip[3]);
    }
    else
    {
        printf("IPERF initialization failed!\r\n");
    }
    while (1) { vTaskDelay(5); }
}
```

下载验证时（PDF p.411）：电脑双击 jperf.bat 打开 JPerf，客户端设置里填板子 IP（`192.168.1.10`）和端口（默认 5001），点 Start——教材实测 **接近 95Mbit/s**，离 100M 的理论值差一点，这是正常的，速率受很多因素影响。

如果你更想让**板子当客户端、电脑当服务端**（比如后面接 MQTT 时板子本来就是客户端角色），用 lwiperf 的客户端启动函数即可，角色对调不影响测速原理：

```c
/* 板子作为 iperf 客户端：主动连接电脑上的 JPerf 服务端 */
void lwip_demo(void)
{
    ip_addr_t server_ip;

    IPADDR4_ADDR(&server_ip, 192, 168, 1, 2);   /* 电脑 JPerf 服务端 IP */

    /* 启动 TCP 客户端测速，连到电脑 5001 端口，结果由 lwiperf_report 报告 */
    lwiperf_start_tcp_client_default(&server_ip, 5001, lwiperf_report, NULL);

    while (1) { vTaskDelay(5); }
}
```

> 💡 两个方向都要会：**板子当服务器**验证"板子能扛住流入流量"（对应设备被云端/上位机灌数据）；**板子当客户端**验证"板子能喷出满带宽"（对应设备主动上报）。直连环境两种都能测，把数据记录下来对比。

## 3. Wireshark 深度抓包：直连环境的"放大镜"

测速只给了结论，抓包才能看过程。直连环境下（板子 192.168.1.10 ⇄ 电脑 192.168.1.2），Wireshark 捕获的是纯净的局域网流量，非常利于分析。四大必看场景：

### 3.1 ARP 请求与应答

电脑要发包给板子，先得知道板子 MAC。广播"谁是 192.168.1.10？"→ 板子单播回"我是，我的 MAC 是 xx:xx:xx:xx:xx:xx"。过滤 `arp` 就能看到这对问答。

### 3.2 TCP 三次握手与挥手

握手：`SYN` → `SYN+ACK` → `ACK`；挥手：`FIN+ACK` → `ACK` → `FIN+ACK` → `ACK`（教材第 12 章 TCP 源码讲过的状态机，在这里变成活生生的包）。过滤 `tcp.port==5001` 只看测速连接。

### 3.3 UDP 载荷

选中一个 UDP 包，在下方"数据字节"窗口能看到原始载荷——比如第 12 课发的字符串、第 13 课 NTP 的 0x1B 报文。过滤 `udp` 或 `udp.port==8080`。

### 3.4 IP 分片

以太网帧最大 1514 字节（含首部），MTU 1500。如果你一次 UDP 发送超过约 1472 字节载荷，IP 层就会把它切成多个分片，抓包里能看到 `Fragmented IP protocol` 标记和 `More fragments` 标志——这是验证"MTU 边界"最直观的方式。

## 4. 分析技巧：高频过滤表达式

| 过滤表达式 | 作用 |
|-----------|------|
| `arp` | 只看 ARP 请求应答，排查二层连通 |
| `tcp.port==5001` | 只看指定端口的 TCP 流量，如 iperf / 调试 |
| `ip.src==192.168.1.10` | 只看板子发出的包 |
| `ip.dst==192.168.1.10` | 只看发给板子的包 |
| `tcp.flags.syn==1` | 只看握手 SYN，快速定位连接建立 |
| `tcp.flags.fin==1` | 只看挥手 FIN，定位连接关闭 |
| `udp` | 只看 UDP 流量（NTP、广播、自定义协议） |
| `icmp` | 只看 ping 的请求应答，顺手验通链路 |

> ⚠️ 抓包别用错网卡：电脑上如果有无线网卡和有线网卡，一定要选**连着开发板的那个有线网卡**开始捕获，否则什么都抓不到。另外 Wireshark 默认不带管理员权限时可能抓不了包，Win 上请以管理员身份运行。

## 动手练习（约 40 分钟）

### 练习 14.1：JPerf 测 TCP 吞吐（直连可行）

- 1️⃣ 移植 lwiperf 应用进工程，按第 2 节代码启动服务器（或客户端）角色。
- 2️⃣ 电脑打开 JPerf，客户端模式填板子 IP `192.168.1.10`、端口 5001，测 10 秒。
- 3️⃣ 记录带宽值，和理论 100M 对比；再换板子当客户端的角色测一次，对比两个方向。
- 4️⃣ 思考：为什么实测很难到 100M？提示：TCP 窗口、MSS、中断开销、MCU 处理速度。

### 练习 14.2：Wireshark 抓三次握手（直连可行）

- 1️⃣ 管理员身份开 Wireshark，选有线网卡开始抓包。
- 2️⃣ 电脑用网络调试助手连板子的 TCP 服务器（如 8081 端口），观察 `SYN → SYN+ACK → ACK` 三包；断开后观察 `FIN/ACK` 挥手。
- 3️⃣ 过滤 `arp` 看一次地址解析过程；再用 `ip.src==192.168.1.10` 检查板子发出的所有流量。
- 4️⃣ 挑战：写个循环发 2000 字节的 UDP 报，抓包看 IP 分片（提示：会看到两个分片包）。

## 自测（答完再点答案）

### 随堂小测 1

Q1. JPerf 的 TCP 测试模式测的是？

- A. 指定速率下 UDP 的丢包率
- B. 尽力传输时 TCP 的最大吞吐
- C. 局域网里 ARP 的响应时间

<details>
<summary>查看答案</summary>

B。TCP 模式客户端拼命灌数据测最大吞吐；UDP 模式才测丢包与抖动（PDF p.406）。

</details>

### 随堂小测 2

Q2. 板子收到 SYN 后，正常应回什么？

- A. 直接回复 ACK，不带 SYN
- B. 回复 SYN+ACK，再等对方 ACK
- C. 回复 FIN，主动关闭连接

<details>
<summary>查看答案</summary>

B。三次握手第二包是 SYN+ACK，最后一包 ACK 由发起方发出（本课第 3 节）。

</details>

### 随堂小测 3

Q3. 想看板子发出去的所有包，过滤表达式？

- A. ip.src==192.168.1.10
- B. ip.dst==192.168.1.10
- C. tcp.port==5001

<details>
<summary>查看答案</summary>

A。src 是源地址；dst 看发给板子的；C 只过滤特定端口（本课第 4 节）。

</details>

### 随堂小测 4

Q4. 一次发送 2000 字节 UDP 数据，抓包会看到？

- A. 一个完整包，长度 2000 字节
- B. 两个 IP 分片，因超过 MTU 1500
- C. 包被直接丢弃，无任何痕迹

<details>
<summary>查看答案</summary>

B。超过 MTU（1500 字节）的 IP 报文被切成多个分片（本课第 3.4 节）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 24 章（PDF p.406~412）——本课全部依据
- 🌐 [iperf.fr 官网](https://iperf.fr/iperf-download.php)——JPerf / iperf 下载与文档
- 📕 lwIP 2.1.3 源码 `src/apps/lwiperf/lwiperf.c`——测试协议与报告实现
- 📘 《Wireshark 网络分析就这么简单》——抓包思路与过滤语法速成

## 下一步

有问题随时问我。下一课预告：第 15 课——MQTT 物联网上云，也是本课程的收官一课：用发布/订阅模型把板子接进阿里云 / OneNET，同时讲清直连环境下怎么用本地 mosquitto 先跑通全流程。

| [← 上一课](/my-blog/posts/lwip/0013-http-and-ntp/) | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0015-mqtt-cloud/) |
