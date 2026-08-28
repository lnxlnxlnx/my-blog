---
title: HTTP 与 NTP
published: 2026-08-26
description: lwIP 系列课程第 13 课：HTTP 请求/响应结构、lwIP httpd 与手写 netconn Web Server、CGI/SSI 动态网页技术、NTP 报文结构与时间戳解析，以及直连环境下 NTP 的替代方案与联网补做清单。
tags: [lwIP, 嵌入式, 网络, HTTP, NTP, Web Server, CGI, SSI]
category: lwIP
draft: false
prevTitle: 测速与抓包分析
prevSlug: "lwip/0014-bandwidth-and-packet-analysis"
nextTitle: Socket 编程接口
nextSlug: "lwip/0012-socket-api"
---

# HTTP 与 NTP

让浏览器打开开发板的网页、让板子告诉你"现在几点"——两个最常用的应用层协议

**本课目标：**从"自己收发数据"升级到"跑真实的应用协议"。学完你能：看懂一个 HTTP 请求/响应长什么样，用 lwIP 的 httpd 或手写 TCP 80 端口把开发板变成网页服务器（直连环境电脑浏览器直接访问）；理解 NTP 报文结构，能把 UDP 请求发往时间服务器并解析出时间戳。同时诚实面对一个现实——**NTP 服务器在外网，你的直连环境做不了真实验证**，本课会给你直连替代方案和联网后的补做清单。

## 1. HTTP 协议简介：浏览器与服务器的"对话协议"

HTTP（Hyper Text Transfer Protocol，超文本传输协议）是从万维网服务器把超文本传到本地浏览器的传送协议（教材第 29.1 节 (PDF p.431)）。几个关键特性：

- ✅ **无状态**：服务器不保留与客户交易时的任何状态，减轻记忆负担，换快速响应
- ✅ **面向对象**：允许传任意类型的数据对象，通过数据类型和长度标识内容
- ✅ 工作方式：浏览器通过 **TCP/IP** 与服务器（默认端口 80）建立连接后交换数据

HTTP 定义了三种基本方法（PDF p.431）：

| 方法 | 作用 | 本课用途 |
|------|------|---------|
| `GET` | 从服务端获取数据 | 浏览器打开页面、获取状态 |
| `POST` | 向服务器传送数据 | 网页表单提交，控制 LED / BEEP |
| `HEAD` | 检测对象是否存在 | 调试辅助 |

一个 GET 请求的样子大致是：首行是"请求行"（方法 + 路径 + 版本），后面跟若干"首部"行，空行后是可选的"正文"；服务器回一个"状态行"（如 `HTTP/1.1 200 OK`）加响应头加网页正文。浏览器就是靠这些明文文本和服务器对话的。

> 💡 抓包视角：用 Wireshark 过滤 `http` 就能看到完整的请求行、首部和响应，比读十页书都直观——本课第 14 课会正式教抓包，你现在就可以先用起来。

## 2. Web Server 原理：RAW 版把网页"烧"进芯片

教材第 14 章在 ST 官方 Web Server 例程基础上完成实验（(PDF p.339)）。核心思路：**开发板的空间放不下"网页文件"，那就用 makefsdata 工具把网页转成 C 语言数组，随固件一起烧进 Flash**。

| 文件 | 作用 |
|------|------|
| `fs.c / fs.h` | 管理生成的网页数组（文件系统抽象） |
| `fsdata.c / fsdata.h` | 网页内容转成的 C 数组（由 makefsdata 工具生成） |
| `httpd.c` | HTTP 服务器核心源码，把板子配置成 Web Server |
| `httpd_structs.h` | HTTPD 协议的结构体定义 |

两条"老牌"网页技术在这里登场（PDF p.343）：

- **CGI（公共网关接口）**：服务器执行外部程序并把结果发给浏览器。本例用 `leds.cgi` 之类的 URL 触发对 LED、蜂鸣器的控制，让网页"可交互"
- **SSI（服务器端嵌入）**：在网页源码里嵌入指令，如 `<!--#include file="info.htm"-->`，服务器发送前先把动态内容（ADC、内部温度、RTC 值）填充进去

