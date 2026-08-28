---
title: 无 OS 移植
published: 2026-08-15
description: 以太网 DMA 描述符、ethernetif.c 收发包、arch 配置，裸机主循环跑通第一次 ping。
tags: [lwIP, 嵌入式, 网络, 移植]
category: lwIP
draft: false
prevTitle: FreeRTOS 移植
prevSlug: "lwip/0003-freertos-porting"
nextTitle: lwIP 初探
nextSlug: "lwip/0001-lwip-intro"
---

# 无 OS 移植

> 以太网 DMA 描述符、ethernetif.c 收发包、arch 配置、裸机主循环跑通 ping

**本课目标：**把 lwIP 2.1.3 装进裸机工程，让探索者板子第一次"上网"。学完你能说清：以太网 DMA 描述符怎么追踪数据包、ethernetif.c 的收发函数各干什么、lwipopts.h 里哪些宏决定内核形态、无 OS 模式下协议栈靠什么"活着"。最后动手：开发板静态 IP `192.168.1.10`，电脑 `ping` 通它，再用 Wireshark 亲眼看到 ARP 请求/应答和 ICMP 报文——这是你第一次"看见"协议在跑。

## 1. 前期准备：搭好移植的"房间"

教材以裸机内存管理实验为基础工程（PDF 第 2.1 节 (PDF p.32)），因为 lwIP 后面要借用内存管理来给 DMA 描述符、缓冲区分配空间。做法很简单：

- 在 `Middlewares` 下建 `lwip` 文件夹，里面再建两个子文件夹：
- 📁 `arch` —— 放 lwIP 的配置文件（lwipopts.h / cc.h / ethernetif.c / lwip_comm.c 等）
- 📁 `lwip_app` —— 放你自己的应用代码（后面 UDP/TCP 实验都在这里写）

目录结构就一句话：**内核源码一个仓库，配置归 arch，应用归 lwip_app**。你动手时在"你的 lwIP 实验工程"里照这个结构建即可。

> 💡 移植的本质不是"写代码"，而是"接水管"：lwIP 内核不知道你的网卡长什么样，它只认 `ethernetif.c` 提供的四个口子（init / input / output / 时基）。本课后面就是把这四个口子焊到 STM32 的 ETH 硬件上。

## 2. 以太网 DMA 描述符：数据搬运的"快递单"

STM32 的以太网模块里，**内存 ⇄ 收发 FIFO 的数据搬运全靠 DMA 完成**，而 DMA 怎么搬、搬到哪，全靠"描述符"说了算（PDF 第 2.2 节 (PDF p.32)）。

### 2.1 两种链表结构

模块有两条描述符列表（接收一条、发送一条），基地址分别写入 `DMARDLAR` / `DMATDLAR` 寄存器。描述符之间可以连成两种结构：

- **环形结构**：最后一个描述符指回第一个，头尾相连
- **链接结构**：每个描述符的"下一个描述符"字段指向下一个（HAL 驱动库用的是这种）

### 2.2 描述符长什么样

描述符由结构体 `ETH_DMADescTypeDef` 描述（F4 V1.26.0 版本，探索者/DMF407）：

```c
typedef struct
{
  __IO uint32_t Status;              /* 状态：OWN 位、帧长度等都在这里 */
  uint32_t ControlBufferSize;        /* 控制和 buffer1、buffer2 的长度 */
  uint32_t Buffer1Addr;              /* 缓冲区 1 地址 */
  uint32_t Buffer2NextDescAddr;      /* 缓冲区 2 地址或下一个描述符地址 */
  uint32_t ExtendedStatus;           /* 增强描述符状态（常规描述符不用） */
  uint32_t Reserved1;                /* 保留 */
  uint32_t TimeStampLow;             /* 时间戳低位 */
  uint32_t TimeStampHigh;            /* 时间戳高位 */
} ETH_DMADescTypeDef;
```

注意：这 8 个成员并不是 STM32 里真实存在的寄存器，而是被称作**"软件寄存器"（描述符字）**（(PDF p.35)）。常规描述符只用前 4 个描述符字 `TDES0~TDES3`，对应关系：TDES0=Status（状态/控制）、TDES1=ControlBufferSize（缓冲长度）、TDES2=Buffer1Addr、TDES3=Buffer2NextDescAddr。增强描述符才有 8 个字（TDES4~7 用于时间戳等）。本教程用常规描述符。

