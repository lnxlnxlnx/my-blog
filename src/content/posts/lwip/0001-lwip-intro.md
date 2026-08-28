---
title: lwIP 初探
published: 2026-08-14
description: TCP/IP 四层模型与封包拆包、lwIP 的实现范围与源码结构、STM32 MAC + LAN8720A 硬件链路。
tags: [lwIP, 嵌入式, 网络, TCP/IP]
category: lwIP
draft: false
prevTitle: 无 OS 移植
prevSlug: "lwip/0002-baremetal-porting"
nextTitle: ""
nextSlug: ""
---

# lwIP 初探

> TCP/IP 分层、lwIP 是什么、源码结构、STM32 以太网硬件链路

**本课目标：**从"裸机单片机"迈入"会联网的嵌入式设备"的第一课。学完你能说清：TCP/IP 四层模型和封包拆包是怎么回事、lwIP 在这个模型里实现了哪些层、它的源码目录怎么逛、以及你的探索者板子上"网口"背后的硬件链路（MAC + PHY）长什么样。这是后面 14 课的骨架。

## 1. TCP/IP 协议栈：网络世界的"四层楼"

两台设备要通信，就像两个人跨国寄信——需要一套大家都遵守的规则。TCP/IP 协议栈就是这套规则的总和，它用**分层**把复杂问题切成四层（正点原子《lwIP 开发指南 V1.7》第 1.1 节 (PDF p.11)）：

| 层次 | 职责 | 典型协议 | 谁实现 |
|------|------|----------|--------|
| 应用层 | 处理具体应用的数据 | HTTP / FTP / MQTT / DNS | 你的代码 + lwIP apps |
| 传输层 | 分段、打包、可靠传输控制 | TCP（可靠）/ UDP（快） | lwIP |
| 网络层 | 决定数据包从源到目的地的路径 | IP / ICMP / ARP | lwIP |
| 网络接口层 | 数据变成物理信号发出去 | 以太网帧 | 硬件（MAC + PHY） |

每一层只跟相邻层打交道：上层把数据"委托"给下层，下层把数据"护送"给对端，再一层层往上交。这就引出了网络通信最经典的过程——**封包与拆包**（PDF 第 1.1.2 节 (PDF p.12)）：

```text
# 发送：每层往下加一个"首部"（信封套信封）
用户数据                     ← 应用层产生
TCP首部 + 用户数据           ← 传输层封装
IP首部 + TCP首部 + 用户数据   ← 网络层封装
MAC首部 + IP首部 + TCP首部 + 用户数据 + MAC尾部  ← 接口层封装成帧

# 接收：每层往上剥一个"首部"，还原出用户数据（拆包）
```

> 💡 记忆锚点：**发送是"套娃"（每层加首部），接收是"剥洋葱"（每层拆首部）**。lwIP 里的 `pbuf` 结构就是用来装这个"洋葱"的（第 6 课会解剖它）。

## 2. lwIP 是什么

lwIP（Lightweight IP）是专为嵌入式系统设计的轻量级 TCP/IP 协议栈（PDF 第 1.2 节 (PDF p.13)）。它的定位一句话：**用十几 KB RAM + 约 40K ROM 换一个相对完整的 TCP/IP 功能**，代价是"应用层不实现"——HTTP、MQTT 这些要你自己写或引入第三方库。

lwIP 与 TCP/IP 体系的对应关系（PDF p.13 图 1.2.1）：

- ✅ **传输层**：TCP（完整实现）+ UDP
- ✅ **网络层**：IP + ARP + ICMP（+ 实验性 IPv6）
- ❌ **网络接口层**：软件实现不了，交给 MCU 的 MAC 内核 + PHY 芯片 + 网卡驱动（`ethernetif.c`）
- ❌ **应用层**：lwIP 只提供接口（RAW/NETCONN/Socket）和少量 apps（HTTP server 等），业务逻辑自己写

这一条很重要：**lwIP 不是"装上就能上网"的魔法，它需要你写好网卡驱动（接口层）和应用代码（应用层）**。第 2、3 课的移植就是在做这件事。

## 3. 源码结构：在哪儿找什么

教材基于 lwIP 2.1.3（PDF 第 1.2.2 节 (PDF p.15)），源码核心在 `src/` 下：

| 目录 | 内容 | 对应课程 |
|------|------|----------|
| `src/core/` | 协议栈内核：ip.c / tcp.c / tcp_in.c / tcp_out.c / udp.c / mem.c / memp.c / pbuf.c / netif.c / timeouts.c | 第 4~12 课 |
| `src/core/ipv4/` | IPv4 模块：arp.c / icmp.c / dhcp.c / igmp.c | 第 7、8 课 |
| `src/api/` | NETCONN / Socket 高层接口 | 第 11、12 课 |
| `src/netif/` | 网卡抽象与驱动骨架（ethernetif.c 模板） | 第 2、3 课 |
| `src/apps/` | 应用层协议：httpd、mqtt、sntp、ping 等 | 第 13~15 课 |
| `src/include/` | 全部头文件 | 随时查 |

> ⚠️ 教材的例程是正点原子"精简移植版"（lwip_comm.c / ethernetif.c / arch 等是改过的），和官方源码目录不完全一样。学习时以教材例程为准，查 API 原型时对照官方 2.1.3。

## 4. 硬件链路：STM32 MAC + LAN8720A PHY

