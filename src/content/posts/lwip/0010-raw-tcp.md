---
title: RAW API · TCP
published: 2026-08-23
description: lwIP 系列课程第 10 课：TCP 协议的三次握手与四次挥手、TCP 报文结构与 11 个状态机、tcp_pcb 关键字段、RAW TCP 编程接口全家桶，以及 TCP 客户端与服务器的最小完整代码。
tags: [lwIP, 嵌入式, 网络, RAW API, TCP, 三次握手, 状态机]
category: lwIP
draft: false
prevTitle: NETCONN 接口
prevSlug: "lwip/0011-netconn-api"
nextTitle: RAW API · UDP
nextSlug: "lwip/0009-raw-udp"
---

# RAW API · TCP

TCP 协议、三次握手与四次挥手、状态机、tcp_pcb 控制块、TCP 客户端与服务器实验

**本课目标：**UDP 是"发出去就完事"，TCP 是"说到做到、按序送达"。学完你能说清：三次握手/四次挥手每一步的状态变化、lwIP 的 TCP 状态机和 tcp_pcb 里滑动窗口怎么回事、以及用 RAW API 分别写一个 TCP 客户端（主动连）和一个 TCP 服务器（被动等）的最小完整代码。最终用网络调试助手 + Wireshark 亲眼验证握手与数据流。

## 1. TCP 协议：可靠字节流的"承诺"

TCP（Transmission Control Protocol）是**面向连接、可靠、基于字节流**的传输层协议（正点原子《lwIP 开发指南 V1.7》第 12.1.1 节 (PDF p.281)）。它给每个字节编号（序号），接收方按序号确认（ACK）；发送方在合理往返时延（RTT）内没收到 ACK 就认为丢包并重传。可靠性的三大支柱：**序号 + ACK + 重传**。

### 1.1 建立连接：三次握手（(PDF p.281)）

| 步骤 | 客户端 → 服务器 | 状态变化 |
|------|---------------|---------|
| 第 1 次 | SYN=1，seq=x（不携带数据，消耗一个序号） | CLOSED → SYN_SENT |
| 第 2 次 | 服务器回 SYN=1，ACK=1，seq=y，ack=x+1 | LISTEN → SYN_RCVD |
| 第 3 次 | 客户端回 ACK=1，seq=x+1，ack=y+1 | SYN_SENT → ESTABLISHED（服务器收后也 ESTABLISHED） |

### 1.2 终止连接：四次挥手（(PDF p.282)）

| 步骤 | 动作 | 状态变化 |
|------|------|---------|
| 第 1 次 | 客户端发 FIN=1，seq=u，停止发送数据 | ESTABLISHED → FIN_WAIT_1 |
| 第 2 次 | 服务器回 ACK，ack=u+1 | → CLOSE_WAIT；客户端 → FIN_WAIT_2 |
| 第 3 次 | 服务器发 FIN=1，ACK=1 | CLOSE_WAIT → LAST_ACK |
| 第 4 次 | 客户端回 ACK | 客户端 TIME_WAIT（2MSL 后 CLOSED），服务器直接 CLOSED |

> 💡 记忆锚点：**握手 3 条报文、挥手 4 条报文**——挥手多一条是因为连接是全双工的，每一方向都要"我说完 → 你确认"，两个方向独立进行。

## 2. TCP 报文结构（(PDF p.283)）

TCP 首部最小 20 字节，关键字段：

- **源/目的端口**（16 位 ×2）：标识两端应用进程
- **序号 seq**（32 位）：本报文段第一个数据字节的编号
- **确认号 ack**（32 位）：期望收到的下一个字节序号，仅 ACK=1 时有效
- **标志位**（6 位）：URG 紧急 / ACK 确认有效 / PSH 尽快上交应用 / RST 重建连接 / SYN 发起连接 / FIN 释放连接
- **窗口大小**（16 位）：接收方通告自己还能收多少字节，用于流量控制
- **校验和 / 紧急指针 / 选项**：校验覆盖整个报文段；选项含 MSS、时间戳、窗口扩大因子等

lwIP 用 `struct tcp_hdr` 描述（(PDF p.284)），字段与上图一一对应，其中 `_hdrlen_rsvd_flags` 一个 u16 打包了"首部长度 + 保留位 + 标志位"。

