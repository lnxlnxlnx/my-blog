---
title: NETCONN 接口
published: 2026-08-24
description: lwIP 系列课程第 11 课：netbuf 缓冲与 netconn 连接结构、阻塞式 API 全家桶、RAW 与 NETCONN 的取舍对比，以及在 FreeRTOS 任务里跑通 NETCONN UDP 和 TCP 客户端的最小代码。
tags: [lwIP, 嵌入式, 网络, NETCONN, netbuf, 阻塞式API, FreeRTOS]
category: lwIP
draft: false
prevTitle: Socket 编程接口
prevSlug: "lwip/0012-socket-api"
nextTitle: RAW API · TCP
nextSlug: "lwip/0010-raw-tcp"
---

# NETCONN 接口

netbuf 缓冲、netconn 连接结构、阻塞式 API、与 RAW 对比、FreeRTOS 任务里的 UDP/TCP 实验

**本课目标：**RAW 像"在协议栈内部上班"，NETCONN 就是"在办公室打电话办事"——把回调换成阻塞式调用，让网络编程变得像写普通函数一样顺。学完你能说清：netbuf 和 netconn 结构怎么回事、NETCONN 为什么必须配 OS、它和 RAW 的取舍在哪，并能在 FreeRTOS 任务里跑通 NETCONN UDP 和 TCP 客户端，和电脑工具双向联调。

## 1. NETCONN 简介：面向线程的阻塞式 API

NETCONN（Network Connection）是 lwIP 的第二套编程接口（正点原子《lwIP 开发指南 V1.7》第 15 章 (PDF p.350)）。它的核心思想：**API 调用会阻塞当前线程，直到操作完成或超时**——`netconn_recv` 没数据就睡着等，`netconn_accept` 没连接就睡着等，醒来时数据已经在手里了。这要求：

- ✅ **必须有操作系统**（本课程用 FreeRTOS）：lwIP 跑在独立的 `tcpip_thread` 内核线程里，用户线程通过"API 消息 + 邮箱/信号量"和内核线程通信（第七章讲的 IPC 机制，(PDF p.354)）
- ✅ 需要在 lwipopts.h 打开 `LWIP_NETCONN = 1`（教材带 OS 移植的工程默认已打开）
- 🔀 调用过程：用户线程调 API → 构造 `api_msg` 消息 → 发给 tcpip 线程 → 内核执行真正的 udp_xxx / tcp_xxx → 信号量唤醒用户线程

> 💡 一句话理解：**NETCONN 把"回调"翻译成了"同步返回"**。内核替你把数据塞进邮箱，你的线程阻塞等邮箱，拿到就处理——逻辑是线性的，好写、好读、好调试。

## 2. netbuf：NETCONN 的数据包封装（(PDF p.350)）

NETCONN 收发数据的载体是 `netbuf`（定义在 netbuf.h）：

```c
/* 网络缓冲区：数据 + 寻址信息 */
struct netbuf {
  struct pbuf *p, *ptr;   /* p 永远指向 pbuf 链表第一个；ptr 可指向链表中任意位置 */
  ip_addr_t addr;         /* 数据发送方的 IP 地址 */
  u16_t port;             /* 数据发送方的端口号 */
};
```

netbuf 本身不存数据，数据都存在它挂着的 **pbuf 链表**里；`addr/port` 记录来源地址（UDP 尤其有用——谁发的包一目了然）。常用操作函数（(PDF p.351)）：

| 函数 | 作用 |
|------|------|
| `netbuf_new()` | 申请 netbuf 空间（不含数据区） |
| `netbuf_alloc(buf, size)` | 为 netbuf 分配 size 大小的数据空间（pbuf 形式），返回 payload 地址 |
| `netbuf_ref(buf, dataptr, size)` | 让 pbuf 的 payload 直接指向静态数据（不拷贝，省内存） |
| `netbuf_delete(buf)` | 释放 netbuf 及其 pbuf 数据空间 |
| `netbuf_data(buf, &dataptr, &len)` | 取出 ptr 指向的 pbuf 的数据地址和长度 |
| `netbuf_next() / netbuf_first()` | 移动 ptr 到下一个/第一个 pbuf |
| `netbuf_fromaddr() / netbuf_fromport()` | 返回发送方 IP 和端口 |

> ⚠️ UDP 发送时 **必须自己把数据装进 netbuf**（new → alloc → memcpy）；而 TCP 用 `netconn_write` 只需给"地址 + 长度"，内核自动封包——这是两种协议在 NETCONN 下最直观的差异。

## 3. netconn：统一的连接结构（(PDF p.351)）

RAW 时代 UDP 用 udp_pcb、TCP 用 tcp_pcb，两套函数。NETCONN 用**一个结构体通吃所有协议**：