网络接口层靠硬件完成，探索者 F407 的这条链路是（PDF 第 1.3、1.4 节 (PDF p.17/27)）：

```text
CPU (STM32F407)
   └── MAC 内核（片内以太网控制器，IEEE 802.3，10/100M）
        ├── 以太网 DMA（RAM ⇄ FIFO 搬运数据，RX/TX FIFO 各 2KB）
        ├── RMII 接口（MAC ⇄ PHY 的数据通道，7 根线：TX/CRS_DV/RX/CLK…）
        └── MDC/MDIO（站管理接口：MAC 配置 PHY 寄存器的两线通道）
              └── LAN8720A PHY 芯片（物理层：把数字信号变成网线电信号）
                    └── RJ45 网口（带变压器的网络变压器）
```

几个概念先有印象，第 2 课移植时会一一碰上：

- **MAC**（Media Access Control）：STM32 片内的以太网控制器，负责收发以太网帧、做 CRC 校验，地址过滤等
- **PHY**（Physical Layer）：LAN8720A 是物理层芯片，负责编解码、时钟恢复；它由 MDC/MDIO 管理，寄存器可通过 SMI 接口读写
- **RMII vs MII**：MAC 与 PHY 之间的两种接口，探索者用 RMII（线少一半，需要 50MHz 外部时钟）
- **以太网 DMA**：用 DMA 描述符链在内存和 FIFO 之间搬运数据，中断/轮询两种收包模式

## 5. 学习路线图（15 课）

1. **入门与移植**（01~03）：概念 → 无 OS 移植 → 带 FreeRTOS 移植，先 ping 通
2. **协议栈内核**（04~06）：内存管理 / netif / pbuf / 协议栈线程与消息
3. **协议原理**（07~08）：ARP / IP / ICMP 逐层源码
4. **三套编程接口**（09~12）：RAW → NETCONN → Socket，UDP/TCP 各写一遍
5. **应用实战**（13~15）：HTTP/NTP → 测速与抓包 → MQTT 上云

> ⚠️ 你的实验环境是**网线直连电脑**（无路由器）：TCP/UDP 直连实验和 Wireshark 抓包完全可行；MQTT 上云实验（第 15 课）需要外网，届时用手机热点或路由器补做。

## 动手练习

### 练习 1.1：搭建直连实验环境

- 1️⃣ 用网线把探索者开发板网口和电脑网口直连。
- 2️⃣ 电脑网卡配静态 IP：IPv4 手动设置为 `192.168.1.2`，子网掩码 `255.255.255.0`（开发板将用 `192.168.1.10`，后面移植实验会用到）。
- 3️⃣ 安装 [Wireshark](https://www.wireshark.org/)（本课程全程用它抓包验证）。

### 练习 1.2：逛 lwIP 源码

- 1️⃣ 从 [lwIP 官网](https://savannah.nongnu.org/projects/lwip/) 或正点原子光盘获取 lwIP 2.1.3 源码，解压后对照第 3 节表格逛一遍 `src/` 目录。
- 2️⃣ 打开 `src/core/tcp.c`，用搜索看一眼 `tcp_new()` 函数——体会一下协议栈代码的风格（大量结构体 + 宏）。
- 3️⃣ 思考题：为什么 lwIP 的 `netif`（网卡）可以由一块板子有多个？提示：lwIP 支持"多网卡"，每张网卡一个 netif 结构。

## 自测

### 随堂小测 1

**Q1. TCP/IP 四层模型中，TCP 和 IP 分别属于哪层？**

- TCP 网络层、IP 传输层
- TCP 传输层、IP 网络层
- TCP 应用层、IP 接口层

<details>
<summary>查看答案</summary>

B。TCP 负责可靠传输（传输层），IP 负责寻址路由（网络层）（PDF p.11）。

</details>

**Q2. lwIP 软件库实现了哪些层？**

- 应用层和网络接口层
- 只有网络接口层
- 传输层和网络层

<details>
<summary>查看答案</summary>

C。传输层（TCP/UDP）+ 网络层（IP/ARP/ICMP）；接口层靠硬件，应用层自己写（PDF p.13）。

</details>

**Q3. 封包和拆包的本质是？**

- 发送加首部，接收拆首部
- 发送拆首部，接收加首部
- 每层都不动数据

<details>
<summary>查看答案</summary>

A。发送时每层往下加首部（套娃），接收时每层往上剥首部（剥洋葱）（PDF p.12）。

</details>

**Q4. MAC 与 PHY 的关系，正确的说法是？**

- PHY 是片内内核，MAC 是外接芯片
- MAC 在 MCU 内，PHY 是外接芯片，两者用 RMII 相连
- MAC 和 PHY 都在网卡芯片里

<details>
<summary>查看答案</summary>

B。STM32 片内集成 MAC，LAN8720A 是外接 PHY，经 RMII 数据通道 + MDC/MDIO 管理通道连接（PDF p.17/27）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 1 章（PDF p.11~31）——本课全部依据
- 🌐 [lwIP 官网](https://savannah.nongnu.org/projects/lwip/)——下载 lwIP 2.1.3 源码与 contrib 包
- 📕 《计算机网络》（谢希仁/自顶向下）相关章节——TCP/IP 分层与封包拆包的经典教材内容

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 2 课——把 lwIP 无操作系统移植到工程里，第一次 `ping` 通你的开发板，感受"板子上网"的瞬间。

| — | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0002-baremetal-porting/) |