三条使用规则必须记牢：
- ⚠️ 一个以太网数据包可以**跨越多个** DMA 描述符
- ⚠️ 一个 DMA 描述符只能服务于**一个**数据包
- ⚠️ 描述符列表最后一个指向第一个，形成**循环链**

### 2.3 例程里怎么组织 + 怎么追踪

例程在 `ethernet.c` 里定义两个指向描述符数组的指针，接收发送各一条链：

```c
ETH_DMADescTypeDef *g_eth_dma_rx_dscr_tab;  /* 以太网 DMA 接收描述符表指针 */
ETH_DMADescTypeDef *g_eth_dma_tx_dscr_tab;  /* 以太网 DMA 发送描述符表指针 */

/* 用 HAL 库函数把"数组"变成"链接结构"，并绑定缓冲区 */
HAL_ETH_DMATxDescListInit(&g_eth_handler, g_eth_dma_tx_dscr_tab,
                          g_eth_tx_buf, ETH_TXBUFNB);  /* 初始化发送描述符 */
HAL_ETH_DMARxDescListInit(&g_eth_handler, g_eth_dma_rx_dscr_tab,
                          g_eth_rx_buf, ETH_RXBUFNB);  /* 初始化接收描述符 */
```

**追踪**（(PDF p.37)）：句柄 `g_eth_handler`（ETH_HandleTypeDef）内部有两个指针 `TxDesc` 和 `RxDesc`，它们始终指向**下一个要发送/接收的描述符**。驱动程序每处理完一个包就把描述符的 OWN 位交还给 DMA，然后沿着 `Buffer2NextDescAddr` 走到下一个——这就是收发流程的"游标"。看 `low_level_output` / `low_level_input` 源码时留意这两个指针的用法。

## 3. 添加网卡驱动：ethernet.c 与 PHY

移植第一步：把正点原子例程 `Drivers\BSP\ETHERNET\ethernet.c/h` 拷进你的工程（PDF 第 2.3.1 节 (PDF p.38)），同时把 `stm32f4xx_hal_eth.c` 加进 HAL 分组，并在 `stm32f4xx_hal_conf.h` 顶部使能 `HAL_ETH_MODULE_ENABLED`。ethernet.c 里几个关键函数：

| 函数 | 职责 |
|------|------|
| `ethernet_init()` | 配置 MAC 并调用 `HAL_ETH_Init` 初始化以太网 |
| `HAL_ETH_MspInit()` | RMII 引脚、时钟、中断使能、PHY 硬件复位 |
| `ethernet_read_phy / write_phy` | SMI 通道读写 PHY 寄存器（封装 HAL 函数） |
| `ethernet_chip_get_speed()` | 读取 PHY 的速度/双工状态 |
| `ETH_IRQHandler()` | 接收中断服务函数，交给 `lwip_pkt_handle()` |
| `ethernet_get_eth_rx_size()` | 从接收描述符解析出帧长度 |
| `ethernet_mem_malloc/free` | 为描述符表和收发缓冲区申请内存 |

`ethernet_init` 的核心就是填一个"配置全家桶"再调 `HAL_ETH_Init`（(PDF p.39)）：

```c
g_eth_handler.Instance = ETH;
/* 使能自协商模式 */
g_eth_handler.Init.AutoNegotiation = ETH_AUTONEGOTIATION_ENABLE;
g_eth_handler.Init.Speed = ETH_SPEED_100M;          /* 自协商开启时此配置无效 */
g_eth_handler.Init.DuplexMode = ETH_MODE_FULLDUPLEX;
g_eth_handler.Init.PhyAddress = ETHERNET_PHY_ADDRESS;   /* 板载 PHY 地址 0x00 */
g_eth_handler.Init.MACAddr = macaddress;
g_eth_handler.Init.RxMode = ETH_RXINTERRUPT_MODE;       /* 中断接收模式 */
g_eth_handler.Init.ChecksumMode = ETH_CHECKSUM_BY_HARDWARE; /* 硬件校验 */
g_eth_handler.Init.MediaInterface = ETH_MEDIA_INTERFACE_RMII; /* RMII 接口 */

if (HAL_ETH_Init(&g_eth_handler) == HAL_OK)
{
     return 0;   /* 成功 */
}
else
{
     return 1;   /* 失败 */
}
```

