---
title: Socket 编程接口
published: 2026-08-25
description: lwIP 系列课程第 12 课：BSD Socket 风格的编程接口、Socket API 全家桶、UDP / TCP 客户端 / TCP 服务器三大编程流程与实验，以及 RAW / NETCONN / Socket 三套接口的横向对比。
tags: [lwIP, 嵌入式, 网络, Socket, BSD Socket, TCP, UDP]
category: lwIP
draft: false
prevTitle: HTTP 与 NTP
prevSlug: "lwip/0013-http-and-ntp"
nextTitle: NETCONN 接口
nextSlug: "lwip/0011-netconn-api"
---

# Socket 编程接口

BSD Socket 风格、API 全家桶、UDP / TCP 客户端 / TCP 服务器三大实验、三套接口横向对比

**本课目标：**从 netconn 接口再往上爬一层，拥抱最熟悉的 Socket API。学完你能：把 lwIP 的 socket / bind / listen / accept / connect / send / recv / sendto / recvfrom / close 逐个对号入座，独立写出 UDP、TCP 客户端、TCP 服务器三个方向的流程，最后说清 RAW / NETCONN / Socket 三套接口"什么时候用哪个"。

## 1. Socket 编程接口简介：把嵌入式拉回 PC 的舒适区

Socket 学名的源头是 **BSD Socket（伯克利套接字）**——加州伯克利大学为 Unix 开发的、用 C 语言实现的进程间通信 API（PDF 第 19.1 节 (PDF p.373)）。它的核心思想是：**网络连接也像文件一样"打开 → 读 / 写 → 关闭"**，socket 就是一个特殊的"文件描述符"。你在 PC 上用 Python / Java / C 写过的网络代码，几乎都是这套接口——所以它被戏称为"嵌入式里的 PC 舒适区"。

lwIP 并没有完全照搬 BSD Socket，而是做了**有选择的抽象**（PDF p.373）：内核提供最多 `NUM_SOCKETS` 个 Socket 描述符，每个描述符对应一个结构体 `lwip_socket`，而这个结构体本质上是**对 netconn 结构的再封装**——对 socket 的一切操作最终都会映射回 netconn，netconn 又映射回 tcp / udp 控制块。也就是说：

```c
/* 源码中的关系：Socket 依赖 netconn 实现 */
struct lwip_sock {
  struct netconn *conn;       /* 每个 socket 底层挂一个 netconn */
  union lwip_sock_lastdata lastdata;  /* 上次读操作残留的数据 */
  ...
};
```

> 💡 记住这条依赖链：**Socket → netconn → tcp/udp PCB → 内核**。你在上层用的任何一句 socket 调用，最终都变成第 9~11 课讲过的消息/回调，驱动协议栈内核干活。

## 2. Socket API 全家桶：一个萝卜一个坑

教材第 19.2 节逐个讲解了这些 API（(PDF p.374~377)），它们都是宏定义，本质是 `lwip_xxx` 系列函数的封装。把"参数怎么填、谁用、干啥"一次讲清：

| API | 作用 | 典型使用者 | 要点 |
|-----|------|-----------|------|
| `socket(domain,type,protocol)` | 创建套接字，申请一个描述符 | 双方 | `AF_INET` 表示 IPv4；`SOCK_STREAM` 是 TCP，`SOCK_DGRAM` 是 UDP；protocol 一般填 0 |
| `bind(s,name,namelen)` | 绑定本地 IP 与端口 | 服务器 | 把 sockaddr 信息挂到套接字上 |
| `connect(s,name,namelen)` | 连接远端 | 客户端 | TCP 会触发三次握手；UDP 只记录远端地址、不发包 |
| `listen(s,backlog)` | 进入监听状态，排队连接请求 | 服务器 | backlog 是连接队列最大长度 |
| `accept(s,addr,addrlen)` | 接受一个连接，返回新套接字 | 服务器 | 新连接的客户端地址写入 addr |
| `send / sendto` | 发送数据 | 双方 | sendto 多了目的地址参数，UDP 常用 |
| `recv / recvfrom` | 接收数据 | 双方 | recvfrom 能拿到发送方地址 |
| `write(s,data,size)` | 在已建立的连接上发送 | TCP 客户端 | 基于 send 实现，TCP 程序里常见 |
| `close(s)` | 关闭套接字 | 双方 | TCP 下会触发断开握手，内核结构被复位 |

