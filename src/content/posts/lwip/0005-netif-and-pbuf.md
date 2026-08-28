---
title: 网络接口与数据包
published: 2026-08-18
description: netif 网卡抽象与注册流程、pbuf 数据结构与四种类型、协议层间的收发路径。
tags: [lwIP, 嵌入式, netif, pbuf]
category: lwIP
draft: false
prevTitle: 协议栈内核机制
prevSlug: "lwip/0006-kernel-internals"
nextTitle: 内存管理
nextSlug: "lwip/0004-memory-management"
---

# 网络接口与数据包

> netif 网卡抽象、注册流程、pbuf 数据结构、协议层间的收发路径（预计 60~90 分钟）

**本课目标：**🎯 上节课我们把内存管理（堆 + 池）搞清楚了，这节课看两个站在内存之上的主角：`netif`（lwIP 眼里的"一张网卡"）和 `pbuf`（协议栈的"数据容器"）。学完你能说清：netif 结构体每个字段干嘛用的、网卡注册的"三步曲"、pbuf 四种类型和它的链表玩法、以及一个数据包从应用层出发到网线、再从网线回来的完整投递路线。这是后面看懂 ARP/IP/TCP 源码的必备底盘。

## 1. netif：lwIP 眼里的"一张网卡"

网卡种类千千万，lwIP 怎么做到通吃？答案就一句话：**用结构体 `netif` 抽象一张网卡，凡是"能收发网络数据的硬件"都能塞进去**（正点原子《lwIP 开发指南 V1.7》第 5.1 节 (PDF p.181)）。网卡初始化、收发数据这类跟硬件强相关的活儿，lwIP 不替你干，它留好函数指针等你填——好在官方给了 `ethernetif.c` 驱动模板，照着改就行。

先看这个核心结构体（`netif.h`）：

```c
struct netif {
    struct netif *next;          /* 指向下一个 netif，多网卡组成链表 */
    /* IP 地址相关配置 */
    ip_addr_t ip_addr;           /* 网络接口的 IP 地址 */
    ip_addr_t netmask;           /* 子网掩码 */
    ip_addr_t gw;                /* 网关地址 */
    /* 该函数向 IP 层输入数据包（网卡收包后调用它） */
    netif_input_fn input;
    /* 该函数发送 IP 包（IP 层发数据时调用，一般指向 etharp_output） */
    netif_output_fn output;
    /* 该函数实现底层数据包发送（ARP 层调用，最终走向网卡驱动） */
    netif_linkoutput_fn linkoutput;
    /* 用户自定义，例如指向底层设备相关信息 */
    void *state;
    void* client_data[...];      /* 给上层协议（DHCP 等）挂私有数据 */
    u16_t mtu;                   /* 接口允许的最大数据包长度，一般 1500 */
    u8_t hwaddr_len;             /* MAC 地址长度，6 字节 */
    u8_t hwaddr[NETIF_MAX_HWADDR_LEN]; /* 物理地址（MAC） */
    u8_t flags;                  /* 接口的状态、属性字段 */
    char name[2];                /* 网卡名字，如 "en" */
    u8_t num;                    /* 网卡编号，从 0 开始 */
    u8_t rs_count;               /* 发送的路由器请求消息数量 */
};
```

| 字段 | 一句话解释 |
|------|------------|
| `next` | 链表指针。多张网卡 = 多个 netif 串成单向链表，头部由全局指针 `netif_list` 指着 |
| `ip_addr / netmask / gw` | 这张网卡的 IP、掩码、网关——你的板子配 `192.168.1.10 / 255.255.255.0 / 网关` 就存在这 |
| `input` | 收包入口：网卡驱动拿到数据后调用它，带 OS 时指向 `tcpip_input`（第 6 课主角） |
| `output` | 发 IP 包的出口：IP 层调它，以太网接口上填 `etharp_output()`（第 7 课主角） |
| `linkoutput` | 最后一棒：ARP 模块调它完成真正的底层发送，以太网上填驱动里的 `low_level_output()` |
| `state` | 自由空间，驱动可以指向自己的设备结构体 |
| `mtu / hwaddr / hwaddr_len` | MTU 1500、MAC 6 字节——Wireshark 里看到的帧长上限就是它决定的 |
| `flags` | 状态位：`NETIF_FLAG_UP`(0x01 已启用)、`NETIF_FLAG_BROADCAST`(0x02)、`NETIF_FLAG_LINK_UP`(0x04 链路通)、`NETIF_FLAG_ETHARP`(0x08)、`NETIF_FLAG_ETHERNET`(0x10) 等 |
| `name / num` | 网卡名字和编号，多网卡时用来区分，比如 "en0"、"en1" |

