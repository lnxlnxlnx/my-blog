---
title: IP 与 ICMP 协议
published: 2026-08-21
description: lwIP 系列课程第 8 课：IP 数据报结构、分片与重装算例、ip4_frag / ip4_output_if_src / ip4_input 源码流程，ICMP 差错报文与回显（ping）原理，最后用 Wireshark 亲手拆开 IP 头和 ICMP 包。
tags: [lwIP, 嵌入式, 网络, IP, ICMP, 分片, ping]
category: lwIP
draft: false
prevTitle: RAW API · UDP
prevSlug: "lwip/0009-raw-udp"
nextTitle: ARP 协议
nextSlug: "lwip/0007-arp-protocol"
---

# IP 与 ICMP 协议

IP 数据报结构与分片重装、IP 收发源码、ICMP 差错与回显（ping 的原理）（预计 70~90 分钟）

**本课目标：**🎯 前面把"路"修好了（netif/pbuf/内核/ARP），这节课讲"车"和"交警"：IP 是路上跑的车（网络层数据报），ICMP 是车的"故障灯"（差错报告 + ping 的回显机制）。学完你能说清：20 字节 IP 首部每个字段的含义、大数据报怎么分片（含 4000 字节拆三片的算例）、lwIP 的 `ip4_frag` / `ip4_output_if_src` / `ip4_input` 主要流程、ICMP 报文两大类与报文结构、以及 ping 请求应答在 `icmp_input` 里是怎么实现的。最后用 Wireshark 亲手拆开一个 IP 头和一个 ICMP 包。

## 1. IP 协议：网络层的"快递单"

IP（Internet Protocol，网际互连协议）是 TCP/IP 体系中的网络层协议（第 9.1 节 (PDF p.228)）。它的定位按教材原话就是：**无连接、不可靠、尽力而为**的数据报传输服务——只管把包从源地址送到目的地址，不保证顺序、不保证不丢。可靠性交给上层（TCP）去补。对下它把包塞进以太网帧，对上它向 TCP/UDP/ICMP 提供服务（靠首部里的"协议"字段区分）。

这一章的核心其实是**分片与重组**——因为 IP 包理论上最大 65535 字节，而以太网帧只能装 1500（MTU），"大包拆小包、到了再拼回"就是 IP 层最见功夫的活儿。

## 2. IP 数据报结构：20 字节的固定首部

IP 数据报 = IP 首部（固定 20 字节，可加选项到 60）+ 数据区（第 9.2 节 (PDF p.228)）。首部布局（RFC 791 的经典画法）：

```c
  0        4       8           16     19                31
  +--------+-------+-----------+-------+-----------------+
  | 版本号 |首部长度| 服务类型   |        总长度（16位）     |
  | (4位)  | (4位)  | (8位)     |                         |
  +--------+-------+-----------+------------------------+
  |          标识（16位）        | 标志(3位)|  片偏移（13位） |
  +-----------------------------+---------+--------------+
  |  生存时间TTL（8位）| 协议(8位)|      首部校验和（16位）    |
  +-------------------+----------+------------------------+
  |                      源IP地址（32位）                  |
  +------------------------------------------------------+
  |                      目的IP地址（32位）                |
  +------------------------------------------------------+
  |                    选项字段（如果存在）                 |
  +------------------------------------------------------+
  |                        数据区                          |
  +------------------------------------------------------+
```

字段速查表：

| 字段 | 长度 | 要点 |
|------|------|------|
| 版本 | 4 位 | IPv4 时为 4，收发双方必须一致 |
| 首部长度 | 4 位 | 单位是 4 字节（32 位字长），最小 5 → 20 字节；选项最多把首部撑到 60 字节 |
| 服务类型 TOS | 8 位 | 区分服务，实际基本没被用过 |
| 总长度 | 16 位 | 首部 + 数据的总字节数，最大 65535 |
| 标识 Identification | 16 位 | 每发一个数据报计数器加 1；分片时所有片共用同一标识，接收方靠它"认亲"重装 |
| 标志 Flags | 3 位 | DF=1 禁止分片；MF=1 表示"后面还有分片"，MF=0 是本组最后一片 |
| 片偏移 | 13 位 | 本片在原数据报中的位置，**以 8 字节为单位**，所以除最后一片外每片长度都是 8 的倍数 |
| TTL | 8 位 | 跳数上限，每过一个路由器减 1，减到 0 丢弃——防止数据报在网络里无限转圈 |
| 协议 | 8 位 | 上层协议：1=ICMP、6=TCP、17=UDP |
| 首部校验和 | 16 位 | 只校验首部不校验数据（每过一个路由器 TTL 变，校验和要重算） |
| 源/目的 IP | 各 32 位 | 不用多解释 |

