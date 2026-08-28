---
title: RAW API · UDP
published: 2026-08-22
description: lwIP 系列课程第 9 课：UDP 协议与报文结构、udp_sendto / udp_input 收发路径、RAW 回调式编程风格、RAW UDP 全家桶 API，以及板子和电脑之间跑通 UDP 收发的最小工程骨架。
tags: [lwIP, 嵌入式, 网络, RAW API, UDP, 回调, 网络调试助手]
category: lwIP
draft: false
prevTitle: RAW API · TCP
prevSlug: "lwip/0010-raw-tcp"
nextTitle: IP 与 ICMP 协议
nextSlug: "lwip/0008-ip-and-icmp"
---

# RAW API · UDP

UDP 协议、报文结构、udp_new / udp_bind / udp_sendto / udp_recv，RAW UDP 收发实验

**本课目标：**从这一课开始，你正式迈入"三套编程接口"阶段，亲手写第一个网络应用。学完你能说清：UDP 报文长什么样、lwIP 怎么发怎么收 UDP 数据、RAW API 的回调式风格是怎么回事，并能在板子和电脑之间跑通一次 UDP 收发（Wireshark 亲眼看到端口和载荷）。这是后面 TCP（第 10 课）的暖场，也是理解 NETCONN / Socket 的对照基准。

## 1. UDP 协议：最快但最"不负责"的传输层协议

UDP（User Datagram Protocol）是传输层的两个核心协议之一。它的性格一句话概括：**面向数据报、无连接、不可靠，但简单快**（正点原子《lwIP 开发指南 V1.7》第 11.1 节 (PDF p.260)）。它不提供分组、组装、排序，发出去就不知道对方收没收到——正因为无连接、无握手，资源消耗小、处理速度快，音频、视频、DNS、SNMP 这类"丢了重发不如直接丢"的场景最爱用它。

UDP 数据报结构（(PDF p.260)）：首部固定 **8 字节**，4 个字段各 2 字节：

| 字段 | 长度 | 作用 |
|------|------|------|
| 源端口 | 16 位 | 需要对方回信时用；不需要可全置 0 |
| 目的端口 | 16 位 | 终点交付报文时靠它找到接收应用 |
| 长度 | 16 位 | 整个 UDP 数据报（首部+数据）字节数，最小 8 |
| 校验和 | 16 位 | 检测传输是否有错，有错直接丢弃 |

端口号用 2 字节表示，范围 0~65535；一般大于 49151 的是动态端口。封装时 UDP 报文整体装进 IP 数据报，IP 层再装进以太网帧——每层套一层首部，这就是第 1 课说的"套娃"。

> 💡 记忆锚点：**UDP 首部 8 字节 = 4 个 u16**。lwIP 里对应结构体 `udp_hdr`，字段名和教材图一一对应，等下代码里就能看到。

## 2. lwIP 里 UDP 怎么发、怎么收

### 2.1 发送路径：udp_sendto → udp_sendto_if_src → ip_output_if_src

发送核心函数是 `udp_sendto_if_src`（(PDF p.262)），流程很直白：

- ① 校验控制块与源/目的 IP 版本匹配；若 PCB 还没绑端口，先自动 `udp_bind`
- ② 给 pbuf 添加 UDP 首部（空间不够就另申请一个 `PBUF_IP` 类型的 pbuf 装首部，再用 `pbuf_chain` 把首部和数据链起来）
- ③ 填首部：源端口、目的端口、长度、校验和（发送时先置 0，由 IP 层做校验和计算）
- ④ 调用 `ip_output_if_src` 把数据报交给网络层，一路向下出网卡

你平时调用的是封装好的 `udp_sendto(pcb, p, dst_ip, dst_port)`（官方 API，自动完成上述流程），或 `udp_send(pcb, p)`（发给 `udp_connect` 绑定的对端）。

### 2.2 接收路径：udp_input → 遍历 PCB 链表 → 回调

收包由 `udp_input` 处理（(PDF p.265)）：IP 层剥完 IP 首部后把 pbuf 交进来，它做四件事：