管理这些网卡的还有三个全局变量：`netif_list`（链表头）、`netif_default`（默认网卡，发数据优先找它）、`netif_num`（给网卡分配唯一编号）。

> 💡 记忆锚点：netif 就是一张"网卡简历"——**写着地址信息（IP/MAC），装着收发函数（input/output/linkoutput），挂着状态（flags）**。协议栈不认识什么 STM32、什么 LAN8720A，它只认这份简历。

## 2. 网卡注册"三步曲"

想让协议栈认识你的板载网卡，得走三步（教材例程 `lwip_comm.c` 里就是这么干的）：

1. **`netif_add()`**：创建并注册 netif——填好 IP/掩码/网关、指定初始化函数和输入函数，然后头插到 netif 链表里
2. **`netif_set_default()`**：把它设为默认网卡（相当于"默认出口"），后续发包优先用它
3. **`netif_set_up()`**：把 `NETIF_FLAG_UP` 置位，告诉协议栈"这张网卡上岗了"

教材上 `netif_add` 的用法示例（(PDF p.184)）：

```c
/* 将网络接口添加到链表中 */
netif_add(&xnetif, &ipaddr, &netmask, &gw, NULL, &ethernetif_init, &tcpip_input);
/* 注册默认的网络接口（默认网卡） */
netif_set_default(&xnetif);
/* 使能网卡（内部把 NETIF_FLAG_UP 置 1，并触发状态回调） */
netif_set_up(&xnetif);
```

注意 `netif_add` 的最后一个参数 `tcpip_input`，它会被填进 `netif->input`——这就是后面"网卡收包 → 协议栈"的传送门。而 `ethernetif_init` 是驱动提供的初始化函数，它负责把网卡的 MAC、MTU 填好，并把 `netif->output = etharp_output`、`netif->linkoutput = low_level_output` 挂上。

多网卡时链表长这样（新网卡头插）：

```c
netif_list ──► netif1（最新加入） ──► netif0（最先加入） ──► NULL
               │                       │
               num = 1                num = 0
               input = tcpip_input    input = tcpip_input
```

> ⚠️ 三步顺序不能乱：先 `netif_add` 再 `netif_set_default` 再 `netif_set_up`。如果忘了 `netif_set_up`，网卡一直处于"没上岗"状态——ping 不通是小事，查半天找不到原因才崩溃。移植时 ping 不通先检查这一步。

## 3. pbuf：协议栈的"乐高积木"

数据包在 lwIP 里不是一块死板的整块内存，而是一个 **pbuf 链表**。为什么要搞这么复杂？因为各层都要往数据前面加自己的首部（第 1 课的"套娃"），如果每层都整块拷贝一次，性能直接报废。pbuf 的解法是：**只动指针，不搬数据**（第 6 章 (PDF p.186)）。

结构体长这样（`pbuf.h`，(PDF p.187)）：

```c
struct pbuf {
    struct pbuf *next;      /* 链表中下一个 pbuf */
    void *payload;          /* 数据指针，指向本 pbuf 管理的数据区 */
    u16_t tot_len;          /* 当前 pbuf 及后续所有 pbuf 的数据总长 */
    u16_t len;              /* 当前 pbuf 的数据长度 */
    u8_t   type;            /* pbuf 类型 */
    u8_t flags;             /* 状态位，目前基本没用 */
    LWIP_PBUF_REF_T ref;    /* 引用计数：几个地方指着这个 pbuf */
    u8_t if_idx;            /* 收包时记录输入网卡的索引 */
};
```

关键就四个字段的配合：**`payload` 指数据、`len` 管这一段、`tot_len` 管整条链、`next` 串下一段**。比如一条链上有三块 pbuf，第一块的 tot_len = 三块数据之和，第二块 = 后两块之和……最后一块 tot_len = len。

pbuf 有四种类型，区别在于"内存从哪儿来、数据归谁管"：

| 类型 | 数据存储 | 特点 | 典型场景 |
|------|----------|------|----------|
| `PBUF_RAM` | 内存堆（`mem_malloc`） | 结构体和数据区连续，分配稍慢 | 协议栈发送数据，最常用 |
| `PBUF_POOL` | 内存池（`memp_malloc`） | 分配极快，块大小固定，大包自动串成链表 | 网卡收包 |
| `PBUF_REF` | 结构体在池里，数据区在别处的 RAM | 不复制数据，只"引用" | 分片、零拷贝转发 |
| `PBUF_ROM` | 结构体在池里，数据区在 ROM | 适合发送静态数据（如固定网页） | 发常量数据，省内存 |

> 💡 一个数据包可以"混搭"：RAM 头 + REF 数据 + ROM 常量，串成一条链。这就是 lwIP 内存共享的威力——**同一块数据，各层只是换了个角度看它**，拷贝只在必要时发生。

