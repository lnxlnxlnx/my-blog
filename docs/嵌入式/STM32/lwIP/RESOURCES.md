# lwIP 课程资源

## Knowledge

- [《lwIP 开发指南 V1.7》— 正点原子（本地 PDF）](参考文档/lwIP开发指南_V1.7.pdf)
  课程主线教材，29 章：初探/无OS移植/带OS移植/内存管理/netif/pbuf/协议栈内核/ARP/IP/ICMP/RAW API/NETCONN/Socket/NTP/测速/MQTT 上云/HTTP。**用**：每课主讲来源。

- [lwIP 官方文档](https://savannah.nongnu.org/projects/lwip/)
  官方主页与文档（savannah 仓库）。lwIP 版本说明、API 手册入口。**用**：源码与 API 权威核实。

- [lwIP GitHub 镜像](https://github.com/lwip-tcpip/lwip)
  最新 lwIP 源码镜像。教材例程基于 lwIP 2.x（正点原子移植版），查源码时注意版本差异。**用**：源码细节对照。

- [Wireshark](https://www.wireshark.org/)
  免费抓包工具，协议学习神器。**用**：每课实验验证——ARP 请求应答、TCP 三次握手、UDP 收发全部能"看见"。

- [阿里云物联网平台](https://www.aliyun.com/product/iot) 与 [OneNET](https://open.iot.10086.cn/)
  MQTT 上云目标平台。**用**：第 15 课上云实验（需联网环境）。

- [RFC 文档（RFC 791 IP / 792 ICMP / 793 TCP / 826 ARP）](https://www.rfc-editor.org/)
  协议的一手标准。**用**：协议报文结构存疑时查 RFC 原文。

## Wisdom (Communities)

- [开源电子网 / 正点原子论坛](https://www.openedv.com/forum.php)
  正点原子官方论坛，lwIP 移植（DMA 描述符、PHY 配置）疑难杂症聚集地。**用**：工程相关报错。

- [CSDN / 知乎 嵌入式网络话题]
  中文实战经验丰富，但质量参差，只用来找"移植踩坑"线索，原理以教材和 RFC 为准。

- 本地：无（暂不加入线下社区）

## Gaps

- 中文的 lwIP 协议栈逐层源码解析资料较少，本课程的协议原理课（ARP/IP/ICMP/TCP）以教材第 8~13 章 + lwIP 源码为主线，报文结构以 RFC 为准。
- MQTT 上云实验在"仅网线直连"环境不可做，需联网环境补做（手机热点/路由器）。