你的板子有两个"个性设置"要留意：

- 🔌 **RMII 引脚**（探索者）：MDIO=PA2、MDC=PC1、REF_CLK=PA1、CRS_DV=PA7、RXD0=PC4、RXD1=PC5、TX_EN=PG11、TXD0=PG13、TXD1=PG14、**RESET=PD3**（DMF407 是 PI8，这是两块板第一处区别）。RMII 需要 `ETH_CLK` 提供 50MHz 参考时钟，`HAL_ETH_MspInit` 里全配好了，复用功能 `GPIO_AF11_ETH`。
- 🔌 **PHY 型号**：你的探索者板载 **LAN8720A**，要在 `stm32f4xx_hal_conf.h` 里把 `PHY_TYPE` 设为 `LAN8720`（教材里写的是 0），它对应 `PHY_SR = 0x1F`（LAN8720 的状态寄存器是 31 号，bit2 是速度位）。DMF407 板载 LAN8720A、新款探索者板载 YT8512C，`ethernet_chip_get_speed()` 就是用 `PHY_TYPE` 宏选择从哪个寄存器读速度的（(PDF p.42)）。

再补三个常量：`MAC_ADDR0~5`（在 stm32f4xx_hal_conf.h 里定义）、`ETH_RXBUFNB = ETH_TXBUFNB = 5`、`ETHERNET_PHY_ADDRESS = 0x00`。最后 `ETH_IRQHandler` 中断里判断收到帧就调 `lwip_pkt_handle()`，清标志位（(PDF p.43)）——此时编译会报这个函数未定义，别慌，它在 lwip_comm.c 里，第 5 节会补上。

> ⚠️ 本课实验环境是**网线直连电脑**（没有路由器），所以必须用**静态 IP**：把 `lwip_comm_default_ip_set()` 里的开发板 IP 改成 `192.168.1.10`，电脑网卡配 `192.168.1.2`，并把 `LWIP_DHCP` 改为 0（或保持 1 但等它超时回落静态 IP）。教材例程默认 IP 是 192.168.1.30，你实验时改成 192.168.1.10 即可。

## 4. 添加 lwIP 源文件与 arch 配置

把 `lwip-2.1.3/src` 整个拷进 `Middlewares\lwip`，然后建四个分组加文件（PDF 第 2.3.2 节 (PDF p.46)）：

- `src/api` —— 全部 .c（Netconn/Socket 层）
- `src/core` —— 除 ipv6 外的全部 .c（协议栈内核）
- `src/netif` —— 只加 `ethernet.c`（通用以太网封装）
- `arch` —— 你自己准备的 lwipopts.h / cc.h / ethernetif.c / lwip_comm.c

arch 文件来源：`lwipopts.h` 和 `cc.h` 推荐从 ST 官方 STM32Cube_FW_F4_V1.26.0 包里拷（已针对 ST 芯片调好），ethernetif.c 用 contrib 包的模板或正点原子写好的版本。

### 4.1 lwipopts.h：内核的"裁剪清单"

这个文件决定 lwIP 编译成什么样（(PDF p.49)）。无 OS 移植的命根子就三个宏：

```c
/* NO_SYS 表示无操作系统模拟层，无操作系统为 1，有操作系统设置为 0 */
#define NO_SYS                        1
#define SYS_LIGHTWEIGHT_PROT          0     /* 无 OS 时不需要任务间保护 */
#define NO_SYS_NO_TIMERS              0     /* 允许 sys_timeout 定时机制 */
```