```c
/* 使用 lwIP 官方 httpd 应用搭建 Web Server（教材第 14 章） */
#include "httpd.h"
#include "httpd_cgi_ssi.h"

void lwip_demo(void)
{
    httpd_init();        /* 初始化 HTTP 服务器，默认监听 80 端口 */
    httpd_ssi_init();    /* 配置 SSI：网页里动态填入 ADC/温度/RTC 值 */
    httpd_cgi_init();    /* 配置 CGI：网页表单触发 LED/BEEP 动作 */
}
```

这一步直连环境就能体验：烧录例程后，电脑浏览器地址栏输入 `192.168.1.10` 回车，就能看到网页并勾选控制板子上的外设。

## 3. 手写 HTTP 服务器：netconn 版更透明的"教学版"

第 14 章用的是网页数组（高度封装），教材第 29 章换了个更透明的做法：用 **netconn 接口手写一个 TCP 服务器监听 80 端口**，收到浏览器请求后，用字符串直接拼出网页发回去（(PDF p.432)）。这能让你看穿 HTTP 的本质：**无非是一个固定格式的文本流，先收请求、按关键字判断、再回发内容**。

```c
/* HTTP 服务器主循环：netconn 接口，监听 80 端口（教材第 29 章） */
void lwip_demo(void)
{
    struct netconn *conn, *newconn;
    err_t err;

    /* 创建 TCP 连接句柄，绑定 80 端口（HTTP 默认端口） */
    conn = netconn_new(NETCONN_TCP);
    netconn_bind(conn, IP_ADDR_ANY, 80);

    /* 进入监听状态 */
    netconn_listen(conn);

    do
    {
        /* 等待并接受一个浏览器连接 */
        err = netconn_accept(conn, &newconn);
        if (err == ERR_OK)
        {
            lwip_server_netconn_serve(newconn);  /* 处理一次 HTTP 请求 */
            netconn_delete(newconn);
        }
    } while (err == ERR_OK);

    netconn_close(conn);
    netconn_delete(conn);
}
```

```c
/* 解析浏览器请求：GET 回发网页，POST 解析表单控制外设 */
static void lwip_server_netconn_serve(struct netconn *conn)
{
    struct netbuf *inbuf;
    char *buf;
    u16_t buflen;
    err_t err;
    char *ptemp;

    err = netconn_recv(conn, &inbuf);        /* 读取请求数据 */
    if (err == ERR_OK)
    {
        netbuf_data(inbuf, (void **)&buf, &buflen);

        /* 是 GET 请求（以 "GET /" 开头）就回发网页 */
        if (buflen >= 5 && buf[0]=='G' && buf[1]=='E' &&
            buf[2]=='T' && buf[3]==' ' && buf[4]=='/')
        {
start_html:
            /* 回发 HTTP 响应头和网页内容（常量数据用 NOCOPY 免拷贝） */
            netconn_write(conn, http_html_hdr, sizeof(http_html_hdr) - 1,
                          NETCONN_NOCOPY);
            netconn_write(conn, http_index_html, sizeof(http_index_html) - 1,
                          NETCONN_NOCOPY);
        }
        else if (buflen >= 8 && buf[0]=='P' && buf[1]=='O' &&
                 buf[2]=='S' && buf[3]=='T')
        {
            /* 是 POST 请求：定位 "led1=" 字段并控制 LED */
            ptemp = lwip_data_locate((char *)buf, "led1=");
            if (ptemp != NULL)
            {
                if (*ptemp == '1')  LED0(0);   /* 点亮 LED */
                else                LED1(1);   /* 熄灭 LED */
            }
            goto start_html;   /* 重新回发网页，刷新状态 */
        }
    }
    netconn_close(conn);
    netbuf_delete(inbuf);    /* netconn_recv 把所有权交给我们，必须释放 */
}
```

> ⚠️ 直连环境注意：此实验 **完全可在直连环境运行**。板子 IP `192.168.1.10`，电脑浏览器直接访问即可。如果页面打不开，先用 `ping 192.168.1.10` 确认链路，再看板子是否真的绑定了 80 端口、电脑是否设了代理。

## 4. HTTP 服务器实验：直连就能跑

把 `lwIP_HTTPS 实验`（或 RAW_Webserver 实验）烧进板子，连好网线，做三件事（教材 29.3/14.2 下载验证 (PDF p.436 / p.349)）：