- ① 检查长度 ≥ 8（UDP_HLEN），否则丢弃
- ② 从首部取出源/目的端口
- ③ **遍历 `udp_pcbs` 链表**找匹配的控制块：先按目的端口 + 本地 IP 匹配，再按远程端口 + 源 IP 做"完全匹配"（优先命中 `udp_connect` 过的连接）；都找不到就用第一个未连接的 PCB
- ④ 命中后把 pbuf 指针移到数据区，调用 `pcb->recv` **回调函数**把数据交给你的代码；没人注册回调就直接释放

> ⚠️ 回调函数 **必须负责释放传入的 pbuf**（`pbuf_free(p)`），否则内存池会被耗尽——这是 RAW 编程最容易踩的坑，比"忘了注册回调"还隐蔽。

## 3. RAW API 风格：回调驱动的"内核里办事"

RAW API 是离 lwIP 内核最近的接口（(PDF p.269)），风格特点：

- 🎯 **回调驱动**：接收函数由你编写，用 `udp_recv` 注册进控制块；内核收到数据直接调你的函数（NETCONN/Socket 则无需用户写回调，内核注册的回调会把数据塞进邮箱）
- 🚫 **无阻塞**：所有函数立即返回，绝不等待；"等待收包"这件事不存在，数据来了自然调你
- ⚡ **高效率**：无 OS 也能跑、无线程切换、零拷贝路径最短，适合协议栈内部（如 DHCP、DNS 客户端）和追求性能/低资源的场景
- 🧠 **代价**：你得懂协议栈、自己管理 pbuf 生命周期、数据量大时回调里不能干重活

一句话：**RAW 像"在协议栈内部上班"，NETCONN 像"在办公室打电话办事"**。本课先练 RAW，第 11 课再对比着学 NETCONN。

## 4. RAW UDP 接口全家桶

教材列出的 RAW UDP API（(PDF p.269)）：

| 函数 | 作用 |
|------|------|
| `udp_new()` | 从内存池申请一个 UDP 控制块（udp_pcb），初始化后 TTL=255 |
| `udp_remove(pcb)` | 把控制块从 udp_pcbs 链表摘除并释放内存 |
| `udp_bind(pcb, ip, port)` | 绑定本地 IP 和端口，注册进链表 |
| `udp_connect(pcb, ip, port)` | "连接"远端 IP/端口（UDP 无真实连接，只记录对端，之后可只用 udp_send） |
| `udp_disconnect(pcb)` | 断开"连接"，回到非连接状态 |
| `udp_send(pcb, p)` | 发给已 connect 的对端 |
| `udp_sendto(pcb, p, dst_ip, dst_port)` | 指定目的 IP/端口发送（官方 API，最常用） |
| `udp_recv(pcb, recv_fn, arg)` | 注册接收回调函数及参数，必须调用才能收到数据 |

回调函数签名（`udp_recv_fn`）：

```c
/* 接收回调原型：arg 为注册时传入的参数，upcb 是控制块，
   p 是收到的数据（由回调负责释放），addr/port 是发送方地址 */
void udp_recv_fn(void *arg, struct udp_pcb *upcb,
                 struct pbuf *p, const ip_addr_t *addr, u16_t port);
```

> 💡 `udp_recv` 的实现就两行：`pcb->recv = recv; pcb->recv_arg = recv_arg;`——把函数指针塞进控制块而已（(PDF p.270)）。看懂这个，你就懂了 RAW API 的本质：**注册 = 让内核的某个指针指向你的函数**。

## 5. 最小可用代码：RAW UDP 收发全流程

参考教材 11.3 节（(PDF p.271)），配置步骤五连：`udp_new` → `udp_connect`（绑定远端）→ `udp_bind`（绑定本地）→ `udp_recv`（注册回调）→ `udp_send`/`udp_sendto`（发送）。下面给出一份能直接跑通的最小工程骨架：

### 5.1 创建、绑定、注册（初始化阶段）

