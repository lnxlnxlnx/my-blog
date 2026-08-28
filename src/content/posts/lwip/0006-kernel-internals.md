---
title: 协议栈内核机制
published: 2026-08-19
description: 网卡收包链路、lwIP 超时机制、tcpip_thread 线程与消息机制。
tags: [lwIP, 嵌入式, 内核, 线程]
category: lwIP
draft: false
prevTitle: ARP 协议
prevSlug: "lwip/0007-arp-protocol"
nextTitle: 网络接口与数据包
nextSlug: "lwip/0005-netif-and-pbuf"
---

# 协议栈内核机制

> 网卡收包链路、lwIP 超时机制、tcpip_thread 线程与消息机制（预计 60~90 分钟）

**本课目标：**🎯 第 5 课我们认识了 netif 和 pbuf，但还差"最后一公里"：数据从网卡 DMA 里拿出来之后，是怎么安全地送进协议栈内核的？答案藏在一个线程和一堆消息里。学完你能说清：`ethernetif_input → tcpip_input → 邮箱 → tcpip_thread` 这条收包传送带、lwIP 的"闹钟管家"超时机制（tcp_tmr、etharp_tmr 这些协议定时器从哪来）、tcpip_thread 的循环到底在干什么，以及 tcpip_msg 消息是怎么串起用户线程和内核线程的。这是理解"裸机 vs 带 OS"差异的关键一课。

## 1. 收包链路：从 ETH 中断到 tcpip_thread

教材第 7.1 节（(PDF p.196)）画了带操作系统的 lwIP 收包全景图，核心思想是：**中断里只"报个信"，搬砖的活儿交给线程**。整条链路如下：

```c
ETH 中断（收到一个帧）
   │  释放信号量 s_xSemaphore（只干这一件事，快！）
   ▼
ethernetif_input 线程（被信号量唤醒）
   │  low_level_input()   从 DMA 描述符取出数据 → 包进 PBUF_POOL 的 pbuf
   │  调用 netif->input(p, netif)  即 tcpip_input()
   ▼
tcpip_input()
   │  tcpip_inpkt(p, inp, ethernet_input)
   │  申请 tcpip_msg，填好 pbuf/netif/input_fn，投进 tcpip_mbox 邮箱
   ▼
tcpip_mbox 邮箱（一个"邮筒"，先进先出）
   ▼
tcpip_thread 协议栈线程（阻塞等消息，醒来处理）
   │  TCPIP_MBOX_FETCH()   取出一条消息（顺带处理超时，见第 2 节）
   │  tcpip_thread_handle_msg()  按消息类型分发
   ▼
ethernet_input()   判断以太网帧类型
   │  type == 0x0800 (IP)   → ip4_input()   网络层
   │  type == 0x0806 (ARP)  → etharp_input() ARP 处理（第 7 课）
   ▼
TCP / UDP / ICMP 协议处理...
```

为什么绕这么大一圈？因为 **协议栈内核不是中断安全的**——如果直接在中断里解析 IP/TCP，实时性会把协议栈逻辑搅乱。所以 lwIP 的经典设计是：中断只发信号，内核线程慢慢消费。这也解释了为什么 `ethernetif_input` 在裸机移植里会变成主循环里的轮询函数——没有 OS 就用"人肉调度"。

> 💡 记忆锚点：**"中断报信、线程搬砖、邮箱转运、协议栈只认消息"**。以后看任何 lwIP 数据流，先找"谁在投递、谁在接收"。

## 2. lwIP 超时机制：看不见的"闹钟管家"

协议栈里到处都需要"过一会儿再处理"：TCP 重传超时、IP 分片重装等待、ARP 缓存老化、DHCP 租约刷新……lwIP 用一套统一的超时链表来管理（第 7.2 节 (PDF p.196~201)，代码在 `timeouts.c/h`）。

先看"有哪些闹钟"——`lwip_cyclic_timers` 数组定义了内核需要的全部周期定时器：