```c
/* netconn 描述符（api.h） */
struct netconn {
  enum netconn_type type;      /* 连接类型：TCP / UDP / RAW ... */
  enum netconn_state state;    /* 连接状态 */
  union {
    struct ip_pcb  *ip;        /* IP 控制块 */
    struct tcp_pcb *tcp;       /* TCP 控制块 */
    struct udp_pcb *udp;       /* UDP 控制块 */
    struct raw_pcb *raw;       /* RAW 控制块 */
  } pcb;                       /* 内核中真正的控制块指针 */
  err_t pending_err;           /* 异步错误 */
  sys_mbox_t recvmbox;         /* 接收数据邮箱：netconn_recv 从这取 */
  sys_mbox_t acceptmbox;       /* TCP 服务器：新连接请求队列 */
  u32_t recv_timeout;          /* 接收超时 */
  ...
};
```

连接类型枚举（(PDF p.352)）：`NETCONN_TCP=0x10`、`NETCONN_UDP=0x20`、`NETCONN_UDPLITE=0x21`、`NETCONN_UDPNOCHKSUM=0x22`、`NETCONN_RAW=0x40`。创建时用 `netconn_new(NETCONN_UDP)` 或 `netconn_new(NETCONN_TCP)` 指定类型即可。

## 4. 常用 API 一览（(PDF p.353)）

| 函数 | 作用 | 适用 |
|------|------|------|
| `netconn_new(type)` | 创建连接结构（宏，内部发 API 消息给内核建控制块） | UDP/TCP |
| `netconn_bind(conn, ip, port)` | 绑定本地 IP 和端口 | UDP/TCP（服务器必须） |
| `netconn_connect(conn, ip, port)` | 连接远端（UDP 记对端；TCP 走三次握手） | UDP/TCP |
| `netconn_disconnect(conn)` | 断开连接，仅 UDP 可用 | UDP |
| `netconn_listen(conn)` | 进入监听状态（宏） | TCP 服务器 |
| `netconn_accept(conn, &newconn)` | 从 acceptmbox 取新连接，没连接就阻塞 | TCP 服务器 |
| `netconn_recv(conn, &buf)` | 从 recvmbox 收数据（netbuf），阻塞等待；收到空消息=对端关闭 | UDP/TCP |
| `netconn_send(conn, buf)` | 发送 netbuf 数据 | UDP |
| `netconn_write(conn, data, size, flags)` | 发送任意长度数据（内核自动封包），flags 常用 NETCONN_COPY | TCP |
| `netconn_close(conn)` | 关闭连接（发 FIN），但**不删结构** | TCP |
| `netconn_delete(conn)` | 删除连接结构（close 后必须 delete，否则内存泄漏） | UDP/TCP |
| `netconn_getaddr(conn, &ip, &port, local)` | 获取本地/远端地址端口（local=1 取本地） | UDP/TCP |

## 5. RAW vs NETCONN：怎么选

| 对比项 | RAW | NETCONN |
|--------|-----|---------|
| 编程模型 | 回调驱动（数据来了内核调你的函数） | 阻塞式调用（函数等数据，来了才返回） |
| 是否需要 OS | 不需要，裸机可跑 | 必须（依赖线程/邮箱/信号量） |
| 线程安全 | 回调运行在内核上下文，处理必须快 | 天然线程安全，可在多个任务中使用 |
| 代码风格 | 状态机 + 标志位，逻辑打散 | 线性流程，和写 PC 程序几乎一样 |
| 性能/内存 | 高，路径最短 | 略低（多一次消息传递与拷贝开销） |
| 适用场景 | 协议栈内部、高性能裸机、资源紧张 | 业务应用、多任务环境、快速开发 |

> 💡 选型口诀：**裸机用 RAW，带 OS 用 NETCONN，要跨平台移植用 Socket**（第 12 课）。教材里 DHCP、DNS 等协议栈内部实现全是 RAW；应用层的 HTTP、MQTT 例程则多基于 NETCONN/Socket。

## 6. 最小可用代码：NETCONN UDP（FreeRTOS 任务里跑）

步骤（(PDF p.357)）：`netconn_new(NETCONN_UDP)` → `netconn_bind`（本地）→ `netconn_connect`（远端）→ 循环 `netconn_recv` / `netconn_send`。把下面整个函数放进一个 FreeRTOS 任务即可。