lwIP 里对应的结构体 `ip_hdr`（`ip4.h`，(PDF p.229)）：

```c
struct ip_hdr {
    u8_t  _v_hl;        /* 高4位版本号 + 低4位首部长度 */
    u8_t  _tos;         /* 服务类型 */
    u16_t _len;         /* 总长度（IP 首部 + 数据区） */
    u16_t _id;          /* 数据包标识（编号） */
    u16_t _offset;      /* 标志 + 片偏移 */
#define IP_RF 0x8000U    /* 保留位 */
#define IP_DF 0x4000U    /* 禁止分片 */
#define IP_MF 0x2000U    /* 还有更多分片 */
#define IP_OFFMASK 0x1fffU /* 片偏移域掩码 */
    u8_t  _ttl;         /* 生存时间（最大转发次数） */
    u8_t  _proto;       /* 协议类型：1=ICMP、6=TCP、17=UDP */
    u16_t _chksum;      /* 首部校验和 */
    ip4_addr_p_t src;   /* 源 IP 地址 */
    ip4_addr_p_t dest;  /* 目的 IP 地址 */
};
```

## 3. IP 分片与重装：大件货物拆箱发货

### 3.1 分片原理：4000 字节拆三片

教材的经典算例（第 9.2.2 节 (PDF p.230~231)）：一个 4000 字节的 IP 数据报（20 字节首部 + 3980 字节数据），要穿过 MTU=1500 的以太网，拆成 3 片：

```c
原数据报：4000 字节 = IP首部(20) + 数据(3980)，标识 = 888

分片1：IP首部(20) + 数据(1480)   标识=888   MF=1   片偏移=0    （1480 < 1500 ✓）
分片2：IP首部(20) + 数据(1480)   标识=888   MF=1   片偏移=185  （1480/8=185，即偏移 1480 字节处）
分片3：IP首部(20) + 数据(1020)   标识=888   MF=0   片偏移=370  （185+185，即偏移 2960 字节处）
```

三个要点：**① 标识相同**（888），接收方靠它把三片归为一组；**② MF 只有最后一片是 0**；**③ 片偏移的单位是 8 字节**，所以偏移 185 = 数据起始位置在 1480 字节处。每片大小 = 1480 数据 + 20 首部 = 1500，正好卡着 MTU。

### 3.2 lwIP 的分片实现：ip4_frag

`ip4_frag`（(PDF p.232~234)）的核心思路是**零拷贝切分**——新片的首部复制一份，数据区用 PBUF_REF 引用原 pbuf 的对应段，不搬数据：

```c
err_t
ip4_frag(struct pbuf *p, struct netif *netif, const ip4_addr_t *dest)
{
    const u16_t nfb = (u16_t)((netif->mtu - IP_HLEN) / 8);  /* 每片数据区块数：(1500-20)/8 = 185 */
    u16_t left = (u16_t)(p->tot_len - IP_HLEN);             /* 待切的数据量：3980 */
    u16_t ofo = 0;                                          /* 片偏移（单位8字节） */
    while (left) {                                          /* 还有数据没切完 */
        /* 本片数据长度：不足 1480 就取剩余量 */
        fragsize = LWIP_MIN(left, (u16_t)(nfb * 8));        /* = 1480 */
        /* 申请一块只装 20 字节 IP 首部的 pbuf，拷贝原始首部 */
        rambuf = pbuf_alloc(PBUF_LINK, IP_HLEN, PBUF_RAM);
        SMEMCPY(rambuf->payload, original_iphdr, IP_HLEN);
        /* 数据区：用 PBUF_REF 引用原 pbuf 的对应段（零拷贝！） */
        newpbuf = pbuf_alloced_custom(PBUF_RAW, newpbuflen,
                                      PBUF_REF, &pcr->pc,
                                      (u8_t *)p->payload + poff, newpbuflen);
        pbuf_cat(rambuf, newpbuf);                          /* 首部 + 数据 串成链 */
        /* 改本片首部：总长度、片偏移、MF 标志、校验和清零 */
        IPH_OFFSET_SET(iphdr, lwip_htons(tmp | IP_MF));     /* 非末片置 MF */
        IPH_LEN_SET(iphdr, lwip_htons(fragsize + IP_HLEN)); /* 1500 */
        IPH_CHKSUM_SET(iphdr, 0);                           /* 让底层重算 */
        /* 发出去 */
        netif->output(netif, rambuf, dest);                 /* 经 ARP 层走 linkoutput */
        pbuf_free(rambuf);
        left = (u16_t)(left - fragsize);                    /* 剩余量递减 */
        ofo = (u16_t)(ofo + nfb);                           /* 片偏移递增 185 */
    }
    return ERR_OK;
}
```

