---
title: ARP 协议
published: 2026-08-20
description: ARP 地址解析：请求/应答流程、缓存表与老化、28 字节报文结构、收发源码解析。
tags: [lwIP, 嵌入式, 网络, ARP]
category: lwIP
draft: false
prevTitle: IP 与 ICMP 协议
prevSlug: "lwip/0008-ip-and-icmp"
nextTitle: 协议栈内核机制
nextSlug: "lwip/0006-kernel-internals"
---

# ARP 协议

> IP 地址如何翻译成 MAC 地址：请求、应答、缓存与老化（预计 60~90 分钟）

**本课目标：**🎯 第 5 课说过，IP 层发数据前要先经过 `netif->output`（etharp_output）把"目标 IP"翻译成"目标 MAC"。这个翻译官就是 ARP。学完你能说清：ARP 协议为什么存在、一次"请求→应答→缓存"的完整流程、ARP 缓存表怎么老化、28 字节 ARP 报文每个字节是干嘛的、lwIP 里 `etharp_raw` / `ethernet_input` / `etharp_input` 的收发源码逻辑，以及如何用 Wireshark 亲手抓住那两包 ARP 报文逐字段验证。

## 1. ARP 是什么：IP 是门牌号，MAC 是身份证号

ARP（Address Resolution Protocol，地址解析协议）：**根据 IP 地址获取物理地址（MAC）的协议**（第 8.1 节 (PDF p.215)）。为什么需要它？以太网帧的"信封"上写的是目标 MAC 地址——网卡硬件只认 MAC 收不收包。而我们的程序只知道"我要发给 192.168.1.2"，不知道它的 MAC 是多少。IP 是给人用的逻辑地址，MAC 是给硬件用的物理地址，中间缺一个"翻译器"，ARP 就是这个翻译器。

工作原理一句话：**在局域网里广播问"谁是 192.168.1.2？报上你的 MAC！"，然后记住答案，下次直接用**。注意 ARP 只在本局域网（网段）里工作，跨网段靠网关（路由器）回答——这一点直连实验里感受最深：你的板子和电脑同网段，ARP 一问一个准。

## 2. 一次完整的地址解析

教材用主机 A（192.168.0.10）找主机 B（192.168.0.11）举例（(PDF p.215~216)），流程四步：

1. **查缓存**：A 先翻自己的 ARP 表，有没有 B 的 IP→MAC 记录？有就直接用，封装以太网帧发出
2. **广播请求**：没有就先把数据包"挂起"，然后广播一个 ARP 请求——"我是 192.168.0.10，MAC 是 00-02-88-88-16-88，谁是 192.168.0.11？告诉我你的 MAC！"。请求里目标 MAC 填全 0，帧的目的 MAC 填广播地址 ff:ff:ff:ff:ff:ff（同网段所有主机都能收到）
3. **单播应答**：B 收到后发现问的是自己，先把 A 的 IP→MAC 存进自己的 ARP 表，然后单播回复——"我是 192.168.0.11，我的 MAC 是 00-02-16-88-88-88"
4. **更新缓存并发送**：A 收到应答，把 B 的映射存入 ARP 表，取出挂起的 IP 数据包，填上 B 的 MAC 封装成帧发出去。数据这才真正上线路

```c
主机A 192.168.0.10 ──────────► 主机B 192.168.0.11
  00-02-88-88-16-88              00-02-16-88-88-88
      │  ①查缓存：没有 B 的 MAC，数据包挂起
      │  ②广播 ARP 请求：目标MAC填全0，帧发往 ff:ff:ff:ff:ff:ff
      │        "谁是 192.168.0.11？我的MAC是 00-02-88-88-16-88"
      │◄──────────┘（同网段所有主机都收到，只有B应答）
      │  ③B 存 A 的记录，单播 ARP 应答：我的MAC是 00-02-16-88-88-88
      │  ④A 存 B 的记录，取出挂起包，填上 B 的 MAC 发出
      ▼
    真正的 IP 数据包（ICMP echo / TCP / UDP...）
```

> 💡 记忆锚点：**请求是"寻人广播"（目标 MAC 全 0，帧目标全 F），应答是"回信单播"（有明确的收件人）**。两个全 0 / 全 F 的地址要记住，后面抓包一眼就能认出是哪种。

## 3. ARP 缓存表：协议栈的"小本本"

lwIP 用一张固定大小的表缓存 IP→MAC 映射（第 8.1 节 (PDF p.216~218)），表项结构（`etharp.c`）：