## 3. lwIP 的 TCP 状态机（(PDF p.285)）

lwIP 在 tcpbase.h 用枚举 `tcp_state` 定义全部 11 个状态：

```c
/* tcpbase.h 中的 TCP 状态枚举 */
enum tcp_state {
  CLOSED      = 0,   /* 关闭状态 */
  LISTEN      = 1,   /* 监听状态（服务器被动等连接） */
  SYN_SENT    = 2,   /* 已发送连接请求（客户端主动连接中） */
  SYN_RCVD    = 3,   /* 已接收连接请求（服务器收到 SYN） */
  ESTABLISHED = 4,   /* 连接已建立，可以收发数据 */
  FIN_WAIT_1  = 5,   /* 程序已关闭该连接（已发 FIN） */
  FIN_WAIT_2  = 6,   /* 另一端已关闭连接（已收 ACK） */
  CLOSE_WAIT  = 7,   /* 等待程序关闭连接（已收对方 FIN） */
  CLOSING     = 8,   /* 两端同时收到对方的关闭请求 */
  LAST_ACK    = 9,   /* 服务器等待对方确认关闭 */
  TIME_WAIT   = 10   /* 关闭成功，等 2MSL 后彻底释放 */
};
```

配合教材的 TCP 状态变迁图（(PDF p.286)）：客户端走 `CLOSED → SYN_SENT → ESTABLISHED → FIN_WAIT_1 → FIN_WAIT_2 → TIME_WAIT → CLOSED`；服务器走 `CLOSED → LISTEN → SYN_RCVD → ESTABLISHED → CLOSE_WAIT → LAST_ACK → CLOSED`。抓包时对照这个状态看，包和状态就"对上了号"。

## 4. TCP 控制块 tcp_pcb 的关键字段（(PDF p.287)）

tcp_pcb 是 TCP 的"灵魂"，成员很多（TCP 占了 lwIP 源码一半），抓住这几组即可：

- **接收窗口**：`rcv_nxt`（期望收到的下一个序号）、`rcv_wnd`（接收窗口大小）、`rcv_ann_wnd`（要通告给对方的窗口值，填进报文首部）、`rcv_ann_right_edge`（上次通告的窗口右边界）
- **发送窗口**：`lastack`（已被对方确认的最高序号）、`snd_nxt`（下一个要发的序号）、`snd_wnd`（发送窗口大小，通常=对方通告的接收窗口）、`snd_lbb`（下一个将被应用缓存的字节序号）
- **发送缓冲队列**：`unsent`（未发送的报文段）、`unacked`（已发未确认，超时重传用）——都由 `tcp_seg` 串成链表
- **回调函数指针**：`sent / recv / connected / poll / errf`——RAW API 的"接线端子"
- **监听专用**：`tcp_pcb_listen` 只记录本地端口和 accept 回调，省内存；来了 SYN 再分配完整控制块无缝切换

内核用四条链表管理控制块：`tcp_bound_pcbs`（已绑定未连接）、`tcp_listen_pcbs`（监听中）、`tcp_active_pcbs`（其他活跃状态）、`tcp_tw_pcbs`（TIME_WAIT）（(PDF p.291)）。

## 5. RAW TCP 编程接口（(PDF p.314)）

| 分组 | API 函数 | 功能 |
|------|---------|------|
| 连接建立 | `tcp_new()` | 创建 TCP 控制块 |
| | `tcp_bind(pcb, ip, port)` | 绑定本地 IP 和端口 |
| | `tcp_listen(pcb)` | 进入监听状态（返回 listen 控制块） |
| | `tcp_accept(pcb, fn)` | 注册 accept 回调（监听有连接时调用） |
| | `tcp_connect(pcb, ip, port, connected_fn)` | 主动连接远端，成功回调 connected |
| 发送数据 | `tcp_write(pcb, data, len, flags)` | 把数据放进发送缓冲队列（不立即发） |
| | `tcp_output(pcb)` | 把缓冲队列数据真正发出去 |
| | `tcp_sent(pcb, fn)` | 注册 sent 回调（对端 ACK 后调用） |
| 接收数据 | `tcp_recv(pcb, fn)` | 注册 recv 回调（新数据到达时调用） |
| | `tcp_recved(pcb, len)` | 告知内核已取走 len 字节，更新接收窗口（处理完数据必须调用） |
| 关闭/异常 | `tcp_close(pcb)` | 正常关闭连接（发送 FIN） |
| | `tcp_abort(pcb)` | 强制中止连接（发 RST） |
| | `tcp_err(pcb, fn)` / `tcp_poll(pcb, fn, interval)` | 注册错误回调 / 周期轮询回调 |