流程一句话：**循环"拷贝首部 + 引用数据段 → 改偏移/长度/MF → 发一片"**，直到切完。数据区全程没搬动过，只是换了不同的"视角"。

### 3.3 重装：ip_reassdata 链表

分片到达目的地时间不定（可能后发先至），接收方要暂存等待（第 9.2.3 节 (PDF p.235)）。lwIP 用 `ip_reassdata` 结构体管理一组分片：

```c
struct ip_reassdata {
    struct ip_reassdata *next;   /* 下一个重装节点 */
    struct pbuf *p;              /* 指向分片的 pbuf */
    struct ip_hdr iphdr;         /* 本组数据报的首部（含标识） */
    u16_t datagram_len;          /* 已收到的数据长度 */
    u8_t flags;                  /* 是否收到最后一个分片 */
    u8_t timer;                  /* 超时间隔（超时丢弃，防止占着内存不放） */
};
```

实现细节（教材提到但没深讲）：分片到达后，把 **IP 首部前 8 字节强转成 next_pbuf / start / end 三个字段**——next_pbuf 用来把同一组的分片串成链表，start/end 记录分片的数据范围，便于按偏移排序。全部到齐后重组成完整数据报递给上层；超时未齐（由第 6 课的 `ip_reass_tmr` 周期检查）就整体丢弃。注意：重装功能要开 `LWIP_IPV4_REASSEMBLY` 宏才生效。

## 4. IP 的输出与输入

### 4.1 输出：ip4_output_if_src

TCP/UDP 段最终统一走 `ip4_output_if_src`（第 9.3 节 (PDF p.236~238)），它的流程：

1. `pbuf_header(p, IP_HLEN)` 往前腾出 20 字节放 IP 首部（pbuf 的零拷贝老手艺）
2. 填首部：TTL、协议、目的 IP、版本(4)+首部长度(5)、TOS、总长度、标志/片偏移清零、标识 = `ip_id`（全局计数器，发一个 +1）
3. 源 IP：没指定就用路由选中的网卡 IP
4. 判 MTU：`p->tot_len > netif->mtu` 就调 `ip4_frag` 分片发送；否则直接 `netif->output(netif, p, dest)`（= etharp_output，第 7 课）

```c
/* 关键尾段：MTU 检查 + 交给 ARP 层 */
if (netif->mtu && (p->tot_len > netif->mtu)) {
    return ip4_frag(p, netif, dest);       /* 超 MTU：分片发送 */
}
return netif->output(netif, p, dest);      /* 正常：交给 ARP 解析 MAC 后发送 */
```

### 4.2 输入：ip4_input 的"十步安检"

收到 IP 包后走 `ip4_input`（第 9.4 节 (PDF p.239~246)），教材把流程总结为十步，全是"验明正身"：

1. 版本号必须是 4，不是就丢
2. 首部长度/总长度合法性检查（超过 pbuf 长度就丢）
3. 校验首部校验和，错就丢
4. 匹配接口：目的 IP 是不是本机的（单播地址比对、广播判定、多播处理）
5. 源 IP 不能是广播/多播地址
6. 没找到匹配网卡 → 非本机包：开了 IP_FORWARD 就转发，否则丢弃
7. 看标志+片偏移：是分片（MF=1 或偏移≠0）就进 `ip4_reass` 重装，没拼齐先返回
8. 首部长度超过 20 字节（带选项）→ 本配置下丢弃
9. 先喂给 RAW 接口（`raw_input`），没人接才继续
10. 按协议字段分发：UDP → `udp_input`，TCP → `tcp_input`，其他丢弃（ICMP 在这里也是经协议号分给 `icmp_input`）