## 4. pbuf_alloc 与五个操作函数

申请 pbuf 用 `pbuf_alloc(layer, length, type)`（(PDF p.190)）：

- **layer**：预留几层首部空间——`PBUF_RAW`(0)/`PBUF_LINK`(预留以太网首部)/`PBUF_IP`(预留以太网+IP 首部)/`PBUF_TRANSPORT`(再预留 TCP/UDP 首部)。layer 越大，payload 指针初始偏移越大
- **length**：要装的数据长度
- **type**：上面四种类型之一

用法示例（RAW API 里发数据时的标准姿势）：

```c
struct pbuf *p;
/* 申请一块带 IP 首部预留空间、能装 100 字节数据的 PBUF_RAM */
p = pbuf_alloc(PBUF_IP, 100, PBUF_RAM);
if (p == NULL) {
    printf("pbuf 申请失败!\r\n");     /* 内存不够，返回 NULL */
    return;
}
/* 往数据区写数据（payload 已自动避开首部预留区） */
memcpy(p->payload, "hello lwIP", 10);
/* ... 交给协议栈发送 ... */
pbuf_free(p);                          /* 用完释放，别忘了 */
```

PBUF_POOL 的分配有个有趣的行为：当 length 大于单块池大小（默认 `PBUF_POOL_BUFSIZE`）时，函数内部用 do-while 循环连续申请多个池块，一块块串成链表——首块还能带 offset 预留首部，后面的块 offset 清零只装数据（(PDF p.190~192)）。收包时 1600 字节的帧就是这么被拆成几块链起来的。

配套的五个操作函数（(PDF p.189~194)）：

| 函数 | 干什么 |
|------|--------|
| `pbuf_alloc()` | 申请 pbuf（按类型走堆/池/引用三条路） |
| `pbuf_free()` | 释放：引用计数 ref 减 1，减到 0 才真释放，并顺着链表逐个处理 |
| `pbuf_realloc()` | 从链表尾部砍掉多余长度（只改长度字段，不真释放内存） |
| `pbuf_header()` | 前后移动 payload 指针（加首部/去首部），len/tot_len 同步调整 |
| `pbuf_take()` | 把数据拷进 pbuf 的数据区（REF/ROM 转 RAM 时用） |

其中 `pbuf_header()` 是"套娃/剥洋葱"的物理实现——各层加首部就是 `pbuf_header(p, +n)` 往前挪指针，去首部就是 `pbuf_header(p, -n)` 往后挪。零拷贝的奥秘全在这。

## 5. 发送与接收：数据包的"投递路线"

把 netif 的三个回调串起来，整个数据包的旅程就清楚了（第 6.1 节 (PDF p.186)）：

```c
发送方向（数据往外走，套娃加首部）
  应用层   tcp_write()   用户数据放入 TCP 发送队列
     ↓
  传输层   tcp_output()  组装 TCP 首部
     ↓
  网络层   ip_output()   组装 IP 首部，查路由选中 netif
     ↓
   ARP    netif->output = etharp_output()   解析目标 MAC（第 7 课）
     ↓
  接口层   netif->linkoutput = low_level_output()  填以太网首部进 DMA
     ↓
  硬件     ETH 外设 → LAN8720A → 网线

接收方向（数据往内走，剥洋葱去首部）
  硬件     ETH 中断 → 释放信号量
     ↓
  网卡任务 ethernetif_input() → low_level_input() 取出 pbuf
     ↓
  netif->input = tcpip_input()    消息投递（第 6 课）
     ↓
  协议栈线程 tcpip_thread → ethernet_input()  按帧类型分发
     ↓
  网络层   ip4_input()
     ↓
  传输层   tcp_in() / udp_input()
     ↓
  应用层   回调函数收到数据
```

注意中间那层 ARP：IP 层不直接调驱动，而是先经过 `netif->output`（etharp_output）把"目标 IP"翻译成"目标 MAC"，再由 `linkoutput` 完成真正的发送。这条链以后每课都会见到，先留个印象。

## 动手练习

### 练习 5.1：写代码打印网卡 MAC / IP / MTU

- 1️⃣ 在你的 lwIP 实验工程里（网卡初始化完成、ping 通之后），加一个打印函数并调用：