> ⚠️ 端口号与 IP 的字节序坑：设置 `sin_port` 时要用 `htons()`（主机字节序转网络字节序），设置 `sin_addr.s_addr` 时服务器侧常用 `htonl(INADDR_ANY)`、客户端侧用 `inet_addr("192.168.1.2")`。忘了转换，包就发到"另一个宇宙"去了。

## 3. UDP 编程流程与实验：无连接、发就完事

UDP 是"发一封平信"：不需要建立连接，直接怼 `sendto` 就能发。教材第 20 章给出了标准流程（(PDF p.378)）：配置 sockaddr_in（AF_INET + 端口 + IP）→ `socket` 创建 → `bind` 绑定 → 收发。

```c
/* Socket 接口实现 UDP：配置本地地址并收发数据（教材 20.2.2.2 节） */
void lwip_demo(void)
{
    /* 1. 清空并配置本地地址 */
    memset(&local_info, 0, sizeof(struct sockaddr_in));
    local_info.sin_family = AF_INET;                 /* IPv4 */
    local_info.sin_port = htons(LWIP_DEMO_PORT);     /* 本地端口 */
    local_info.sin_addr.s_addr = htons(INADDR_ANY);  /* 本地 IP */

    /* 2. 创建 UDP 套接字：SOCK_DGRAM 表示 UDP */
    sock_fd = Socket(AF_INET, SOCK_DGRAM, 0);

    /* 3. 绑定本地地址与端口 */
    bind(sock_fd, (struct sockaddr *)&local_info, sizeof(struct sockaddr_in));

    while (1)
    {
        /* 4. 接收数据（阻塞等待） */
        memset(lwip_demo_recvbuf, 0, sizeof(lwip_demo_recvbuf));
        recv(sock_fd, (void *)lwip_demo_recvbuf, sizeof(lwip_demo_recvbuf), 0);
    }
}

/* 发送线程：按 KEY0 触发，把数据发给电脑上的网络调试助手 */
void lwip_send_thread(void *pvParameters)
{
    local_info.sin_addr.s_addr = inet_addr(IP_ADDR); /* 远程电脑的 IP */
    while (1)
    {
        if ((lwip_send_flag & LWIP_SEND_DATA) == LWIP_SEND_DATA)
        {
            sendto(sock_fd,                                  /* 套接字 */
                   (char *)lwip_demo_sendbuf,                /* 数据 */
                   sizeof(lwip_demo_sendbuf), 0,             /* 长度、标志 */
                   (struct sockaddr *)&local_info,           /* 对端地址 */
                   sizeof(local_info));                      /* 地址长度 */
            lwip_send_flag &= ~LWIP_SEND_DATA;
        }
        vTaskDelay(100);
    }
}
```

实验里：电脑跑**网络调试助手**，选 UDP，IP 填板子的 `192.168.1.10`、端口与板子一致；电脑发数据 → 板子 LCD 显示；按 KEY0 → 板子把数据发回电脑（教材 20.2.3 下载验证 (PDF p.381)）。

## 4. TCP 客户端流程与实验：主动发起三次握手

TCP 是"先握手再对话"。客户端流程（教材第 21 章 (PDF p.384)）：配置远端 sockaddr_in → `socket`(SOCK_STREAM) → `connect` 连接 → 收发。