```c
struct etharp_entry {
#if ARP_QUEUEING
    struct etharp_q_entry *q;   /* 数据包缓存队列（等待应答期间挂起的包） */
#else
    struct pbuf *q;             /* 单个挂起数据包的指针 */
#endif
    ip4_addr_t ipaddr;          /* 目标 IP 地址 */
    struct netif *netif;        /* 对应网卡信息 */
    struct eth_addr ethaddr;    /* 对应的 MAC 地址 */
    u16_t ctime;                /* 生存时间（表项年龄，秒） */
    u8_t state;                 /* 表项的状态 */
};
static struct etharp_entry arp_table[ARP_TABLE_SIZE];   /* 默认 10 个表项 */
```

表只有 10 个表项，查找方式简单粗暴——**遍历**。每个表项有状态机：

| 状态 | 含义 | 结局 |
|------|------|------|
| `ETHARP_STATE_EMPTY` | 空闲，可被新表项占用 | 被分配 |
| `ETHARP_STATE_PENDING` | 已发 ARP 请求、还没收到应答，只记了 IP 没记 MAC，数据包挂在 q 上 | 收到应答 → STABLE；超 5 秒（ARP_MAXPENDING）→ 删除 |
| `ETHARP_STATE_STABLE` | 解析成功，IP→MAC 有效映射，正常使用 | 超 300 秒（ARP_MAXAGE）→ 删除 |
| `STABLE_REREQUESTING_1/2` | 过渡状态：快到期的稳定表项被重新请求确认 | 1 → 2 → 回到 STABLE |

老化由"闹钟管家"（第 6 课）里的 `etharp_tmr` 驱动，每 1 秒（ARP_TMR_INTERVAL）被调用一次，逻辑是（(PDF p.217~218)）：

```c
void
etharp_tmr(void)
{
    u8_t i;
    /* 第一步：遍历整张缓存表（ARP_TABLE_SIZE = 10） */
    for (i = 0; i < ARP_TABLE_SIZE; ++i)
    {
        u8_t state = arp_table[i].state;
        if (state != ETHARP_STATE_EMPTY)      /* 空闲表项跳过 */
        {
            arp_table[i].ctime++;             /* 表项年龄 +1 秒 */
            /* 第三步：超龄的删掉：稳定表项 300 秒，挂起表项 5 秒 */
            if ((arp_table[i].ctime >= ARP_MAXAGE) ||
                ((arp_table[i].state == ETHARP_STATE_PENDING) &&
                 (arp_table[i].ctime >= ARP_MAXPENDING)))
            {
                etharp_free_entry(i);         /* 删除表项，释放挂起的包 */
            }
            else if (arp_table[i].state == ETHARP_STATE_STABLE_REREQUESTING_1)
            {
                arp_table[i].state = ETHARP_STATE_STABLE_REREQUESTING_2;
            }
            else if (arp_table[i].state == ETHARP_STATE_STABLE_REREQUESTING_2)
            {
                arp_table[i].state = ETHARP_STATE_STABLE;  /* 重新确认完成 */
            }
            else if (arp_table[i].state == ETHARP_STATE_PENDING)
            {
                /* 还没等到应答，再广播一次 ARP 请求 */
                etharp_request(arp_table[i].netif, &arp_table[i].ipaddr);
            }
        }
    }
}
```

这就是 ARP 表"自动打扫卫生"的机制：稳定表项 300 秒不刷新就清理，挂起的表项每 1 秒重发一次请求、撑到 5 秒还没应答就放弃。所以你会发现：长时间不通信后再 ping，会重新看到 ARP 请求——缓存过期了。

## 4. ARP 报文结构：28 字节的"寻人启事"

ARP 报文 28 字节，前面还要套一层 14 字节的以太网首部（第 8.2 节 (PDF p.219)），完整布局如下：

```c
 6字节       6字节       2字节   2字节  2字节  1字节 1字节  2字节   6字节    4字节   6字节    4字节
+----------+----------+-------+------+------+-----+-----+-------+--------+-------+--------+-------+
| 以太网目的 | 以太网源  | 帧类型 |硬件类|协议类|硬件 |协议 | 操作码 | 发送方  | 发送方 | 接收方  | 接收方 |
| MAC      | MAC      |0x0806| 型    | 型   |长度 |长度 |1请求  | MAC    | IP    | MAC    | IP    |
|          |          |       | 1    |0x0800| 6   | 4   |2应答  |        |       |        |       |
+----------+----------+-------+------+------+-----+-----+-------+--------+-------+--------+-------+
|←——————— 以太网首部（14 字节）————————→|←—————————— ARP 报文（28 字节）——————————→|
```