```c
/* 简化自教材 lwip_demo()：创建 + 连接 + 绑定 + 注册回调 */
struct udp_pcb *udp_echoserver_init(void)
{
    struct udp_pcb *upcb;
    ip_addr_t rmtipaddr;
    err_t err;

    /* 1. 创建 UDP 控制块（内存来自 MEMP_UDP_PCB 内存池） */
    upcb = udp_new();
    if (upcb == NULL) {
        printf("udp_new 失败\r\n");
        return NULL;
    }

    /* 2. 指定远端：电脑 IP 192.168.1.2，端口 8080 */
    IP4_ADDR(&rmtipaddr, 192, 168, 1, 2);
    err = udp_connect(upcb, &rmtipaddr, 8080);
    if (err != ERR_OK) {
        udp_remove(upcb);
        return NULL;
    }

    /* 3. 绑定本地端口 8080（IP_ADDR_ANY 表示绑定所有本地 IP） */
    err = udp_bind(upcb, IP_ADDR_ANY, 8080);
    if (err != ERR_OK) {
        udp_remove(upcb);
        return NULL;
    }

    /* 4. 注册接收回调（不注册 = 永远收不到数据） */
    udp_recv(upcb, udp_demo_recv_callback, NULL);
    return upcb;
}
```

### 5.2 接收回调（内核"送货上门"）

```c
/* 接收回调：数据以 pbuf 链表形式递进来，用完必须 pbuf_free */
static void udp_demo_recv_callback(void *arg, struct udp_pcb *upcb,
                                   struct pbuf *p,
                                   const ip_addr_t *addr, u16_t port)
{
    struct pbuf *q;
    u16_t data_len = 0;

    if (p == NULL) {
        udp_disconnect(upcb);          /* 空数据表示连接异常，断开 */
        return;
    }

    memset(recv_buf, 0, RECV_BUF_SIZE);          /* 接收缓冲区清零 */

    /* 遍历 pbuf 链表，把数据全部拷贝到用户缓冲区（注意防越界） */
    for (q = p; q != NULL; q = q->next) {
        if (q->len > (RECV_BUF_SIZE - data_len)) {
            memcpy(recv_buf + data_len, q->payload, RECV_BUF_SIZE - data_len);
            break;
        }
        memcpy(recv_buf + data_len, q->payload, q->len);
        data_len += q->len;
    }

    printf("收到 %d.%d.%d.%d:%d 的数据: %s\r\n",
           (addr->addr & 0xff), ((addr->addr >> 8) & 0xff),
           ((addr->addr >> 16) & 0xff), ((addr->addr >> 24) & 0xff),
           port, recv_buf);

    pbuf_free(p);                      /* ★ 必须释放，否则内存池泄漏 */
}
```

### 5.3 发送数据（用 udp_sendto 指定对端）

```c
/* 发送数据：数据装进 pbuf，交给 udp_sendto 发往指定 IP/端口 */
err_t udp_send_data(struct udp_pcb *upcb, const char *data)
{
    struct pbuf *ptr;
    err_t err;

    /* 申请 PBUF_TRANSPORT 类型 pbuf（自动预留 UDP 首部空间） */
    ptr = pbuf_alloc(PBUF_TRANSPORT, strlen(data), PBUF_POOL);
    if (ptr == NULL) {
        return ERR_MEM;
    }

    /* 把用户数据拷进 pbuf 的 payload */
    pbuf_take(ptr, data, strlen(data));

    /* 指定对端发送：192.168.1.2:8080（即使没 connect 也能发） */
    ip_addr_t dst;
    IP4_ADDR(&dst, 192, 168, 1, 2);
    err = udp_sendto(upcb, ptr, &dst, 8080);

    pbuf_free(ptr);                    /* 发送完释放 */
    return err;
}
```

> ⚠️ 发送用的 pbuf 由 **你的代码申请和释放**（`udp_sendto` 不会帮你释放）；接收用的 pbuf 由 **回调函数释放**。两条规则记牢，RAW 内存就不会乱。

## 动手练习（约 45 分钟）

### 练习 9.1：板子 ↔ 电脑 UDP 互发（网络调试助手）