其他关键项（教材裸机配置值）：
- 内存：`MEM_ALIGNMENT=4`、`MEM_SIZE=30*1024`（堆）、`MEMP_NUM_PBUF=25`、`PBUF_POOL_SIZE=20`
- TCP：`TCP_MSS=1460`（1500-40）、`TCP_SND_BUF=11*TCP_MSS`、`TCP_WND=20*TCP_MSS`、`TCP_QUEUE_OOSEQ=0`（省内存）
- 协议：`LWIP_TCP=1`、`LWIP_UDP=1`、`LWIP_ICMP=1`、`LWIP_DHCP=1`（本课实验可改 0）
- 校验和：`CHECKSUM_BY_HARDWARE` —— 定义后 `CHECKSUM_GEN_*` 全为 0，IP/UDP/TCP 校验交给 MAC 硬件算，省 CPU
- 接口：`LWIP_NETCONN=0`、`LWIP_SOCKET=0`（裸机精简版先用 RAW 编程接口，第 9 课才打开）

### 4.2 cc.h：数据类型的"翻译官"

cc.h 告诉 lwIP 你的编译器和平台特性（(PDF p.53)）：

```c
typedef int sys_prot_t;   /* 无 OS 时临界区保护类型，直接定义成 int */

/* 按编译器定义结构体紧凑打包宏（MDK 用 __CC_ARM 分支） */
#define PACK_STRUCT_BEGIN __packed
#define PACK_STRUCT_STRUCT
#define PACK_STRUCT_END
#define PACK_STRUCT_FIELD(x) x

#define LWIP_PLATFORM_ASSERT(x) do \
        {printf("Assertion \"%s\" failed at line %d in %s\n", \
        x, __LINE__, __FILE__); } while(0)
#define LWIP_RAND() ((u32_t)rand())   /* 随机数种子：协议栈 ARP 等用 */
```

教材特别提醒：原模板里 `#include "cpu.h"`（F4 没有这文件）和 `LWIP_PROVIDE_ERRNO`（已在 lwipopts.h 定义）要删掉，否则重复定义报错。类型定义（u8_t、u16_t 等）lwIP 自带 arch.h 会处理，F4 上不需要手写。

## 5. ethernetif.c：协议栈与网卡的"桥梁"

这个文件一共六个函数（(PDF p.54)），三个给内核当回调，两个干活，一个报时：

| 函数 | 角色 |
|------|------|
| `ethernetif_init()` | 网卡初始化入口：填 netif 字段，把收发钩子绑给 low_level_output/input |
| `low_level_init()` | 设置 MAC、mtu=1500、flags，初始化 DMA 描述符并启动 ETH |
| `low_level_output()` | 把 pbuf 链拷进 Tx Buffer，调 `HAL_ETH_TransmitFrame` 发出去 |
| `low_level_input()` | 从 Rx Buffer 拷数据进新建的 pbuf，返回给上层 |
| `ethernetif_input()` | 取包 → 调 `netif->input` 送进内核 |
| `sys_now()` | 毫秒时基（裸机版 = `HAL_GetTick()`） |

### 5.1 发送：low_level_output

核心逻辑（(PDF p.56)）：遍历 pbuf 链表，逐段检查当前 Tx 描述符的 **OWN 位**（归 DMA 所有才可用），把数据 `memcpy` 进描述符的 Buffer；一段装不下就走 `Buffer2NextDescAddr` 换下一个描述符（这就是"一个包跨多个描述符"）。全部拷完后：

```c
/* 所有数据都放入 Tx Buffer 后，发送此帧 */
HAL_ETH_TransmitFrame(&g_eth_handler, framelength);
errval = ERR_OK;
error:
/* 发送缓冲区下溢会让 TxDMA 挂起，必须清标志并向 DMATPDR 写值唤醒 */
if ((g_eth_handler.Instance->DMASR & ETH_DMASR_TUS) != (uint32_t)RESET)
{
    g_eth_handler.Instance->DMASR = ETH_DMASR_TUS;   /* 清除下溢标志 */
    g_eth_handler.Instance->DMATPDR = 0;             /* 唤醒 Tx DMA */
}
```

### 5.2 接收：low_level_input

流程（(PDF p.59)）：`HAL_ETH_GetReceivedFrame` 判断收到帧 → 从 `RxFrameInfos` 拿长度和缓冲区 → `pbuf_alloc(PBUF_RAW, len, PBUF_POOL)` 申请 pbuf（这正是第 4 课内存池的用武之地）→ 沿描述符链拷数据 → 把用过的描述符 OWN 位置 1 归还 DMA，并用 `DMARPDR` 唤醒可能挂起的 RxDMA：