```c
/* 十步的最后一步：去 IP 首部，按协议分发 */
pbuf_header(p, -(s16_t)iphdr_hlen);     /* 剥掉 IP 首部 */
switch (IPH_PROTO(iphdr))
{
    case IP_PROTO_UDP:
        udp_input(p, inp);              /* 交给 UDP 层 */
        break;
    case IP_PROTO_TCP:
        tcp_input(p, inp);              /* 交给 TCP 层 */
        break;
    default:
        pbuf_free(p);                   /* 未知协议，丢弃 */
        break;
}
```

> 💡 记忆锚点：IP 输入是"体检十连"（版本→长度→校验→归属→来源→接口→分片→选项→RAW→分发），IP 输出是"打包四步"（腾位→填单→查 MTU→交 ARP）。源码再长，抓住骨架就不迷路。

## 5. ICMP：IP 的"质检员与客服"

IP 太"佛系"：包丢了、TTL 超了、目的不可达，它自己闷声不响。于是有了 ICMP（Internet Control Message Protocol，互联网控制报文协议）——专门用来传递网络本身的状态消息（第 10.1 节 (PDF p.247)）。它解决 IP 的两大缺陷：**① 没有差错报告机制 ② 没有主机管理与查询机制**。

ICMP 报文分两大类：

| 类别 | 典型类型 | 用途 |
|------|---------|------|
| 差错报告报文 | 3 目的不可达、4 源站抑制、5 重定向、11 超时、12 参数错误 | 路由器/主机把"为什么没送到"告诉源主机 |
| 查询报文 | 8/0 回显请求/应答（ping！）、13/14 时间戳、17/18 掩码 | 主机之间互相"问话"，成对出现 |

> ⚠️ 教材明确提示：**lwIP 只实现了差错报文的类型 3（目的不可达）和 11（超时），查询报文只处理回显请求（ping）**——其余一律丢弃（(PDF p.247)）。

报文结构（第 10.1.2 节 (PDF p.248~250)）：前 4 字节通用（类型 + 代码 + 校验和），后 4 字节随类型而变。

```c
ICMP 通用首部（8 字节起）
+--------+--------+----------------+
| 类型    | 代码    |    校验和      |
| (8位)  | (8位)   |   (16位)       |
+--------+--------+----------------+
| 剩余 4 字节：随类型变化            |
|   · 回显报文：标识符(16位)+序号(16位) |
|   · 差错报文：未使用(32位)          |
+----------------------------------+
| 数据区（可变）                     |
|   · 回显报文：发送方自选数据，应答原样返回 |
|   · 差错报文：引起差错的 IP 首部 +    |
|      原数据报数据区前 8 字节（含端口号）|
+----------------------------------+
```

回显报文：类型 8 = 请求（Echo request），类型 0 = 应答（Echo reply），代码恒为 0，标识符 + 序号用来匹配"哪个请求对应哪个应答"（Wireshark 里 ICMP 的 id/seq 字段）。差错报文的数据区为什么要带"原 IP 首部 + 前 8 字节"？因为前 8 字节恰好覆盖传输层的源/目的端口号——源主机据此知道是哪个应用程序的哪个包出了问题（(PDF p.249)）。

## 6. ICMP 源码：差错与回显

### 6.1 数据结构

```c
struct icmp_echo_hdr {          /* ICMP 首部（icmp.h） */
    u8_t  type;                 /* 类型：8 回显请求 / 0 回显应答 */
    u8_t  code;                 /* 代码：回显恒为 0 */
    u16_t chksum;               /* 校验和（含数据区） */
    u16_t id;                   /* 标识符 */
    u16_t seqno;                /* 序号 */
};

#define ICMP_ER    0    /* 回送应答 */
#define ICMP_DUR   3    /* 目标不可达 */
#define ICMP_SQ    4    /* 源站抑制 */
#define ICMP_RD    5    /* 重定向 */
#define ICMP_ECHO  8    /* 回送请求 */
#define ICMP_TE   11    /* 超时 */
#define ICMP_PP   12    /* 参数问题 */
/* 还有时间戳(13/14)、信息请求(15/16)、地址掩码(17/18)等 */
```

### 6.2 发送差错报文：icmp_send_response