1. 电脑浏览器输入 `192.168.1.10`，应出现开发板的控制页面
2. 勾选 / 取消网页上的 LED、蜂鸣器复选框，观察板子外设动作（CGI 生效）
3. 看页面上的 ADC、内部温度、RTC 数值会不会刷新（SSI 生效）

这一关是纯局域网、无外网依赖，**你现在的直连环境完全能拿下**，值得认真跑一遍。

## 5. NTP 简介与报文结构：网络对表协议

NTP（Network Time Protocol）是使计算机时间同步化的协议，可对时钟源（石英钟、GPS 等）做同步，LAN 上精度小于 1 毫秒，WAN 上几十毫秒（教材第 23.1 节 (PDF p.396)）。服务器按离 UTC 源的远近分层（Stratum）。NTP 报文是 48 字节起，结构如下：

| 字段 | 位数 | 含义 |
|------|------|------|
| LI | 2 bit | 告警状态，11 表示时钟未同步 |
| VN | 3 bit | NTP 版本号 |
| Mode | 3 bit | 3=客户模式、4=服务器模式、5=广播 |
| Stratum | 8 bit | 时钟层数（1~16） |
| Poll / Precision | 8+8 bit | 轮询间隔 / 时钟精度 |
| Root Delay / Dispersion | 32+32 bit | 到主参考时钟的往返时间 / 最大误差 |
| Reference Identifier | 32 bit | 参考时钟源标识 |
| Reference / Originate / Receive / Transmit Timestamp | 4×64 bit | 四组时间戳，核心是 Transmit |

教材给了个"手撕"流程（PDF p.397）：UDP 连 NTP 服务器（默认端口 123）→ 发 NTP 请求报文 → 取响应第 **40~43 字节**的十六进制值（这是自 1900 年起的总秒数）→ 转十进制 → 减去 1900→1970 的时间差 `2208988800` 秒 → 换算成年月日时分秒。lwIP 里对应的标准实现叫 **SNTP 客户端**（`apps/sntp`），教材例程则用 netconn 手写。

```c
/* 构建 NTP 请求报文（教材 23.2.2.2 节） */
void lwip_ntp_client_init(void)
{
    uint8_t flag;

    /* 只需设置关键字段：版本号 3、模式 3（客户模式） */
    g_ntpformat.leap = 0;
    g_ntpformat.version = 3;
    g_ntpformat.mode = 3;
    /* stratum、poll、precision、各时间戳等其余字段全部清 0 */

    /* 首字节 = (version << 3) | mode，即 0x1B */
    flag = (g_ntpformat.version << 3) + g_ntpformat.mode;
    memcpy(g_ntp_message, (void const *)(&flag), 1);
}

/* 从响应报文中截取第 40~43 字节，还原为总秒数并换算成时间 */
void lwip_get_seconds_from_ntp_server(uint8_t *buf, uint16_t idx)
{
    unsigned long long atk_seconds = 0;
    uint8_t i;

    for (i = 0; i < 4; i++)            /* 拼接 40~43 字节为 32 位秒数 */
    {
        atk_seconds = (atk_seconds << 8) | buf[idx + i];
    }
    atk_seconds -= NTP_TIMESTAMP_DELTA;  /* 减去 1900→1970 的 2208988800 秒 */
    lwip_calc_date_time(atk_seconds);    /* 换算成 年/月/日 时:分:秒 */
}
```

## 6. NTP 实验：需要联网，直连先做替代

> ⚠️ **直连环境的现实约束**：NTP 服务器在公网（如阿里云 NTP），你板子和电脑是网线直连、没有外网出口，所以"发 NTP 请求 → 收服务器回包"这一环**现在做不了**。要跑通完整的 NTP 实验，需要联网环境（**手机热点 / 路由器**），让板子能访问公网 UDP 123 端口。

那么直连环境能做什么？分两档：