```c
p = pbuf_alloc(PBUF_RAW, len, PBUF_POOL);   /* 申请 pbuf，从内存池取 */
if (p != NULL)                              /* pbuf 申请成功 */
{
    /* ……沿接收描述符链把 Rx Buffer 数据拷进 pbuf（可跨多个描述符）…… */
}
else
{
    LINK_STATS_INC(link.memerr);            /* 池耗尽就丢包，统计 +1 */
    LINK_STATS_INC(link.drop);
}
/* 释放 DMA 描述符：置 OWN 位归还 DMA */
for (i = 0; i < g_eth_handler.RxFrameInfos.SegCount; i++)
{
    dmarxdesc->Status |= ETH_DMARXDESC_OWN;
    dmarxdesc = (ETH_DMADescTypeDef *)(dmarxdesc->Buffer2NextDescAddr);
}
return p;
```

### 5.3 无 OS 运行模型：中断收包 + 主循环喂时基

裸机没有线程，lwIP 靠两件事"活着"（(PDF p.63~69)）：

- **收包走中断**：`ETH_IRQHandler` → `lwip_pkt_handle()` → 间接调 `ethernetif_input()`（在 lwip_comm.c 里），取包后调 `netif->input(p, netif)` 把数据喂给内核（ip/arp/icmp 层）
- **定时靠轮询**：主循环每 2ms 调一次 `lwip_periodic_handle()`，它内部调 `sys_check_timeouts()` 处理所有超时事件（TCP 重传、ARP 老化、DHCP 重试等），再按需调 DHCP 的粗/细定时器

```c
int main(void)
{
    /* ……外设初始化…… */
    while (lwip_comm_init() != 0)   /* 初始化失败则重试 */
    {
        delay_ms(500);
    }
    while (1)
    {
        lwip_periodic_handle();     /* lwIP 轮询任务：超时 + DHCP 处理 */
        delay_ms(2);                /* 每 2ms 喂一次 */
        /* ……其他业务代码，比如翻转 LED…… */
    }
}
```

初始化链（lwip_comm_init，(PDF p.63)）：`ethernet_mem_malloc` 给描述符表/缓冲区申请内存 → `lwip_comm_default_ip_set` 写死 IP/掩码/网关 → `ethernet_init` 起硬件 → `lwip_init()` 初始化内核（内存堆、内存池、pbuf、netif 链表）→ `netif_add()` 挂网卡（回调传 `ethernetif_init` 和 `ethernet_input`）→ `netif_set_default` + `netif_set_up` 开网口。

> 💡 记忆锚点：裸机版 lwIP 是"**中断喂包、轮询喂时**"的被动打工仔——它没有自己的线程，全靠你的 main 循环推着走。下一课换成 FreeRTOS 后，内核会变成独立的 tcpip_thread，自己"主动吃饭"，你对比着学就通了。

## 动手练习

### 练习 2.1：无 OS 移植 + 静态 IP 跑通 ping

- 1️⃣ 在"你的 lwIP 实验工程"里按第 3、4 节步骤添加 ethernet.c、hal_eth.c、lwIP 源码分组和 arch 四个文件（lwipopts.h / cc.h / ethernetif.c / lwip_comm.c）。
- 2️⃣ 确认 `PHY_TYPE` = LAN8720（探索者板载 LAN8720A），`stm32f4xx_hal_conf.h` 里使能 `HAL_ETH_MODULE_ENABLED`，RESET 引脚为 PD3。
- 3️⃣ 把 `lwip_comm_default_ip_set()` 里的 IP 改为 `192.168.1.10`、掩码 `255.255.255.0`、网关 `192.168.1.1`；`LWIP_DHCP` 改 0（直连无路由器）。
- 4️⃣ 网线直连电脑（电脑网卡静态 IP `192.168.1.2`），编译下载，串口助手观察打印的 IP 信息。
- 5️⃣ 电脑上 `ping 192.168.1.10`。
- ✅ **怎么做/观察什么**：ping 应显示"字节=32 时间<1ms TTL=255"（TTL=255 是 lwIP 的 TCP_TTL 默认值，一眼认出对端是 lwIP）。若不通：先查网线灯（LAN8720 链路灯），再看串口打印的 PHY 通信是否成功（`ethernet_read_phy(PHY_SR)` 卡死就是 SMI 没通），最后确认电脑网卡 IP 是否在同一网段。

