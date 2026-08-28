# Mission: lwIP 网络协议栈（原理 + 三套编程接口 + 物联网上云）

## Why

在 STM32F407 探索者（板载 LAN8720A 网口）上系统掌握 lwIP：既能逐层看懂 ARP/IP/ICMP/TCP 的协议原理与 lwIP 源码，也能熟练使用 RAW / NETCONN / Socket 三套编程接口写网络应用，最后打通 MQTT 上云——把 LVGL 界面、FreeRTOS、lwIP 组合成完整的联网产品。

## Success looks like

- 说清 TCP/IP 分层模型与 lwIP 的对应关系、封包拆包过程
- 完成无 OS 与带 FreeRTOS 两套移植，开发板能 ping 通
- 看懂 pbuf / netif / 内存堆池 / tcpip_thread 的内核机制
- 能独立讲出 ARP 请求应答流程、IP 分片、ICMP 差错报文、TCP 三次握手/四次挥手在 lwIP 中的实现
- 用三套接口各写一遍 UDP 和 TCP 客户端/服务器程序，并理解三者的适用场景与取舍
- 用 Wireshark 抓包验证协议行为（直连电脑即可完成）
- 完成 MQTT 上云实验（阿里云/OneNET），实现远程数据上报与下发

## Constraints

- 教材主线：正点原子《lwIP 开发指南 V1.7》（`参考文档/lwIP开发指南_V1.7.pdf`）
- 硬件：STM32F407 探索者 + 板载 LAN8720A（RMII 接口）
- 实验环境：**仅网线直连电脑**（无路由器）。TCP/UDP/抓包实验全部可行；MQTT 上云需要外网，课程中标注"需联网环境"，可用手机热点或路由器临时替代
- 练习环境：FreeRTOS 分支实验工程（当前分支 EmbedOrigin_4s 不动）；第 2 课无 OS 移植可在独立临时工程进行
- 课程形式：HTML 互动课程，与 LVGL/FreeRTOS 课程同款（行内样式 VSCode Light+ 高亮、三连导航、quiz、真机练习）
- 深度：原理 + 应用并重（用户要求"全都要"）

## Out of scope

- 网络摄像头实验（教材已删除章节）
- lwIP 的移植到其他开发板（阿波罗/北极星/H7）的细节
- SNMP、PPP、DHCP 服务器等高级模块深究
- FreeRTOS+ 的 TCP 协议栈（lwIP 课程以标准 lwIP 为主）