### 5.1 连接建立与关闭的原理要点（(PDF p.300)）

- **客户端**：`tcp_connect` 内部 `tcp_enqueue_flags(TCP_SYN)` 构建 SYN 段 → 状态置 `SYN_SENT` → `tcp_output` 发出（第一次握手）；收到 SYN+ACK 后在 `tcp_process` 的 SYN_SENT 分支校验标志位与确认号，置 `ESTABLISHED`（第二、三次握手）
- **服务器**：`tcp_listen` 把控制块置 `LISTEN`；收到 SYN 后 `tcp_listen_input` 分配新控制块、状态 `SYN_RCVD`、回 SYN+ACK；收到客户端 ACK 后 `tcp_process` 置 `ESTABLISHED`，并调用 listen 控制块的 accept 回调通知应用
- **关闭**：`tcp_close` → `tcp_close_shutdown_fin` 发送 FIN 并置 `FIN_WAIT_1`；对端回 ACK 进入 `FIN_WAIT_2`；收到对端 FIN 回 ACK 进入 `TIME_WAIT`，挂在 tcp_tw_pcbs 上等 2MSL 超时（教材实验里还提供了 `lwip_tcp_server_remove_timewait` 强制清理 TIME_WAIT 控制块，(PDF p.333)）

## 6. 最小可用代码：TCP 客户端

配置步骤（(PDF p.317)）：`tcp_new` → `tcp_connect` → 连接成功后注册 recv/sent/err/poll 回调 → 收发数据。

### 6.1 创建 + 主动连接

```c
/* TCP 客户端初始化：创建控制块并连接电脑 192.168.1.2:8080 */
static struct tcp_pcb *tcp_client_pcb;

void tcp_client_init(void)
{
    ip_addr_t rmtipaddr;

    tcp_client_pcb = tcp_new();                 /* 1. 创建控制块 */
    if (tcp_client_pcb == NULL) {
        printf("tcp_new 失败\r\n");
        return;
    }

    IP4_ADDR(&rmtipaddr, 192, 168, 1, 2);       /* 电脑 IP */
    /* 2. 发起连接：SYN 发出后立即返回，成功时回调 tcp_client_connected */
    tcp_connect(tcp_client_pcb, &rmtipaddr, 8080,
                tcp_client_connected);
}

/* 3. 连接成功回调：在这里注册其余回调 */
err_t tcp_client_connected(void *arg, struct tcp_pcb *tpcb, err_t err)
{
    if (err != ERR_OK) {
        printf("连接失败 err=%d\r\n", err);
        tcp_abort(tpcb);                        /* 强制中止 */
        return err;
    }
    printf("连接服务器成功！\r\n");
    tcp_arg(tpcb, NULL);                        /* 传递用户参数（示例传 NULL） */
    tcp_recv(tpcb, tcp_client_recv);            /* 注册接收回调 */
    tcp_sent(tpcb, tcp_client_sent);            /* 注册发送成功回调 */
    tcp_err(tpcb, tcp_client_error);            /* 注册错误回调 */
    tcp_poll(tpcb, tcp_client_poll, 1);         /* 注册周期轮询回调 */
    return ERR_OK;
}
```

### 6.2 接收回调（核心：拷贝 + tcp_recved + 释放）