```c
const struct lwip_cyclic_timer lwip_cyclic_timers[] = {
    {TCP_TMR_INTERVAL,   HANDLER(tcp_tmr)},        /* 250ms：TCP 超时/重传 */
    {IP_TMR_INTERVAL,    HANDLER(ip_reass_tmr)},   /* 1000ms：IP 分片重装超时 */
    {ARP_TMR_INTERVAL,   HANDLER(etharp_tmr)},     /* 1000ms：ARP 缓存老化 */
    {DHCP_COARSE_TIMER_MSECS, HANDLER(dhcp_coarse_tmr)}, /* 60s：DHCP 粗定时器 */
    {DHCP_FINE_TIMER_MSECS,   HANDLER(dhcp_fine_tmr)},   /* 500ms：DHCP 细定时器 */
    {AUTOIP_TMR_INTERVAL, HANDLER(autoip_tmr)},
    {IGMP_TMR_INTERVAL,   HANDLER(igmp_tmr)},
    {DNS_TMR_INTERVAL,    HANDLER(dns_tmr)},
};
```

每个元素 = 间隔（interval_ms）+ 超时处理函数（handler）。这些闹钟由 `sys_timeouts_init()` 逐个注册进一条"超时链表"。

链表节点是 `sys_timeo`：

```c
struct sys_timeo {
    struct sys_timeo *next;   /* 下一个超时事件 */
    u32_t time;               /* 触发时刻 = 当前系统节拍 + 等待时长 */
    sys_timeout_handler h;    /* 超时回调函数 */
    void *arg;                /* 回调参数（指向 lwip_cyclic_timers 里的元素） */
};
```

工作流程（(PDF p.197~201)）：

1. **注册**：`sys_timeout(msecs, handler, arg)` 算出绝对触发时刻 `time = sys_now() + msecs`，再用 `sys_timeout_abs()` 把节点**按触发时刻升序插入链表**（用 TIME_LESS_THAN 宏处理 u32 回绕，防止时间溢出出错）
2. **检查**（裸机）：主循环周期调用 `sys_check_timeouts()`——看链首（最早到期的）闹钟，到期了就执行回调并删除，直到没有到期为止
3. **检查**（带 OS）：tcpip_thread 用的是 `tcpip_timeouts_mbox_fetch()`——等邮箱消息时把"等待超时"设为"下一个闹钟的剩余时间"，消息没来而闹钟响了，就顺便执行超时回调。这一招让线程"等消息"和"查闹钟"两不误
4. **删除**：`sys_untimeout(handler, arg)` 遍历链表，按回调函数和参数匹配后摘除节点

所以第 7 课的 ARP 缓存老化、第 9 课的 IP 分片重装超时，本质都是"闹钟管家"里的一颗闹钟。现在明白 lwipopts.h 里那些 `TCP_TMR_INTERVAL` 之类的配置在调什么了吧？

## 3. tcpip_thread：协议栈的"单线程大脑"

整个 lwIP 内核只有一个线程在跑，就是 `tcpip_thread`（第 7.3 节 (PDF p.202~203)）。它由 `tcpip_init()` 创建——`tcpip_init` 干三件事：创建邮箱 `tcpip_mbox`（数据通道）、创建互斥锁（防优先级翻转）、创建线程本身。

线程主循环长这样：

```c
static void
tcpip_thread(void *arg)
{
    struct tcpip_msg *msg;
    LWIP_UNUSED_ARG(arg);
    LWIP_MARK_TCPIP_THREAD();
    LOCK_TCPIP_CORE();
    if (tcpip_init_done != NULL) {
        tcpip_init_done(tcpip_init_done_arg);   /* 通知外部"内核就绪" */
    }
    while (1)
    {
        LWIP_TCPIP_THREAD_ALIVE();
        /* 第一步：等待消息，等待期间顺带处理超时事件 */
        TCPIP_MBOX_FETCH(&tcpip_mbox, (void **)&msg);  /* = sys_timeouts_mbox_fetch */
        if (msg == NULL) {
            continue;                 /* 没等到消息，继续等 */
        }
        /* 第二步：拿到消息，按类型处理 */
        tcpip_thread_handle_msg(msg);
    }
}
```

消息处理函数是个大 switch，按 `msg->type` 分流（(PDF p.203)）：