```c
#include "lwip/netif.h"
#include "lwip/ip_addr.h"

void netif_dump(void)
{
    struct netif *nif = netif_list;   /* 链表头，从第一张网卡开始 */
    printf("==== 网卡信息 ====\r\n");
    while (nif != NULL)
    {
        printf("网卡名 : %c%c%d\r\n", nif->name[0], nif->name[1], nif->num);
        printf("IP     : %s\r\n", ip4addr_ntoa(&nif->ip_addr));
        printf("掩码   : %s\r\n", ip4addr_ntoa(&nif->netmask));
        printf("网关   : %s\r\n", ip4addr_ntoa(&nif->gw));
        printf("MTU    : %d\r\n", nif->mtu);
        printf("MAC    : ");
        for (u8_t i = 0; i < nif->hwaddr_len; i++)
            printf("%02x%c", nif->hwaddr[i], (i == 5) ? '\n' : ':');
        printf("flags  : 0x%02x\r\n", nif->flags);
        nif = nif->next;              /* 遍历下一张网卡 */
    }
}
```

- 2️⃣ 编译下载，串口应能看到 IP=192.168.1.10、MTU=1500、MAC 为 6 字节、flags 含 UP 位。
- 3️⃣ 思考：flags 里哪些位被置 1 了？用 Wireshark 的抓包对照一下 MAC 是不是真的出现在帧里（下个练习）。

### 练习 5.2：抓包看 pbuf 对应的以太网帧

- 1️⃣ 电脑 `ping 192.168.1.10`，Wireshark 过滤 `icmp`，选一个 Echo (ping) request 帧。
- 2️⃣ 展开 `Ethernet II` 层：目的 MAC(6 字节) + 源 MAC(6 字节) + 帧类型(2 字节，IP 为 0x0800)——这 14 字节就是以太网首部，对应驱动里的 `eth_hdr` 结构体。
- 3️⃣ 再数一遍：帧总长 60 字节 = 14(以太网首部) + 20(IP 首部) + 8(ICMP 首部) + 数据。回想一下 pbuf 申请时的 layer 参数——**这一帧对应一条（或几条）pbuf 链**：payload 初始指向 IP 首部位置，链路层填好以太网首部后整链交给 DMA。
- 4️⃣ 试试把板子复位，观察重启后第一帧是不是 ARP 请求（0x0806）——说明 netif 注册完成后协议栈立刻开始干活了。

## 自测

### 随堂小测 1

**Q1. netif 结构体中负责"最终把帧发到物理介质"的回调是哪个？**

- input 回调函数
- output 回调函数
- linkoutput 回调函数
- state 状态指针

<details>
<summary>查看答案</summary>

C。linkoutput 被 ARP 模块调用完成底层发送（以太网接口上指向驱动 low_level_output）；output 负责发 IP 包前的地址解析（PDF p.181）。

</details>

**Q2. 关于 pbuf 的 tot_len 与 len，正确的说法是？**

- tot_len 是当前 pbuf 的数据长度，len 是整个链表总长
- tot_len 是当前及后续所有 pbuf 数据总长，len 是当前 pbuf 数据长
- 两者始终相等，没有区别
- 只有 PBUF_RAM 类型才有 tot_len

<details>
<summary>查看答案</summary>

B。tot_len = 当前 pbuf 的 len + 后续所有 pbuf 的 len 之和；链表末端的 pbuf 两者相等（PDF p.187）。

</details>

**Q3. 网卡接收数据时，lwIP 通常用哪种 pbuf 包装收到的帧？**

- PBUF_RAM（内存堆分配）
- PBUF_POOL（内存池分配）
- PBUF_ROM（ROM 数据区）
- PBUF_REF（引用外部 RAM）

<details>
<summary>查看答案</summary>

B。收包路径要快，内存池分配极快且大包自动串链表，因此收包用 PBUF_POOL（PDF p.188）。

</details>

**Q4. 网卡注册三步曲的正确顺序是？**

- netif_set_up → netif_set_default → netif_add
- netif_add → netif_set_default → netif_set_up
- netif_set_default → netif_add → netif_set_up
- 先后顺序没有任何影响

<details>
<summary>查看答案</summary>

B。先 netif_add 注册入链表，再 set_default 指定默认出口，最后 set_up 置 UP 位上岗（PDF p.184，教材例程 lwip_comm.c 亦如此）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 5 章（(PDF p.181~185)）——netif 结构体与网卡注册
- 📖 正点原子《lwIP 开发指南 V1.7》第 6 章（(PDF p.186~195)）——pbuf 结构与操作函数
- 🌐 [lwIP 官网文档](https://www.nongnu.org/lwip/)——`lwIP API reference` 里 netif/pbuf 的完整 API 说明
- 🌐 [IEEE 802.3 以太网帧格式（Wikipedia）](https://en.wikipedia.org/wiki/IEEE_802.3)——对照帧结构理解 pbuf 里的 payload 布局

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 6 课——数据从网卡进来后怎么"过安检"进内核：网络接口接收流程、超时机制、tcpip_thread 协议栈线程和消息机制，把"网卡 → 内核"的传送带看个明白。

| [← 上一课](/my-blog/posts/lwip/0004-memory-management/) | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0006-kernel-internals/) |