```c
/* Socket 接口实现 TCP 客户端（教材 21.2.2.2 节） */
void lwip_demo(void)
{
    struct sockaddr_in atk_client_addr;
    err_t err;
    int recv_data_len;

    while (1)
    {
sock_start:
        /* 1. 配置远端服务器地址 */
        atk_client_addr.sin_family = AF_INET;              /* IPv4 */
        atk_client_addr.sin_port = htons(LWIP_DEMO_PORT);  /* 服务器端口 */
        atk_client_addr.sin_addr.s_addr = inet_addr(IP_ADDR); /* 服务器 IP */

        /* 2. 创建 TCP 套接字：SOCK_STREAM 表示 TCP */
        sock = Socket(AF_INET, SOCK_STREAM, 0);

        /* 3. 连接远程服务器（触发三次握手） */
        err = connect(sock, (struct sockaddr *)&atk_client_addr,
                      sizeof(struct sockaddr));
        if (err == -1)
        {
            printf("连接失败\r\n");
            closeSocket(sock);
            vTaskDelay(10);
            goto sock_start;   /* 失败重连 */
        }
        printf("连接成功\r\n");

        while (1)
        {
            /* 4. 接收服务器数据，收不到（对方关闭）则断开重连 */
            recv_data_len = recv(sock, lwip_demo_recvbuf,
                                 LWIP_DEMO_RX_BUFSIZE, 0);
            if (recv_data_len <= 0)
            {
                closeSocket(sock);
                goto sock_start;
            }
        }
    }
}

/* 发送线程：连接成功后，用 write 把数据发给服务器 */
err = write(sock, lwip_demo_sendbuf, sizeof(lwip_demo_sendbuf));
```

对应电脑端：网络调试助手开一个 **TCP Server**（端口与板子一致），板子作为客户端主动连上来；助手能收到 KEY0 发的数据，也能回发数据给板子（教材 21.2.3 (PDF p.388)）。

## 5. TCP 服务器流程与实验：监听、接受、服务

服务器是被动方：`socket` → `bind` → `listen` → `accept` 拿到新连接 → 收发（教材第 22 章 (PDF p.390)）。

```c
/* Socket 接口实现 TCP 服务器（教材 22.2.2.2 节） */
void lwip_demo(void)
{
    struct sockaddr_in server_addr;   /* 服务器本地地址 */
    struct sockaddr_in conn_addr;     /* 已连接客户端的地址 */
    socklen_t addr_len;
    int sock_fd, sock_conn;

    /* 1. 创建 TCP 套接字 */
    sock_fd = Socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);

    /* 2. 配置并绑定本地地址 */
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_addr.s_addr = htonl(INADDR_ANY);  /* 注意网络字节序 */
    server_addr.sin_port = htons(LWIP_DEMO_PORT);
    err = bind(sock_fd, (struct sockaddr *)&server_addr, sizeof(server_addr));

    /* 3. 进入监听，backlog=4 表示最多排 4 个连接请求 */
    err = listen(sock_fd, 4);

    while (1)
    {
        /* 4. 接受一个客户端连接，返回新的连接套接字 */
        addr_len = sizeof(struct sockaddr_in);
        sock_conn = accept(sock_fd, (struct sockaddr *)&conn_addr, &addr_len);
        if (sock_conn < 0)
        {
            closeSocket(sock_fd);   /* 连接故障，关闭监听套接字 */
            break;
        }

        while (1)
        {
            /* 5. 在新连接上收发数据 */
            length = recv(sock_conn, (unsigned int *)lwip_demo_recvbuf,
                          sizeof(lwip_demo_recvbuf), 0);
            if (length <= 0)   /* 客户端断开 */
            {
                closeSocket(sock_conn);
                break;
            }
        }
    }
}
```

对应电脑端：网络调试助手开 **TCP Client**，连 `192.168.1.10:端口`，即可收发（教材 22.2.3 (PDF p.394)）。至此，你已经在三种角色（UDP 对等、TCP 客户端、TCP 服务器）里都打过一遍 socket 了。

## 6. 三套接口横向对比：RAW / NETCONN / Socket

学完第 9~12 课，终于能俯视全局。三套接口从"底层裸奔"到"高层舒适"的对比：