### 练习 2.2：Wireshark 抓 ARP/ICMP，第一次"看见"协议

- 1️⃣ 电脑上打开 Wireshark，选网线直连那块网卡，过滤条件写 `icmp || arp`。
- 2️⃣ 清空 ARP 缓存（`arp -d`），再 `ping 192.168.1.10`。
- 3️⃣ 观察抓包列表。
- ✅ **怎么做/观察什么**：你应该看到三幕戏——① 电脑先发 **ARP 请求**"谁是 192.168.1.10？"，目标 MAC 是广播 ff:ff:ff:ff:ff:ff；② 开发板回 **ARP 应答**（注意它的源 MAC 就是 lwip_comm_default_ip_set 里配的那 6 字节）；③ 之后才是成对的 **ICMP Echo Request / Echo Reply**。这个顺序解释了为什么"通信前要先问 MAC 地址"——ARP 就是第 7 课的伏笔。

## 自测

### 随堂小测 1

**Q1. 以太网 DMA 描述符在 STM32 中的本质是什么？**

- 芯片内部真实存在的硬件寄存器
- 由结构体 ETH_DMADescTypeDef 描述的内存结构，也称"软件寄存器"
- 一段固定的 FIFO 存储区

<details>
<summary>查看答案</summary>

B。描述符是内存里的结构体数组，用 TDES0~TDES3 等描述符字描述状态和缓冲区，不是硬件寄存器（PDF p.35）。

</details>

**Q2. 无 OS 移植中，lwIP 的收包和时基分别由谁驱动？**

- 收包走 ETH 中断，时基靠主循环轮询 sys_check_timeouts
- 收包靠轮询，时基走 SysTick 中断
- 收包和时基都靠硬件 DMA 自动完成

<details>
<summary>查看答案</summary>

A。ETH_IRQHandler → lwip_pkt_handle → ethernetif_input 收包；main 循环每 2ms 调 lwip_periodic_handle 处理超时（PDF p.63~69）。

</details>

**Q3. NO_SYS 宏在 lwipopts.h 中分别取值时代表什么？**

- 1 表示无操作系统，0 表示有操作系统
- 0 表示无操作系统，1 表示有操作系统
- 该宏只影响内存分配，与操作系统无关

<details>
<summary>查看答案</summary>

A。NO_SYS=1 编译无操作系统版本（本课），NO_SYS=0 编译带 OS 版本（第 3 课），注意这个参数不同编译出的内核代码不同（PDF p.50）。

</details>

**Q4. 发送数据包时，如果数据超过一个 Tx Buffer 的大小怎么办？**

- 丢弃超出的部分，只发一帧
- 沿 Buffer2NextDescAddr 链使用多个发送描述符分片拷贝
- 扩大单个描述符的 Buffer 后再发送

<details>
<summary>查看答案</summary>

B。一个以太网数据包可以跨越多个 DMA 描述符，low_level_output 按 ETH_TX_BUF_SIZE 分片 memcpy，最后一次 HAL_ETH_TransmitFrame 发出（PDF p.57）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 2 章（PDF p.32~87）——重点 2.1~2.3 探索者部分，本课全部依据
- 📕 STM32F407 中文参考手册以太网章节——DMA 描述符各描述符字位含义的权威出处
- 🌐 [lwIP 官网](https://savannah.nongnu.org/projects/lwip/)——lwIP 2.1.3 源码与 contrib 包（ethernetif.c 模板、freertos 移植目录）
- 🌐 [Wireshark](https://www.wireshark.org/)——本课练习 2.2 的抓包工具

## 下一步

有不清楚的地方直接问我（Agent 就是你的老师）。下一课预告：第 3 课——把 lwIP 移植到 FreeRTOS 上，内核变成独立的 tcpip_thread，你会看到信号量、邮箱和协议栈线程的"同居生活"。

| [← 上一课](/my-blog/posts/lwip/0001-lwip-intro/) | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0003-freertos-porting/) |