各字段（对照 Wireshark 就能找到）：

| 字段 | 取值 | 含义 |
|------|------|------|
| 硬件类型 hwtype | 1 | 链路层类型：1 = 以太网 MAC |
| 协议类型 proto | 0x0800 | 要解析的协议地址类型：0x0800 = IP |
| 硬件地址长度 hwlen | 6 | MAC 地址长度 |
| 协议地址长度 protolen | 4 | IP 地址长度 |
| 操作码 opcode | 1 / 2 | 1 = ARP 请求，2 = ARP 应答 |
| 发送方 MAC + IP | — | 提问人（应答时就是回答人） |
| 接收方 MAC + IP | — | 请求时接收方 MAC 全 0；应答时填目标 MAC |

留出"长度"字段是为了让 ARP 能用在任何网络（不只是以太网+IP）。lwIP 对应的结构体（`etharp.h`，(PDF p.219~220)）：

```c
struct etharp_hdr {              /* ARP 报文（28 字节，紧凑打包） */
    u16_t hwtype;                /* 硬件类型：1 = 以太网 */
    u16_t proto;                 /* 协议类型：0x0800 = IP */
    u8_t  hwlen;                 /* 硬件地址长度：6 */
    u8_t  protolen;              /* 协议地址长度：4 */
    u16_t opcode;                /* 操作码：1 请求 / 2 应答 */
    struct eth_addr shwaddr;     /* 发送方 MAC（6 字节） */
    struct ip4_addr2 sipaddr;    /* 发送方 IP（4 字节） */
    struct eth_addr dhwaddr;     /* 目标 MAC（6 字节） */
    struct ip4_addr2 dipaddr;    /* 目标 IP（4 字节） */
};

enum etharp_opcode {
    ARP_REQUEST = 1,             /* 请求包 */
    ARP_REPLY   = 2              /* 应答包 */
};
```

## 5. 源码走读：请求怎么发、应答怎么收

### 5.1 发送 ARP 请求：etharp_raw

构建 ARP 请求/应答包的核心函数是 `etharp_raw`（(PDF p.221~222)），逻辑很直白：申请 pbuf → 填 ARP 字段 → 交给 ethernet_output 加以太网首部发出去：

```c
static err_t
etharp_raw(struct netif *netif, const struct eth_addr *ethsrc_addr,
           const struct eth_addr *ethdst_addr,
           const struct eth_addr *hwsrc_addr, const ip4_addr_t *ipsrc_addr,
           const struct eth_addr *hwdst_addr, const ip4_addr_t *ipdst_addr,
           const u16_t opcode)
{
    struct pbuf *p;
    struct etharp_hdr *hdr;
    /* 申请 pbuf，预留以太网首部空间，装一个 ARP 报文 */
    p = pbuf_alloc(PBUF_LINK, SIZEOF_ETHARP_HDR, PBUF_RAM);
    if (p == NULL) {
        return ERR_MEM;
    }
    /* 把 payload 强转成 ARP 报文首部，开始填字段 */
    hdr = (struct etharp_hdr *)p->payload;
    hdr->opcode  = lwip_htons(opcode);        /* 1 请求 / 2 应答 */
    SMEMCPY(&hdr->shwaddr, hwsrc_addr, ETH_HWADDR_LEN);   /* 发送方 MAC */
    SMEMCPY(&hdr->dhwaddr, hwdst_addr, ETH_HWADDR_LEN);   /* 目标 MAC */
    hdr->hwtype  = PP_HTONS(HWTYPE_ETHERNET); /* 硬件类型 = 1 */
    hdr->proto   = PP_HTONS(ETHTYPE_IP);      /* 协议类型 = 0x0800 */
    hdr->hwlen   = ETH_HWADDR_LEN;            /* = 6 */
    hdr->protolen = sizeof(ip4_addr_t);       /* = 4 */
    /* 加以太网首部并发送（请求走广播地址，应答走单播地址） */
    ethernet_output(netif, p, ethsrc_addr, ethdst_addr, ETHTYPE_ARP);
    pbuf_free(p);
    return ERR_OK;
}
```