```c
static void
tcpip_thread_handle_msg(struct tcpip_msg *msg)
{
    switch (msg->type)
    {
        case TCPIP_MSG_API:                    /* API 消息：执行内核函数 */
            msg->msg.api_msg.function(msg->msg.api_msg.msg);
            break;
        case TCPIP_MSG_API_CALL:               /* API 调用：执行并回信号量 */
            msg->msg.api_call.arg->err =
                msg->msg.api_call.function(msg->msg.api_call.arg);
            sys_sem_signal(msg->msg.api_call.sem);
            break;
        case TCPIP_MSG_INPKT:                  /* 底层数据包输入：最重要！ */
            if (msg->msg.inp.input_fn(msg->msg.inp.p,
                                      msg->msg.inp.netif) != ERR_OK) {
                pbuf_free(msg->msg.inp.p);     /* 处理失败就释放 pbuf */
            }
            memp_free(MEMP_TCPIP_MSG_INPKT, msg);
            break;
        case TCPIP_MSG_TIMEOUT:                /* 注册超时事件 */
            sys_timeout(msg->msg.tmo.msecs, msg->msg.tmo.h, msg->msg.tmo.arg);
            memp_free(MEMP_TCPIP_MSG_API, msg);
            break;
        case TCPIP_MSG_UNTIMEOUT:              /* 删除超时事件 */
            sys_untimeout(msg->msg.tmo.h, msg->msg.tmo.arg);
            memp_free(MEMP_TCPIP_MSG_API, msg);
            break;
        case TCPIP_MSG_CALLBACK:               /* 回调 */
        case TCPIP_MSG_CALLBACK_STATIC:
            msg->msg.cb.function(msg->msg.cb.ctx);
            memp_free(MEMP_TCPIP_MSG_API, msg);
            break;
        default:
            break;
    }
}
```

> ⚠️ 注意收包路径里 `ethernet_input()`（或 ip_input）是在 tcpip_thread 里被调用的——也就是说**所有协议解析都在这个线程里串行完成**。如果你的应用在回调里写了大计算量的代码，会拖慢整个协议栈（其他包排队等着呢）。这就是后面学 RAW/NETCONN/Socket 三套接口时"回调要快"的原因。

## 4. 消息机制：tcpip_msg 与 api_msg

### 4.1 数据包消息：收包怎么变成消息

lwIP 共定义了 7 种消息类型（第 7.4.1 节 (PDF p.204)）：`TCPIP_MSG_API`、`TCPIP_MSG_API_CALL`、`TCPIP_MSG_INPKT`（数据包输入）、`TCPIP_MSG_TIMEOUT`、`TCPIP_MSG_UNTIMEOUT`、`TCPIP_MSG_CALLBACK`、`TCPIP_MSG_CALLBACK_STATIC`。

消息结构体 `tcpip_msg` 里最妙的是 `msg` 字段——一个共用体，每种消息各取所需：

```c
struct tcpip_msg {
    enum tcpip_msg_type type;    /* 消息类型 */
    union {                      /* 消息内容：共用体，按类型解读 */
        struct {                 /* API 消息内容：函数指针 + 参数 */
            tcpip_callback_fn function;
            void* msg;
        } api_msg;
        struct {                 /* API 调用：函数 + 参数 + 同步信号量 */
            tcpip_api_call_fn function;
            struct tcpip_api_call_data *arg;
            sys_sem_t *sem;
        } api_call;
        struct {                 /* 数据包消息：pbuf + 网卡 + 处理函数 */
            struct pbuf *p;
            struct netif *netif;
            netif_input_fn input_fn;
        } inp;
        struct {                 /* 回调消息 */
            tcpip_callback_fn function;
            void *ctx;
        } cb;
        struct {                 /* 超时消息 */
            u32_t msecs;
            sys_timeout_handler h;
            void *arg;
        } tmo;
    } msg;
};
```

收包时消息怎么被构造出来？看 `tcpip_input` → `tcpip_inpkt`（(PDF p.206)）：

```c
err_t
tcpip_input(struct pbuf *p, struct netif *inp)
{
    /* 以太网接口：内核收到包后调用 ethernet_input 解析帧 */
    if (inp->flags & (NETIF_FLAG_ETHARP | NETIF_FLAG_ETHERNET)) {
        return tcpip_inpkt(p, inp, ethernet_input);
    } else {
        return tcpip_inpkt(p, inp, ip_input);   /* 非以太网接口直接进 IP 层 */
    }
}

err_t
tcpip_inpkt(struct pbuf *p, struct netif *inp, netif_input_fn input_fn)
{
    struct tcpip_msg *msg;
    msg = (struct tcpip_msg *)memp_malloc(MEMP_TCPIP_MSG_INPKT);
    if (msg == NULL) {
        return ERR_MEM;
    }
    msg->type = TCPIP_MSG_INPKT;          /* 消息类型：数据包输入 */
    msg->msg.inp.p = p;                   /* 指向 pbuf 数据包 */
    msg->msg.inp.netif = inp;             /* 来自哪张网卡 */
    msg->msg.inp.input_fn = input_fn;     /* 到内核后由谁处理 */
    if (sys_mbox_trypost(&tcpip_mbox, msg) != ERR_OK) {  /* 投递邮箱 */
        memp_free(MEMP_TCPIP_MSG_INPKT, msg);
        return ERR_MEM;
    }
    return ERR_OK;
}
```