`icmp_dest_unreach()` 和 `icmp_time_exceeded()` 只是定好类型和代码，实际干活的是 `icmp_send_response`（(PDF p.252~254)）：

```c
static void
icmp_send_response(struct pbuf *p, u8_t type, u8_t code)
{
    struct pbuf *q;
    struct ip_hdr *iphdr;
    struct icmp_echo_hdr *icmphdr;
    ip4_addr_t iphdr_src;
    /* 申请：ICMP 首部 + 原 IP 首部 + 原数据前 8 字节 */
    q = pbuf_alloc(PBUF_IP, sizeof(struct icmp_echo_hdr) + IP_HLEN + 8, PBUF_RAM);
    if (q == NULL) {
        return;
    }
    icmphdr = (struct icmp_echo_hdr *)q->payload;
    icmphdr->type = type;                   /* 3 或 11 */
    icmphdr->code = code;                   /* 具体原因 */
    icmphdr->id = 0;
    icmphdr->seqno = 0;
    /* 把"引起差错的 IP 首部 + 前 8 字节数据"拷进数据区 */
    SMEMCPY((u8_t *)q->payload + sizeof(struct icmp_echo_hdr),
            (u8_t *)p->payload, IP_HLEN + 8);
    /* 发给原数据报的源主机 */
    ip4_addr_copy(iphdr_src, iphdr->src);
    netif = ip4_route(&iphdr_src);
    if (netif != NULL) {
        ip4_output_if(q, NULL, &iphdr_src, ICMP_TTL, 0, IP_PROTO_ICMP, netif);
    }
    pbuf_free(q);
}
```

### 6.3 接收与回显应答：icmp_input

IP 层按协议号把 ICMP 包交给 `icmp_input`（(PDF p.254~258)）。它先做长度检查、取出类型字段，然后一个大 switch：

```c
switch (type)
{
    case ICMP_ER:                    /* 回显应答：只统计，不处理 */
        MIB2_STATS_INC(mib2.icmpinechoreps);
        break;
    case ICMP_ECHO:                  /* 回显请求：ping！要回包 */
        /* 多播/广播目的地址不回（避免风暴） */
        if (ip4_addr_ismulticast(ip4_current_dest_addr())) goto icmperr;
        if (ip4_addr_isbroadcast(ip4_current_dest_addr(), ip_current_netif())) goto icmperr;
        ...
        /* 交换源/目的 IP，类型改成应答，重算校验和，原样发回 */
        ip4_addr_copy(iphdr->src, *src);                    /* 源 = 原目的 */
        ip4_addr_copy(iphdr->dest, *ip4_current_src_addr()); /* 目的 = 原源 */
        ICMPH_TYPE_SET(iecho, ICMP_ER);                     /* 类型 8 → 0 */
        iecho->chksum = 0;                                  /* 校验和重算 */
        IPH_TTL_SET(iphdr, ICMP_TTL);
        IPH_CHKSUM_SET(iphdr, 0);
        ret = ip4_output_if(p, src, LWIP_IP_HDRINCL, ICMP_TTL, 0, IP_PROTO_ICMP, inp);
        break;
    default:                         /* 其他类型：统计后丢弃 */
        ICMP_STATS_INC(icmp.drop);
        break;
}
```

ping 的魔法就在这：**收到回显请求 → 把"请求"改写成"应答"（交换 IP、类型 8 改 0）→ 原路发回**。数据区原封不动，所以发送方可以比对内容确认没损坏。整个过程不经过传输层——这就是教材说的"ping 不用经过传输层"。

> ⚠️ 关于分片重装：正点原子例程默认可能没开 `LWIP_IPV4_REASSEMBLY`，所以电脑 ping 板子时别用太大包（超过 1472 字节数据会触发分片）。练习里我们会故意试一次——如果板子 ping 不通大包，先别慌，检查这个宏，这本身就是一次很好的观察实验。

## 动手练习（约 30 分钟）

### 练习 8.1：ping 抓包，解剖 IP 首部与 ICMP 报文