| 对比项 | RAW（回调） | NETCONN（线程） | Socket（BSD 风格） |
|--------|-----------|---------------|-------------------|
| 编程方式 | 注册回调函数，由协议栈调用 | 连 API 返回 netconn / netbuf，阻塞收发 | socket 描述符 + read / write 风格 |
| 依赖 | 纯内核，无 OS 也能用 | 必须配操作系统（跑线程） | 基于 netconn，同样需要 OS |
| 代码量 / 上手难度 | 最绕、难调试 | 中等 | 最简单，和 PC 编程对齐 |
| 性能 / 开销 | 最高效、最小开销 | 中等（有线程切换） | 最方便，但多一层封装 |
| 适用场景 | 资源极紧、追求极致性能，如裸机 | 带 OS、要平衡性能与开发效率 | 开发效率优先，协议栈只是"工具" |
| 本章教材对应 | 第 9~10 章 RAW 实验 | 第 11 章 NETCONN 实验 | 第 19~22 章（本课） |

> 💡 一句话选型：**裸机求性能 → RAW；带系统求效率 → NETCONN；只求"赶紧写出来" → Socket**。绝大多数应用场景，Socket 够用且最省心——这也是为什么 lwIP 把 Socket 作为默认推荐接口。

## 动手练习（约 30 分钟）

### 练习 12.1：UDP 收发全流程

- 1️⃣ 在 lwIP 实验工程中，用第 3 节的 UDP 流程搭一个 UDP 服务器，端口用 `8080`。
- 2️⃣ 电脑开网络调试助手（UDP 模式），本地端口设 `8080`，向 `192.168.1.10:8080` 发一串字符，观察板子 LCD 是否显示。
- 3️⃣ 按板子 KEY0，观察电脑助手是否收到数据。成功 = 双向通了。

### 练习 12.2：TCP 客户端 + 服务器两连击

- 1️⃣ 电脑网络调试助手开 **TCP Server**（端口 8081），板子跑第 4 节 TCP 客户端，观察"连接成功"。
- 2️⃣ 电脑助手向板子发数据，板子 LCD 显示；按 KEY0 发回数据。
- 3️⃣ 关掉电脑服务器，观察板子是否打印"连接失败"并自动重连——理解 `recv` 返回 <= 0 的含义。
- 4️⃣ 拓展：把板子改成第 5 节 TCP 服务器，电脑助手以 TCP Client 连上，重复收发。

## 自测（答完再点答案）

### 随堂小测 1

Q1. 服务器套接字建立流程的正确顺序是？

- A. socket → bind → listen → accept
- B. socket → connect → send → recv
- C. bind → listen → socket → accept

<details>
<summary>查看答案</summary>

A。服务器固定四步：创建、绑定、监听、接受（教材 22.1 节，PDF p.390）。

</details>

### 随堂小测 2

Q2. UDP 客户端中调用 connect 会发生什么？

- A. 与服务器完成三次握手
- B. 只记录远端地址，不发送数据包
- C. 立刻发送一个测试报文

<details>
<summary>查看答案</summary>

B。UDP 无连接，connect 只在连接结构中记录服务器地址，不触发任何握手（PDF p.375）。

</details>

### 随堂小测 3

Q3. 三套编程接口中，必须依赖操作系统的有？

- A. RAW 和 NETCONN
- B. NETCONN 和 Socket
- C. RAW 和 Socket

<details>
<summary>查看答案</summary>

B。NETCONN 和 Socket 需要跑线程，而 RAW 是纯回调，裸机也能用（本课第 6 节对比表）。

</details>

### 随堂小测 4

Q4. lwip_socket 结构体与 netconn 的关系是？

- A. 两者相互独立，无任何联系
- B. socket 是对 netconn 的封装和增强
- C. netconn 依赖 socket 才能工作

<details>
<summary>查看答案</summary>

B。每个 lwip_socket 内部挂一个 netconn，所有操作映射回 netconn（PDF p.373）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 19~22 章（PDF p.373~395）——本课全部依据
- 📕 《Unix 网络编程》（W. Richard Stevens）——BSD Socket 权威参考，理解 select、非阻塞等高级话题
- 🌐 lwIP 2.1.3 源码 `src/api/sockets.c`——逐函数看 Socket 如何映射到 netconn

## 下一步

有问题随时问我。下一课预告：第 13 课——HTTP 与 NTP，让浏览器直接访问开发板网页、让板子读出"现在几点"，告别"纯收发"，进入真实的应用协议。

| [← 上一课](/my-blog/posts/lwip/0011-netconn-api/) | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0013-http-and-ntp/) |