注意这里传的是 **tcpip_mbox 全局邮箱**，tcpip_thread 就从它取消息。整个"构造消息 → 投邮箱 → 内核取消息 → 调用 ethernet_input"的循环，就是教材图 7.4.1.1 的完整故事（(PDF p.207)）。

### 4.2 API 消息：用户线程怎么"拜托"内核办事

用户线程和内核线程是两个独立线程，用户调 `netconn_bind()` 这类 API 时，不可能直接进内核改数据——必须发消息（第 7.4.2 节 (PDF p.208~213)）。API 消息内容太多，塞不进 tcpip_msg，所以 lwIP 单独定义了 `api_msg` 结构体：

```c
struct api_msg {
    struct netconn *conn;   /* 当前连接（里面带着连接用的邮箱/信号量） */
    err_t err;              /* 内核执行后的返回结果 */
    union {                 /* 各类 API 的参数 */
        struct netbuf *b;            /* lwip_netconn_do_send 参数 */
        struct { u8_t proto; } n;    /* lwip_netconn_do_newconn 参数 */
        struct { ip_addr_t ipaddr; u16_t port; u8_t if_idx; } bc; /* bind/connect 参数 */
        struct { u32_t len; } r;     /* lwip_netconn_do_recv 参数 */
        /* ... 还有 close / write 等更多参数子结构 */
    } msg;
};
```

以 `netconn_bind()` 为例，一次 API 调用的完整旅程（(PDF p.210~212)）：

```c
err_t
netconn_bind(struct netconn *conn, const ip_addr_t *addr, u16_t port)
{
    API_MSG_VAR_DECLARE(msg);
    /* 第一步：填充 api_msg —— 连接、地址、端口 */
    API_MSG_VAR_REF(msg).conn = conn;
    API_MSG_VAR_REF(msg).msg.bc.ipaddr = *addr;
    API_MSG_VAR_REF(msg).msg.bc.port = port;
    /* 第二步：投递消息并等待内核执行完 */
    err = netconn_apimsg(lwip_netconn_do_bind, &API_MSG_VAR_REF(msg));
    return err;
}
```

中间的 `netconn_apimsg` → `tcpip_send_msg_wait_sem` 是"四步曲"：①构造 tcpip_msg（type=TCPIP_MSG_API，function=lwip_netconn_do_bind，msg 指向 api_msg）②投进邮箱 ③用户线程阻塞在信号量上 ④内核执行完回调函数、回信号量、用户线程醒来。这就是经典的**请求-应答跨线程调用**。

用户与内核之间一共用四种 IPC 机制（(PDF p.210)）：**邮箱**（数据交互）、**信号量**（同步）、**互斥信号量**（防优先级翻转）、**共享内存**（tcpip_msg / api_msg 结构体）。如果你的 lwipopts.h 里开了 `LWIP_TCPIP_CORE_LOCKING`（正点原子例程默认开），走的是更快的"直接上锁调用"路径，邮箱和信号量就省了——但理解消息模型仍然是看懂 NETCONN/Socket 源码的必修课。

## 动手练习

### 练习 6.1：在收包路径上加打印，观察消息流

- 1️⃣ 在你的 lwIP 实验工程里找到 `tcpip_thread_handle_msg()`（在 `tcpip.c`），在 switch 前加一行打印：

```c
/* —— 实验观察点：打印内核收到的消息类型 —— */
printf("[tcpip] msg type = %d\r\n", msg->type);
/* TCPIP_MSG_INPKT == 2 就是收包消息 */
```

- 2️⃣ 再找到 `ethernetif_input()`（在 `ethernetif.c`），在调用 `tcpip_input` 之前打印 pbuf 长度：