两个关键常量：`ethbroadcast = {0xff,0xff,...}`（广播）、`ethzero = {0,0,...}`（全 0）。请求包怎么拼的？

```c
/* 发送要求 ipaddr 的 ARP 请求：源=本机 MAC/IP，目标MAC=全0，帧发广播 */
err_t
etharp_request(struct netif *netif, const ip4_addr_t *ipaddr)
{
    return etharp_request_dst(netif, ipaddr, &ethbroadcast);
}
/* etharp_request_dst 内部调用 etharp_raw：
   ethsrc = 本机MAC,  hwsrc = 本机MAC,  ipsrc = 本机IP,
   hwdst = ethzero（全0）,  ipdst = 目标IP,  opcode = ARP_REQUEST */
```

### 5.2 发送 IP 包前的"地址体检"：etharp_output

还记得第 5 课说 `netif->output = etharp_output` 吗？IP 层发出的每个包都要经过它。它的逻辑就是第 2 节那四步的代码化：

```c
etharp_output(netif, p, ipaddr)   /* 准备把 IP 包发给 ipaddr */
   │  ① 查 ARP 缓存表：有 ipaddr 的 STABLE 表项吗？
   │  ② 有 → 填好以太网目的 MAC，直接 netif->linkoutput 发出去
   │  ③ 没有 → 创建/找到 PENDING 表项，把 pbuf 挂到表项的 q 上
   │           etharp_query() → etharp_request() 广播 ARP 请求
   │           收到应答后（etharp_input 里）把挂起的包补发出去
   ▼
   完成
```

这就是"数据包挂起"机制：**包先排队，解析完 MAC 再放行**。教材图 8.1.1.2 里 PENDING 表项挂着 pbuf 指的就是这个（(PDF p.217)）。

### 5.3 接收：ethernet_input 按帧类型分发

网卡收到的帧先统一进 `ethernet_input`（(PDF p.224~226)），它看以太网首部的帧类型字段分流：

```c
err_t
ethernet_input(struct pbuf *p, struct netif *netif)
{
    struct eth_hdr *ethhdr;
    /* 长度校验：小于等于以太网首部就丢弃 */
    if (p->len <= SIZEOF_ETH_HDR) {
        pbuf_free(p);
        return ERR_OK;
    }
    ethhdr = (struct eth_hdr *)p->payload;      /* 指向以太网首部 */
    /* 判断广播/多播并打标记（略） */
    switch (ethhdr->type)                       /* 看帧类型字段 */
    {
        case PP_HTONS(ETHTYPE_IP):              /* 0x0800：IP 数据包 */
            /* 去掉以太网首部（pbuf_header 向后挪指针） */
            pbuf_header(p, (s16_t)-SIZEOF_ETH_HDR);
            ip4_input(p, netif);                /* 交给 IP 层 */
            break;
        case PP_HTONS(ETHTYPE_ARP):             /* 0x0806：ARP 报文 */
            pbuf_header(p, (s16_t)-SIZEOF_ETH_HDR);
            etharp_input(p, netif);             /* 交给 ARP 处理 */
            break;
        default:                                /* 未知类型 */
            pbuf_free(p);
            break;
    }
    return ERR_OK;
}
```

### 5.4 收应答/收请求：etharp_input

`etharp_input` 处理两类情况（教材图 8.3.1 的流程总结，(PDF p.226~227)）：

- **收到 ARP 应答**：先校验硬件类型/协议类型；然后把"发送方 IP→MAC"更新进缓存表（`etharp_update_arp_entry`）；若该表项之前挂着数据包，把它们取出来通过 ethernet_output 发出去（**挂起的包终于放行**）
- **收到 ARP 请求**：同样先把发送方信息更新进缓存表（双向学习！）；再判断"目标 IP 是不是我自己"——是的话调用 `etharp_raw` 构造应答包（opcode = ARP_REPLY，单播发给请求方）

注意"双向学习"这个细节：**不管是请求还是应答，只要收到 ARP 报文，就把发送方 IP→MAC 记进缓存**。这就是为什么你 ping 板子一次，板子和电脑都记住了对方。

> ⚠️ ARP 是建立在"局域网互相信任"基础上的——应答不验证真伪，收到就记缓存。所以才有 ARP 欺骗这种安全漏洞（冒充网关广播应答）。直连实验环境没这风险，但做产品时要留个心眼。

## 动手练习

### 练习 7.1：清缓存后 ping，抓完整的"请求-应答"两包