- ✅ **能做的**：把 NTP 例程烧进板子，Wireshark 抓包，验证板子确实发出了 48 字节的 NTP UDP 请求（目的端口 123、首字节 0x1B）——链路是通的，只是没人应答；顺便把第 5 节报文结构对着抓包一格格看明白
- ⏳ **联网后补做**：手机开热点或接路由器，把例程里 NTP 服务器地址设成阿里云 NTP（`ntp.aliyun.com`），串口/LCD 应打印出"北京时间：xxxx-xx-xx xx:xx:xx"（教材 23.2.3 (PDF p.405)）

> 💡 直连替代练习思路：NTP 的本质是"UDP 发请求 + 解析响应"。你现在就能用第 12 课的 UDP socket 收发能力，把"构造 0x1B 报文 → 抓包验证 → 解析 40~43 字节"这套流程在本地跑通，唯一的区别是"对端从公网服务器变成没人应答"——等联网后，把目标地址一换，全流程就活了。

## 动手练习（约 35 分钟）

### 练习 13.1：让浏览器打开开发板的网页（直连可行）

- 1️⃣ 烧录 httpd（RAW 版）或 HTTP 服务器例程，电脑浏览器访问 `192.168.1.10`。
- 2️⃣ 勾选网页复选框，观察板子 LED、蜂鸣器动作（CGI 生效）。
- 3️⃣ 在电脑上用 Wireshark 过滤 `http`，看一眼浏览器发来的 GET 请求行和板子回发的响应，对照第 1 节的内容。

### 练习 13.2：NTP 报文解剖（直连替代）＋ 联网补做

- 1️⃣ 直连环境：烧 NTP 例程，Wireshark 过滤 `udp.port==123`，确认板子发出 48 字节请求、首字节为 0x1B（版本 3、客户模式）。
- 2️⃣ 对着第 5 节表格，在抓包里把 LI/VN/Mode/Stratum 逐字段圈出来。
- 3️⃣ 联网后：手机热点或路由器接入，服务器地址改成 `ntp.aliyun.com`，观察串口是否打印北京时间；把结果截图留档。

## 自测（答完再点答案）

### 随堂小测 1

Q1. 浏览器首次打开一个网页，发送的是？

- A. POST 请求，包含表单数据
- B. GET 请求，请求行以 GET 开头
- C. HEAD 请求，只检测对象存在

<details>
<summary>查看答案</summary>

B。打开页面默认发 GET；POST 用于提交表单（教材 29.1 节，PDF p.431）。

</details>

### 随堂小测 2

Q2. 网页控制板子 LED，靠哪种技术实现？

- A. CGI 公共网关接口
- B. SSI 服务器端嵌入
- C. DHCP 动态主机配置

<details>
<summary>查看答案</summary>

A。CGI 让网页可交互、控制外设；SSI 用于动态填入 ADC/温度/RTC 数值（PDF p.343）。

</details>

### 随堂小测 3

Q3. NTP 响应报文中，当前时间秒数位于？

- A. 第 0 到第 3 字节
- B. 第 40 到第 43 字节
- C. 第 44 到第 47 字节

<details>
<summary>查看答案</summary>

B。取 40~43 字节为总秒数，减 2208988800 换算（PDF p.397）。

</details>

### 随堂小测 4

Q4. 直连环境下 NTP 实验的合适做法是？

- A. 板子直连电脑，直接连公网 NTP 服务器
- B. 抓包验证请求报文，联网后补做完整流程
- C. 用本地文件模拟时间戳，无需真实网络

<details>
<summary>查看答案</summary>

B。直连无外网出口，先验证链路与报文，联网后换服务器地址补做（本课第 6 节）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 14 章（PDF p.339~349）、第 29 章（PDF p.431~436）、第 23 章（PDF p.396~405）——本课全部依据
- 🌐 lwIP 2.1.3 源码 `src/apps/http/httpd.c` 与 `src/apps/sntp/sntp.c`——官方 httpd 与 SNTP 客户端实现
- 📕 RFC 7230（HTTP/1.1）与 RFC 4330（SNTPv4）——协议官方规范

## 下一步

有问题随时问我。下一课预告：第 14 课——测速与抓包分析，用 JPerf 给开发板"跑个分"、用 Wireshark 亲眼看看三次握手和 ARP，把前面所有"看不见的协议"变成"看得见的包"。

| [← 上一课](/my-blog/posts/lwip/0012-socket-api/) | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0014-bandwidth-and-packet-analysis/) |