```c
/* NETCONN UDP：收电脑数据并回发（运行在 FreeRTOS 任务中） */
void lwip_demo(void)
{
    err_t err;
    struct netconn *udpconn;
    struct netbuf *recvbuf;
    struct netbuf *sentbuf;
    ip_addr_t destipaddr;

    /* 1. 创建 UDP 连接结构 */
    udpconn = netconn_new(NETCONN_UDP);
    if (udpconn == NULL) {
        printf("netconn_new 失败\r\n");
        return;
    }

    /* 2. 绑定本地所有 IP 的 8080 端口（电脑就往 8080 发） */
    err = netconn_bind(udpconn, IP_ADDR_ANY, 8080);
    if (err != ERR_OK) {
        printf("netconn_bind 失败\r\n");
        netconn_delete(udpconn);
        return;
    }

    /* 3. "连接"远端电脑 192.168.1.2:8080 */
    IP4_ADDR(&destipaddr, 192, 168, 1, 2);
    netconn_connect(udpconn, &destipaddr, 8080);

    /* 4. 收发循环（recv_timeout 保证没数据时让出 CPU） */
    udpconn->recv_timeout = 10;                 /* 10ms 超时，避免永久阻塞 */
    while (1) {
        /* 发送：数据必须自己装进 netbuf */
        if ((send_flag & LWIP_SEND_DATA) == LWIP_SEND_DATA) {
            sentbuf = netbuf_new();
            netbuf_alloc(sentbuf, strlen(send_buf));
            memcpy(sentbuf->p->payload, send_buf, strlen(send_buf));
            err = netconn_send(udpconn, sentbuf);
            netbuf_delete(sentbuf);             /* 发送完删除 */
            send_flag &= ~LWIP_SEND_DATA;
        }

        /* 接收：阻塞等数据，超时返回 */
        err = netconn_recv(udpconn, &recvbuf);
        if (err == ERR_OK && recvbuf != NULL) {
            printf("收到 %s:%d 发来的数据: %.*s\r\n",
                   ipaddr_ntoa(&recvbuf->addr), recvbuf->port,
                   (int)recvbuf->p->tot_len, (char *)recvbuf->p->payload);
            netbuf_delete(recvbuf);             /* ★ 用完必须删除 */
        } else {
            vTaskDelay(5);                      /* 没数据就睡一会儿 */
        }
    }
}
```

> ⚠️ netbuf 用 `netbuf_delete` 释放（它会连带释放内部 pbuf），不要自己 pbuf_free。另外 `recv_timeout` 一定要设：不设超时，`netconn_recv` 会无限期阻塞，你的任务就被"焊死"在邮箱上了。

## 7. 最小可用代码：NETCONN TCP 客户端（(PDF p.362)）

步骤：`netconn_new(NETCONN_TCP)` → `netconn_connect`（握手阻塞完成）→ `netconn_write` / `netconn_recv` 收发 → `ERR_CLSD` 时 close + delete 重连。

```c
/* NETCONN TCP 客户端：连接失败自动重连 */
void lwip_demo(void)
{
    struct netconn *conn;
    struct netbuf *recvbuf;
    ip_addr_t server_ipaddr;
    err_t err, recv_err;

    IP4_ADDR(&server_ipaddr, 192, 168, 1, 2);    /* 电脑 IP */

    while (1) {
        /* 1. 创建 TCP 连接结构 */
        conn = netconn_new(NETCONN_TCP);
        if (conn == NULL) {
            vTaskDelay(1000);
            continue;
        }

        /* 2. 连接服务器：阻塞直到三次握手完成或失败 */
        err = netconn_connect(conn, &server_ipaddr, 8080);
        if (err != ERR_OK) {
            printf("连接失败 err=%d，重试中...\r\n", err);
            netconn_delete(conn);
            vTaskDelay(1000);
            continue;                            /* 重连 */
        }
        printf("连接服务器成功！\r\n");
        conn->recv_timeout = 10;                /* 3. 设置接收超时 */

        while (1) {
            /* 发送：TCP 只需给数据地址和长度，NETCONN_COPY 表示内核拷贝 */
            if ((send_flag & LWIP_SEND_DATA) == LWIP_SEND_DATA) {
                err = netconn_write(conn, send_buf,
                                    strlen(send_buf), NETCONN_COPY);
                if (err != ERR_OK) printf("发送失败\r\n");
                send_flag &= ~LWIP_SEND_DATA;
            }

            /* 接收 */
            recv_err = netconn_recv(conn, &recvbuf);
            if (recv_err == ERR_OK) {
                printf("收到服务器数据: %.*s\r\n",
                       (int)recvbuf->p->tot_len, (char *)recvbuf->p->payload);
                netbuf_delete(recvbuf);
            } else if (recv_err == ERR_CLSD) {
                /* 对端关闭：close 只断连接，delete 才删结构 */
                printf("服务器断开连接\r\n");
                netconn_close(conn);
                netconn_delete(conn);
                break;                          /* 外层 while 重连 */
            }
        }
    }
}
```

### 7.1 顺带看一眼：NETCONN TCP 服务器（(PDF p.368)）