- 1️⃣ 电脑网卡配静态 IP `192.168.1.2`，掩码 `255.255.255.0`；板子固定 `192.168.1.10`，网线直连。
- 2️⃣ 在你的 lwIP 实验工程里新建 udp_demo.c，把第 5 节三段代码按"初始化 → 回调 → 发送"组装好，主循环里用按键触发发送。
- 3️⃣ 电脑打开网络调试助手（SocketTool / 网络调试助手均可）：**协议选 UDP，本地端口填 8080**，点击"连接"进入监听。
- 4️⃣ 板子发数据 → 工具里应收到板子 192.168.1.10 发来的载荷；工具发送框输入任意字符串回发 → 板子串口应打印出"收到 192.168.1.2:xxxx 的数据"。
- 5️⃣ 验收标准：双向数据都到达对端，且无乱码、无丢失（连续发 50 次计数对比）。

### 练习 9.2：Wireshark 抓包验证 UDP 报文

- 1️⃣ 打开 Wireshark，选电脑的以太网网卡，过滤条件输入 `udp.port == 8080`。
- 2️⃣ 让板子发一条 "ALIENTEK DATA"（或任意字符串），在 Wireshark 里找到这条 UDP 报文，展开查看：
- 3️⃣ 核对四个字段：Source Port（板子本地端口）、Destination Port（8080）、Length（8 + 数据长度）、Checksum。再用 **Follow UDP Stream** 看完整载荷是否与串口打印一致。
- 4️⃣ 思考：Length 为什么比你发的数据多 8？如果板子没绑定本地端口就发送，源端口会是多少？

## 自测（答完再点答案）

### 随堂小测 1

Q1. UDP 首部共多少字节，包含哪四个字段？

- A. 20 字节：源端口、目的端口、序号、确认号
- B. 8 字节：源端口、目的端口、长度、校验和
- C. 12 字节：源端口、目的端口、校验和、紧急指针

<details>
<summary>查看答案</summary>

B。UDP 首部固定 8 字节，4 个 u16 字段：源/目的端口、长度、校验和（PDF p.260）。

</details>

### 随堂小测 2

Q2. RAW 接口下，内核收到 UDP 数据后做了什么？

- A. 把数据拷贝到全局缓冲区并设置标志位
- B. 调用控制块 recv 字段指向的用户回调函数
- C. 直接丢弃并回复 ICMP 差错报文

<details>
<summary>查看答案</summary>

B。udp_input 遍历 udp_pcbs 找到匹配控制块后调用 pcb->recv 回调；回调里必须 pbuf_free（PDF p.268）。

</details>

### 随堂小测 3

Q3. 用 udp_recv 注册的回调函数，谁负责释放接收到的 pbuf？

- A. 内核在调用后自动释放
- B. 由用户回调函数负责释放
- C. 由 udp_remove 统一释放

<details>
<summary>查看答案</summary>

B。udp_input 源码注释明确"回调函数 recv 需要负责释放 p"（PDF p.267）。

</details>

### 随堂小测 4

Q4. 板子要主动给电脑 192.168.1.2:8080 发包，最合适的函数是？

- A. udp_sendto(upcb, p, &dst, 8080)
- B. udp_remove(upcb) 后重建控制块
- C. udp_recv(upcb, NULL, NULL) 直接发送

<details>
<summary>查看答案</summary>

A。udp_sendto 指定目的 IP 与端口直接发送；udp_remove 是删控制块，udp_recv 是注册回调，都不能发包。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 11 章（(PDF p.260~280)）——UDP 协议、源码解析与 RAW UDP 实验
- 🌐 [lwIP 官网](https://savannah.nongnu.org/projects/lwip/)——查阅 udp.h 中 udp_sendto / udp_recv_fn 的官方声明
- 📕 RFC 768（UDP）——最简协议 RFC，通读一遍只需十分钟

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 10 课——RAW API · TCP，从"发出去就完事"的 UDP 进阶到"三次握手 + 重传 + 滑动窗口"的可靠传输，难度陡增但收获翻倍。

| [← 上一课](/my-blog/posts/lwip/0008-ip-and-icmp/) | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0010-raw-tcp/) |