```c
/* 接收回调：p==NULL 表示对端已关闭连接；否则把数据拷贝到用户缓冲 */
err_t tcp_client_recv(void *arg, struct tcp_pcb *tpcb,
                      struct pbuf *p, err_t err)
{
    struct pbuf *q;
    u16_t data_len = 0;

    if (p == NULL) {
        /* 空 pbuf = 对端 FIN，连接要结束了 */
        printf("服务器关闭连接\r\n");
        tcp_close(tpcb);                        /* 回应并关闭 */
        return ERR_OK;
    }

    memset(recv_buf, 0, RECV_BUF_SIZE);         /* 缓冲清零 */
    for (q = p; q != NULL; q = q->next) {       /* 遍历 pbuf 链表拷贝 */
        if (q->len > (RECV_BUF_SIZE - data_len)) break;
        memcpy(recv_buf + data_len, q->payload, q->len);
        data_len += q->len;
    }
    printf("收到服务器数据: %s\r\n", recv_buf);

    tcp_recved(tpcb, p->tot_len);   /* ★ 通知内核已取走数据，更新接收窗口 */
    pbuf_free(p);                   /* ★ 释放 pbuf */
    return ERR_OK;
}
```

### 6.3 发送数据（tcp_write 入队 + tcp_output 发送）

```c
/* 发送数据：注意 tcp_write 只是入队，必须 tcp_output 才会真正发出 */
err_t tcp_client_send_data(struct tcp_pcb *tpcb, const char *data)
{
    err_t err;

    /* 发送缓冲空间不足时返回 ERR_MEM，需等 sent 回调后再发 */
    if (strlen(data) > tcp_sndbuf(tpcb)) {
        printf("发送缓冲区不够\r\n");
        return ERR_MEM;
    }

    /* 1 表示数据要拷贝进内核（TCP_WRITE_FLAG_COPY），
       这样调用后用户缓冲区可以立即复用 */
    err = tcp_write(tpcb, data, strlen(data), 1);
    if (err == ERR_OK) {
        tcp_output(tpcb);                       /* 立即发送缓冲队列 */
    }
    return err;
}

/* sent 回调：对端 ACK 后调用，可在此接着发下一批数据 */
err_t tcp_client_sent(void *arg, struct tcp_pcb *tpcb, u16_t len)
{
    printf("已确认发送 %d 字节\r\n", len);
    return ERR_OK;
}
```

## 7. 最小可用代码：TCP 服务器

配置步骤（(PDF p.330)）：`tcp_new` → `tcp_bind` → `tcp_listen` → `tcp_accept` → 新连接上注册 recv 等回调。注意服务器用 `tcp_close` 正常关闭（客户端实验教材里用的是 `tcp_abort`）。

```c
/* TCP 服务器初始化：绑定 8080 端口并进入监听 */
void tcp_server_init(void)
{
    struct tcp_pcb *tcppcbnew, *tcppcbconn;
    err_t err;

    tcppcbnew = tcp_new();                      /* 1. 创建控制块 */
    if (tcppcbnew == NULL) return;

    /* 2. 绑定本地所有 IP 的 8080 端口 */
    err = tcp_bind(tcppcbnew, IP_ADDR_ANY, 8080);
    if (err != ERR_OK) {
        printf("tcp_bind 失败\r\n");
        return;
    }

    /* 3. 进入监听状态，返回精简的 listen 控制块 */
    tcppcbconn = tcp_listen(tcppcbnew);

    /* 4. 注册 accept 回调：有客户端连上来时被调用 */
    tcp_accept(tcppcbconn, tcp_server_accept);
}

/* accept 回调：新连接 newpcb 已通过三次握手，注册收发回调 */
err_t tcp_server_accept(void *arg, struct tcp_pcb *newpcb, err_t err)
{
    tcp_setprio(newpcb, TCP_PRIO_MIN);          /* 设置新连接优先级 */

    printf("客户端 %d.%d.%d.%d 连接上了\r\n",
           (newpcb->remote_ip.addr & 0xff), ((newpcb->remote_ip.addr >> 8) & 0xff),
           ((newpcb->remote_ip.addr >> 16) & 0xff), ((newpcb->remote_ip.addr >> 24) & 0xff));

    tcp_arg(newpcb, NULL);                      /* 用户参数 */
    tcp_recv(newpcb, tcp_server_recv);          /* 接收回调 */
    tcp_sent(newpcb, tcp_server_sent);          /* 发送确认回调 */
    tcp_err(newpcb, tcp_server_error);          /* 错误回调 */
    tcp_poll(newpcb, tcp_server_poll, 1);       /* 轮询回调 */
    return ERR_OK;
}
```