```c
/* 服务器骨架：bind → listen → accept → 收发 */
struct netconn *conn, *newconn;

conn = netconn_new(NETCONN_TCP);
netconn_bind(conn, IP_ADDR_ANY, 8080);          /* 绑定 8080 */
netconn_listen(conn);                           /* 进入监听 */
conn->recv_timeout = 10;

while (1) {
    err = netconn_accept(conn, &newconn);       /* 阻塞等客户端连接 */
    if (err == ERR_OK) {
        newconn->recv_timeout = 10;
        /* 拿到新连接 newconn，之后 netconn_write / netconn_recv 收发，
           对方断开收到 ERR_CLSD 时 netconn_close + netconn_delete */
    }
}
```

## 动手练习（约 50 分钟）

### 练习 11.1：NETCONN UDP 实验

- 1️⃣ 在你的 FreeRTOS + lwIP 工程里新建 lwip_demo_task，把第 6 节代码放进去（确认 lwipopts.h 里 `LWIP_NETCONN == 1`）。
- 2️⃣ 电脑网络调试助手：UDP 协议，本地端口 8080，先监听；板子启动后应打印"收到 192.168.1.2:xxxx 的数据"。
- 3️⃣ 工具发数据 → 板子串口打印；板子按键触发发送 → 工具收到。来回多测几轮，观察 `netbuf->addr / port` 打印的源地址。
- 4️⃣ 验收标准：双向收发稳定，且任务不卡死（把 recv_timeout 注释掉再跑，观察任务"焊死"现象，然后改回来）。

### 练习 11.2：NETCONN TCP 客户端与电脑联调

- 1️⃣ 电脑网络调试助手：**TCP Server，本地端口 8080**，开始监听。
- 2️⃣ 按第 7 节代码实现客户端任务：连接 192.168.1.2:8080，成功打印"连接服务器成功！"。
- 3️⃣ 工具回发字符串 → 板子串口打印；工具点"断开" → 板子应打印"服务器断开连接"并自动重连。
- 4️⃣ 验收标准：断开后板子自动重连成功（工具重新监听后能看到新连接），说明 ERR_CLSD 处理路径正确。

## 自测（答完再点答案）

### 随堂小测 1

Q1. NETCONN API 为什么必须有操作系统支持？

- A. 因为它的回调函数需要中断触发
- B. 因为用户线程要通过邮箱/信号量与 tcpip 内核线程通信
- C. 因为 UDP 需要多线程并发收发

<details>
<summary>查看答案</summary>

B。NETCONN 是"两部分 API"：用户线程发 api_msg 消息给 tcpip_thread，靠信号量同步、邮箱传数据（PDF p.354）。

</details>

### 随堂小测 2

Q2. netbuf 与 pbuf 的关系是？

- A. netbuf 就是 pbuf 的别名
- B. netbuf 挂载 pbuf 链表，并记录发送方地址和端口
- C. 两者互不相关，netbuf 只存端口号

<details>
<summary>查看答案</summary>

B。netbuf 的 p/ptr 指向 pbuf 链表，addr/port 记录来源地址（PDF p.350）。

</details>

### 随堂小测 3

Q3. 用 netconn_write 发送 TCP 数据和 netconn_send 发送 UDP 数据，区别是？

- A. write 要自备 netbuf，send 只需数据地址和长度
- B. write 只需数据地址和长度，send 要自己封装 netbuf
- C. 两者都要求封装 netbuf 才能发送

<details>
<summary>查看答案</summary>

B。TCP 内核自动封包（write 给地址+长度即可）；UDP 必须 netbuf_new/alloc/memcpy 装好再 send（PDF p.350/355）。

</details>

### 随堂小测 4

Q4. netconn_recv 返回 ERR_CLSD 表示什么，应怎么处理？

- A. 数据接收成功，正常处理即可
- B. 对端已关闭连接，应 netconn_close + netconn_delete
- C. 发送缓冲区满，应稍后重发

<details>
<summary>查看答案</summary>

B。ERR_CLSD 表示收到对端 FIN；close 断连接、delete 删结构，否则内存泄漏（PDF p.364）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 15~18 章（(PDF p.350~372)）——netbuf/netconn 结构与 UDP/TCP 客户端/服务器四个实验
- 🌐 [lwIP 官网](https://savannah.nongnu.org/projects/lwip/)——api.h / api_lib.c 中 netconn API 官方声明
- 📘 第 7 章（(PDF p.196)）——回顾"API 消息与 tcpip_thread"机制，NETCONN 的底层依赖

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 12 课——Socket 接口，BSD Socket 风格的 API 让代码几乎可以原样移植到 PC 上，三套接口全部学完后，你的 lwIP 应用开发就"全面武装"了。

| [← 上一课](/my-blog/posts/lwip/0010-raw-tcp/) | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0012-socket-api/) |