- 1️⃣ Wireshark 过滤 `icmp`，电脑 `ping 192.168.1.10` 抓 4 个包（2 请求 2 应答）。
- 2️⃣ 展开请求包的 `Internet Protocol Version 4` 层，逐字段对照第 2 节布局：Version=4、Header Length=20（IHL=5）、Total Length=60、Identification 每次 +1、TTL=128（Windows 默认）、Protocol=1（ICMP）、Header Checksum。
- 3️⃣ 再展开 `Internet Control Message Protocol` 层：Type=8（请求）/Code=0/Checksum/Identifier/Sequence Number。对比应答包：Type=0，Identifier 与 Sequence 与请求相同（它们配对）。
- 4️⃣ 观察板子回的应答包 TTL：lwIP 默认 ICMP_TTL=255，直连没有路由器衰减，所以是 255——对比电脑发出的 128，这就是"不同系统 TTL 初始值不同"的实证。

### 练习 8.2：制造分片，观察 IP 分片与重装

- 1️⃣ 先测基线：电脑 `ping 192.168.1.10 -l 1472 -f`（1472 数据 + 28 首部 = 正好 1500，-f 禁止分片），应该能通——这是 MTU 边界。
- 2️⃣ 再试 `ping 192.168.1.10 -l 1473 -f`：1473+28=1501 超 MTU 且禁止分片 → 应该失败，同时 Wireshark 里能看到一个 ICMP 差错报文（目的不可达）。这正好验证第 5 节"差错报文"的存在。
- 3️⃣ 关掉 -f：`ping 192.168.1.10 -l 3000`，Wireshark 过滤 `ip.addr == 192.168.1.10`，在 Edit→Preferences→Protocols→IPv4 里取消勾选 "Reassemble fragmented IPv4 datagrams"，就能看到 3 个分片：**标识相同、片偏移 0/185/370、MF 1/1/0**，数据长度 1480/1480/40。
- 4️⃣ 如果板子没开 `LWIP_IPV4_REASSEMBLY`，3000 字节的 ping 会丢包或不通——去 lwipopts.h 打开这个宏再试，体会"重装"在协议栈里的意义。

## 自测（答完再点答案）

### 随堂小测 1

Q1. IPv4 固定首部的长度是？

- A. 20 字节
- B. 32 字节
- C. 60 字节
- D. 1500 字节

<details>
<summary>查看答案</summary>

A。固定 20 字节（首部长度字段=5，单位 4 字节）；带选项最长 60 字节（PDF p.228）。

</details>

### 随堂小测 2

Q2. IP 分片时各片的"标识 Identification"字段的作用是？

- A. 区分数据报的优先级
- B. 让接收方把同一数据报的分片归组重装
- C. 记录经过的路由器个数
- D. 表示数据报的总长度

<details>
<summary>查看答案</summary>

B。源主机每发一个数据报计数器加 1，分片时同组各片标识相同，接收方按标识归组重装（PDF p.229）。

</details>

### 随堂小测 3

Q3. 4000 字节数据报（含 20 字节 IP 首部）在 MTU=1500 的网络上分片，第三片的片偏移是？

- A. 0（单位 8 字节）
- B. 185（单位 8 字节）
- C. 370（单位 8 字节）
- D. 2960（单位 8 字节）

<details>
<summary>查看答案</summary>

C。数据 3980 拆成 1480+1480+1020，第三片从 2960 字节处开始，2960/8=370（PDF p.230~231）。

</details>

### 随堂小测 4

Q4. ping 使用的 ICMP 报文类型是？

- A. 差错报文类型 3（目的不可达）
- B. 回显请求（8）与回显应答（0）
- C. 差错报文类型 11（超时）
- D. 查询报文类型 13（时间戳）

<details>
<summary>查看答案</summary>

B。ping 用回显请求（8）+ 回显应答（0）测试主机可达性；lwIP 也只处理回显请求（PDF p.250/258）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 9 章（(PDF p.228~246)）——IP 协议与分片重装源码
- 📖 正点原子《lwIP 开发指南 V1.7》第 10 章（(PDF p.247~259)）——ICMP 报文与源码实现
- 🌐 [RFC 791：Internet Protocol](https://datatracker.ietf.org/doc/html/rfc791)——IPv4 数据报格式与分片规则的权威定义
- 🌐 [RFC 792：Internet Control Message Protocol](https://datatracker.ietf.org/doc/html/rfc792)——ICMP 报文格式与全部类型

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 9 课——RAW 编程接口：lwIP 最底层的编程方式，亲手用 UDP 写一个"裸奔"的收发程序，把这几课的结构体真正用起来。

| [← 上一课](/my-blog/posts/lwip/0007-arp-protocol/) | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0009-raw-udp/) |