> ⚠️ 三个"必须"：收到数据后 **必须 tcp_recved**（否则对方窗口被耗尽、通信停滞）；回调里处理完 pbuf **必须 pbuf_free**；发送缓冲满返回 ERR_MEM 时 **不能死等**，应等 sent 回调触发再发（教材的 senddata 就写成 while 循环配合 tcp_sndbuf 判断）。

## 动手练习（约 60 分钟）

### 练习 10.1：实验 A — 板子做 TCP 客户端

- 1️⃣ 电脑打开网络调试助手，**协议选 TCP Server，本地端口 8080**，点击"开始监听"（电脑 192.168.1.2）。
- 2️⃣ 在实验工程里按第 6 节代码实现客户端：连接 192.168.1.2:8080，成功后周期/按键发送 "TCP Client Data"，同时把收到的数据打印到串口。
- 3️⃣ 联调：工具里应看到板子连上并收到数据；工具回发字符串，板子串口应打印。再点工具的"断开"→ 板子应打印"服务器关闭连接"。
- 4️⃣ 验收标准：连接、双向收发、断开通知三个环节全部可复现。

### 练习 10.2：实验 B — 板子做 TCP 服务器 + Wireshark 看三次握手

- 1️⃣ 按第 7 节代码实现服务器：板子监听 8080（LCD/串口显示 Server Port）。
- 2️⃣ 电脑网络调试助手选 **TCP Client**，目标 192.168.1.10:8080，点"连接"。
- 3️⃣ Wireshark 过滤 `tcp.port == 8080`，连接瞬间应看到 3 条报文：`SYN → SYN,ACK → ACK`（展开看 Flags 和 Sequence Number 的 x/x+1/y/y+1 关系），之后收发数据的报文带 PSH、ACK 标志。
- 4️⃣ 关闭连接再抓 4 条 FIN/ACK 挥手报文。验收标准：能在抓包里指认出握手与挥手的每一步。

## 自测（答完再点答案）

### 随堂小测 1

Q1. 三次握手中，客户端发出 SYN 后进入哪个状态？

- A. LISTEN
- B. SYN_SENT
- C. ESTABLISHED

<details>
<summary>查看答案</summary>

B。tcp_connect 发送 SYN 后把状态置为 SYN_SENT，等服务器的 SYN+ACK（PDF p.301）。

</details>

### 随堂小测 2

Q2. tcp_write 调用后数据立即发到网络上了吗？

- A. 立即发送并等待 ACK 才返回
- B. 只是放进发送缓冲队列，需 tcp_output 才发送
- C. 直接丢弃不发送

<details>
<summary>查看答案</summary>

B。tcp_write 只把数据入队（unsent 队列），tcp_output 才真正发出；缓冲满返回 ERR_MEM（PDF p.316）。

</details>

### 随堂小测 3

Q3. recv 回调收到数据并拷贝给用户后，还必须调用什么？

- A. tcp_sent 通知对端已接收
- B. tcp_recved 更新接收窗口
- C. tcp_abort 关闭连接

<details>
<summary>查看答案</summary>

B。tcp_recved 通知内核数据已被取走，内核才能更新接收窗口并继续通告对方发送（PDF p.314）。

</details>

### 随堂小测 4

Q4. 服务器进入监听状态，用哪个函数组合？

- A. tcp_new + tcp_bind + tcp_listen + tcp_accept
- B. tcp_new + tcp_connect + tcp_recv
- C. tcp_new + tcp_write + tcp_output

<details>
<summary>查看答案</summary>

A。服务器流程：创建→绑定→监听→注册 accept 回调；tcp_connect 是客户端行为，tcp_write 是发数据（PDF p.330）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 12、13 章（(PDF p.281~338)）——TCP 协议、状态机、客户端与服务器实验全解析
- 🌐 [lwIP 官网](https://savannah.nongnu.org/projects/lwip/)——tcp.h 中 tcp_recv_fn / tcp_accept_fn / tcp_write 官方声明
- 📕 RFC 793（TCP）——协议权威出处，三次握手与状态机的"宪法"

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 11 课——NETCONN 接口，把今天的回调地狱换成"阻塞式"的线程友好写法，在 FreeRTOS 任务里跑 UDP 和 TCP，感受两种风格的对比。

| [← 上一课](/my-blog/posts/lwip/0009-raw-udp/) | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0011-netconn-api/) |