```c
p = low_level_input(ethif);          /* 从 DMA 取出一帧 */
if (p != NULL) {
    printf("[eth] 收到一帧, len=%d\r\n", p->len);   /* 观察点 */
    ...
}
```

- 3️⃣ 电脑 `ping 192.168.1.10`，串口应交替出现 `[eth]`（网卡任务侧）和 `[tcpip]`（内核线程侧）打印。观察两个打印来自不同线程上下文（可打印线程句柄验证）。
- 4️⃣ 思考：`[eth]` 打印在 `[tcpip]` 之前还是之后？为什么？

### 练习 6.2：抓包 + 断点，把"传送带"看完整

- 1️⃣ 用调试器在 `tcpip_thread_handle_msg()` 的 `case TCPIP_MSG_INPKT` 处下断点，ping 一次板子。
- 2️⃣ 停住后看调用栈：应该能看到 `ethernet_input → ip4_input → icmp_input` 的走向——这就把第 8 课的 IP/ICMP 处理路径提前摸清了。
- 3️⃣ 看 `msg->msg.inp.p` 的 pbuf 链表：len、tot_len、payload 起始地址，对照第 5 课的 pbuf 结构。
- 4️⃣ 配合 Wireshark：连续 ping 10 次，观察电脑发出的 ICMP request 与板子回的 reply 在时间轴上严格一一对应——协议栈线程串行处理，不会乱序。

## 自测

### 随堂小测 1

**Q1. 带 OS 的 lwIP 中，网卡收包后数据通过什么机制进入协议栈线程？**

- 中断里直接调用 IP 解析函数
- 邮箱 tcpip_mbox 投递 tcpip_msg 消息
- 写进一个全局变量共享
- 通过串口转发的字符串

<details>
<summary>查看答案</summary>

B。ethernetif_input 把 pbuf 包成 TCPIP_MSG_INPKT 消息投进 tcpip_mbox，tcpip_thread 取消息后调用 ethernet_input 解析（PDF p.196/206）。

</details>

**Q2. lwip_cyclic_timers 数组中 tcp_tmr 的默认周期是？**

- 1000 毫秒（1 秒）
- 500 毫秒（0.5 秒）
- 250 毫秒（0.25 秒）
- 100 毫秒（0.1 秒）

<details>
<summary>查看答案</summary>

C。TCP_TMR_INTERVAL 默认 250ms，负责 TCP 超时重传；ARP 老化 etharp_tmr 和 IP 重装 ip_reass_tmr 都是 1000ms（PDF p.197，对应 lwipopts/opt.h）。

</details>

**Q3. tcpip_thread 循环里 TCPIP_MBOX_FETCH 的作用是？**

- 只等消息，不管别的
- 等消息并顺带处理到期超时事件
- 只检查超时链表
- 把消息转发给应用层

<details>
<summary>查看答案</summary>

B。TCPIP_MBOX_FETCH 是 sys_timeouts_mbox_fetch 的宏：等邮箱消息期间，把等待上限设为下一个闹钟时刻，消息没来就先执行到期超时回调（PDF p.201）。

</details>

**Q4. API 消息（如 netconn_bind）最终由谁在内核里执行？**

- 用户线程自己直接执行
- 网卡驱动线程执行
- tcpip_thread 调用内核函数执行
- 硬件中断里执行

<details>
<summary>查看答案</summary>

C。用户线程构造 api_msg + tcpip_msg 投递邮箱，tcpip_thread 收到 TCPIP_MSG_API 消息后调用 lwip_netconn_do_bind 等内核函数执行（PDF p.210~212）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 7 章（(PDF p.196~214)）——本课全部依据，注意教材这章标题叫"lwIP 简介"，内容其实是内核机制
- 🌐 [lwIP OS 层接口文档（2.1.x）](https://www.nongnu.org/lwip/2_1_x/lwip/group__lwip__os__layer.html)——sys_mbox / sys_sem / sys_thread 的系统函数列表
- 📖 FreeRTOS 手册中关于队列（Queue）和信号量（Semaphore）的章节——lwIP 的邮箱在 FreeRTOS 上就是队列实现

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 7 课——ARP 协议：IP 地址怎么翻译成 MAC 地址？请求、应答、缓存、老化，再抓两包看看它的真面目。

| [← 上一课](/my-blog/posts/lwip/0005-netif-and-pbuf/) | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0007-arp-protocol/) |