- 1️⃣ 电脑上先清掉板子的 ARP 缓存记录：管理员 CMD 执行 `arp -d 192.168.1.10`（顺便 `arp -a` 确认记录已消失）。
- 2️⃣ Wireshark 开抓（过滤条件填 `arp`），然后 `ping 192.168.1.10`。
- 3️⃣ 应该抓到两个 ARP 包，逐字段对照第 4 节的 ASCII 布局：
- 　• 请求包：以太网目的 MAC = ff:ff:ff:ff:ff:ff（广播），OP = 1，接收方 MAC = 00:00:00:00:00:00
- 　• 应答包：以太网目的 MAC = 你的电脑网卡 MAC（单播），OP = 2，接收方 MAC 已填好
- 4️⃣ 再 ping 一次（别清缓存）：应该**没有新的 ARP 包**了——缓存命中，直接发包。用 `arp -a` 能看到 192.168.1.10 的 MAC 已记录，类型为"动态"。

### 练习 7.2：观察缓存老化与"重新解析"

- 1️⃣ 连续 ping 板子 10 秒，Wireshark 过滤 `arp || icmp`，观察时间线：开头 1 个 ARP 请求 + 1 个应答，随后全是 ICMP。
- 2️⃣ 停止 ping，静置几分钟（电脑 ARP 缓存条目会过期，Windows 一般几十秒到几分钟不等），期间用 `arp -a` 隔一会儿看一眼，记录表项消失的时间。
- 3️⃣ 表项消失后重新 ping：Wireshark 里又出现一对 ARP 请求/应答——这就是"缓存过期 → 重新解析"。
- 4️⃣ 进阶：把板子复位再 ping，同样会重新 ARP（板子侧缓存清空了）。对比教材里 PENDING 状态 5 秒超时、STABLE 状态 300 秒老化的机制，说说电脑侧的行为和 lwIP 有什么异同。

## 自测

### 随堂小测 1

**Q1. ARP 请求帧的以太网目的 MAC 地址是？**

- 目标主机的真实 MAC 地址
- 广播地址 ff:ff:ff:ff:ff:ff
- 全 0 地址 00:00:00:00:00:00
- 网关路由器的 MAC 地址

<details>
<summary>查看答案</summary>

B。请求以广播方式发送，同网段所有主机都能收到；只有目标 IP 匹配的主机应答（PDF p.215）。

</details>

**Q2. ARP 报文 OP 字段取值为 1 和 2 时分别表示？**

- 1 表示请求，2 表示应答
- 1 表示应答，2 表示请求
- 1 表示广播，2 表示单播
- 1 表示 IPv4，2 表示 IPv6

<details>
<summary>查看答案</summary>

A。opcode：ARP_REQUEST = 1，ARP_REPLY = 2（PDF p.219）。

</details>

**Q3. ARP 缓存表项处于 PENDING 状态表示什么？**

- 已经解析到对方的 MAC 地址
- 已发请求等待应答，还没有 MAC 地址
- 表项空闲，可以被新映射占用
- 表项已过期，等待被删除

<details>
<summary>查看答案</summary>

B。PENDING = 只记了 IP 没记 MAC，数据包挂起，5 秒（ARP_MAXPENDING）内收不到应答就删除（PDF p.216）。

</details>

**Q4. lwIP 中 ARP 缓存表的老化由哪个函数周期驱动？**

- tcp_tmr 函数
- dns_tmr 函数
- etharp_tmr 函数
- dhcp_fine_tmr 函数

<details>
<summary>查看答案</summary>

C。etharp_tmr 每 1 秒（ARP_TMR_INTERVAL）遍历缓存表，ctime 加 1，超龄表项删除，PENDING 期间重发请求（PDF p.217~218）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 8 章（(PDF p.215~227)）——本课全部依据
- 🌐 [RFC 826：Ethernet Address Resolution Protocol](https://datatracker.ietf.org/doc/html/rfc826)——ARP 协议原始规范，报文格式的权威定义
- 🌐 [Wireshark 官方 ARP 解析说明](https://wiki.wireshark.org/AddressResolutionProtocol)——每个字段在 Wireshark 里的显示方式

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 8 课——IP 与 ICMP 协议：20 字节 IP 首部逐字段解剖、数据报怎么分片怎么重装，以及"ping 通"背后的 ICMP 回显机制。

| [← 上一课](/my-blog/posts/lwip/0006-kernel-internals/) | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0008-ip-and-icmp/) |