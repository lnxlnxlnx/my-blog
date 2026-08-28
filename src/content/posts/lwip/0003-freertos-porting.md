---
title: FreeRTOS 移植
published: 2026-08-16
description: NO_SYS=0、sys_arch 三件套（邮箱/信号量/互斥）、tcpip_thread 单线程模型、用户任务与协议栈共存。
tags: [lwIP, 嵌入式, 网络, FreeRTOS, 移植]
category: lwIP
draft: false
prevTitle: 内存管理
prevSlug: "lwip/0004-memory-management"
nextTitle: 无 OS 移植
nextSlug: "lwip/0002-baremetal-porting"
---

# FreeRTOS 移植

> NO_SYS=0、sys_arch 三件套（邮箱/信号量/互斥）、tcpip_thread 单线程模型、任务共存

**本课目标：**把第 2 课的裸机 lwIP"升级"到 FreeRTOS 上。学完你能说清：NO_SYS=0 到底改变了什么、sys_arch.c 是怎么用 FreeRTOS 的消息队列/信号量/互斥量"冒充" lwIP 的 IPC 的、协议栈为什么是单线程的 tcpip_thread、网卡收包怎么通过邮箱送进内核。最后动手：FreeRTOS 下 ping 通开发板，并创建你自己的用户任务与协议栈共存运行。你 FreeRTOS 课学过的队列、信号量、任务优先级，这课全部派上用场。

## 1. 前期准备：换个"世界观"

带 OS 移植的基础工程是第 2 章的裸机例程（PDF 第 3.1 节 (PDF p.88)），前提是你已经有一个跑得通的 FreeRTOS 工程（你正在学的 FreeRTOS 课就是它的底座，建议先在自己工程里把 LED 任务跑起来再动手）。

世界观变化一句话：**裸机版是"主循环推着协议栈走"，OS 版是"协议栈自己成为一个任务（tcpip_thread），别人用邮箱给它送数据、发命令"**。于是之前的所有"轮询"全部失业，换成了操作系统原生的同步机制。

> 💡 你学的 FreeRTOS 知识这里全部对上号：**邮箱 = 消息队列**（FreeRTOS 没有邮箱，lwIP 用一个装指针的队列模拟）、**信号量 = 二值信号量**（中断里 xSemaphoreGiveFromISR）、**互斥量 = 递归互斥量**（防优先级翻转）。这不是巧合，lwIP 只定义了"接口"，实现全是 FreeRTOS 的 API。

## 2. 修改 lwipopts.h：NO_SYS=0 与内核线程配置

第一个改动就是灵魂开关（PDF 第 3.2.1 节 (PDF p.88)）：

```c
/* NO_SYS 表示无操作系统模拟层，无操作系统为 1，有操作系统设置为 0 */
#define NO_SYS                                  0
#define SYS_LIGHTWEIGHT_PROT                    1   /* OS 下内核需要临界区保护 */
```

NO_SYS=0 后，lwIP 会编译进 sys.h/sys.c 里整套"操作系统模拟层"代码——它不再自己空转轮询，而是调用 sys_arch 提供的线程、邮箱、信号量接口。教材这个版本还顺手调小了一些内存（`MEM_SIZE=10*1024`、`PBUF_POOL_SIZE=8`、`TCP_WND=2*TCP_MSS` 等），因为 RAM 要分给 FreeRTOS 任务栈。

第二处重点是**操作系统选项区**（(PDF p.91)），它直接决定 tcpip_thread 的"配置档案"：

```c
/* ---------- 操作系统选项 ---------- */
#define TCPIP_THREAD_NAME                  "TCP/IP"
#define TCPIP_THREAD_STACKSIZE             1000   /* tcpip 线程栈大小（字） */
#define TCPIP_MBOX_SIZE                    6      /* tcpip 线程邮箱容量 */
#define DEFAULT_UDP_RECVMBOX_SIZE          6      /* 每个 UDP PCB 的接收邮箱 */
#define DEFAULT_TCP_RECVMBOX_SIZE          6      /* 每个 TCP PCB 的接收邮箱 */
#define DEFAULT_ACCEPTMBOX_SIZE            6      /* 监听连接用的 accept 邮箱 */
#define DEFAULT_THREAD_STACKSIZE           500    /* 默认用户线程栈大小 */
#define TCPIP_THREAD_PRIO                  5      /* tcpip 线程优先级 */
```

还有两个接口开关：`LWIP_NETCONN=1`（Netconn 层启用，它是 API 消息的搬运工，靠邮箱和 tcpip_thread 通信），`LWIP_SOCKET=0`（Socket 层留给第 12 课）。另外补上 `LWIP_PROVIDE_ERRNO=1`——否则 err.c 的 `err_to_errno_table` 数组会编译报错（(PDF p.92)）。

## 3. sys_arch.c：用 FreeRTOS API 冒充 lwIP 的 IPC

从 contrib 包的 `ports\freertos` 目录拷来 sys_arch.c/h，放进 arch 文件夹（(PDF p.91)）。这个文件是 lwIP 与 FreeRTOS 的"翻译层"，函数很多（(PDF p.149) 表 3.5.1），但归纳起来就三类：**邮箱、信号量、互斥量**，外加线程创建和几个系统函数。

### 3.1 邮箱机制：lwIP 的消息"信箱"

邮箱在 lwIP 里就是"一个指针"的搬运通道——lwIP 通过它把数据指针、API 消息发给 tcpip_thread。FreeRTOS 没有邮箱，用消息队列模拟（(PDF p.150)）：

```c
err_t
sys_mbox_new(sys_mbox_t *mbox, int size)
{
    mbox->mbx = xQueueCreate((UBaseType_t)size, sizeof(void *));
    if (mbox->mbx == NULL)
    {
        return ERR_MEM;
    }
    return ERR_OK;
}

void
sys_mbox_post(sys_mbox_t *mbox, void *msg)
{
    /* 向邮箱发送消息，一直阻塞直到放进队列 */
    xQueueSendToBack(mbox->mbx, &msg, portMAX_DELAY);
}

err_t
sys_mbox_trypost_fromisr(sys_mbox_t *mbox, void *msg)
{
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    /* 中断版发送：唤醒更高优先级任务时返回 ERR_NEED_SCHED */
    xQueueSendToBackFromISR(mbox->mbx, &msg, &xHigherPriorityTaskWoken);
    if (xHigherPriorityTaskWoken == pdTRUE)
    {
        return ERR_NEED_SCHED;   /* 调用方需要做一次任务切换 */
    }
    return ERR_OK;
}

u32_t
sys_arch_mbox_fetch(sys_mbox_t *mbox, void **msg, u32_t timeout_ms)
{
    /* 从邮箱取消息：timeout 为 0 表示永久等待 */
    xQueueReceive(mbox->mbx, msg, portMAX_DELAY);
    return 1;                    /* 非 SYS_ARCH_TIMEOUT 即成功 */
}
```

注意三个细节：

- 队列元素是 `void *`（4 字节指针），所以"发消息"= "传指针"，数据本体不拷贝——这就是 pbuf 能跨线程零拷贝流转的基础
- `sys_mbox_trypost_fromisr` 是唯一能在中断里调用的邮箱函数，唤醒高优先级任务时返回 `ERR_NEED_SCHED`（sys_arch.h 里定义为 123），tcpip_thread 收到后立刻让出 CPU
- 超时返回 `SYS_ARCH_TIMEOUT`，lwIP 内核据此判断"等待超时"继续干别的

### 3.2 信号量机制：内核的"同步闹钟"

信号量给 lwIP 提供同步（比如 API 线程等内核处理完某个请求），封装成 FreeRTOS 二值信号量（(PDF p.155)）：

```c
err_t
sys_sem_new(sys_sem_t *sem, u8_t initial_count)
{
    sem->sem = xSemaphoreCreateBinary();
    if (sem->sem == NULL)
    {
        return ERR_MEM;
    }
    if (initial_count == 1)
    {
        xSemaphoreGive(sem->sem);   /* 初始可用一次 */
    }
    return ERR_OK;
}

void
sys_sem_signal(sys_sem_t *sem)
{
    xSemaphoreGive(sem->sem);       /* 释放信号量 */
}

u32_t
sys_arch_sem_wait(sys_sem_t *sem, u32_t timeout_ms)
{
    /* 等待信号量，timeout=0 永久等 */
    if (xSemaphoreTake(sem->sem, portMAX_DELAY) != pdTRUE)
    {
        return SYS_ARCH_TIMEOUT;
    }
    return 1;
}
```

### 3.3 互斥量机制：防优先级翻转的"门禁"

内核共享资源（如内存堆 mem_mutex）的互斥用**递归互斥量**（(PDF p.158)），递归版本允许同任务重入，防止内核嵌套调用时自己锁死自己：

```c
err_t
sys_mutex_new(sys_mutex_t *mutex)
{
    mutex->mut = xSemaphoreCreateRecursiveMutex();   /* 递归互斥量 */
    if (mutex->mut == NULL)
    {
        return ERR_MEM;
    }
    return ERR_OK;
}

void
sys_mutex_lock(sys_mutex_t *mutex)
{
    xSemaphoreTakeRecursive(mutex->mut, portMAX_DELAY);   /* 阻塞获取 */
}

void
sys_mutex_unlock(sys_mutex_t *mutex)
{
    xSemaphoreGiveRecursive(mutex->mut);                  /* 释放 */
}
```

### 3.4 线程创建与系统函数

`sys_thread_new` 是 lwIP 内部创建线程的统一入口，本质就是一层 `xTaskCreate` 包装（(PDF p.161)）：

```c
sys_thread_t
sys_thread_new(const char *name, lwip_thread_fn thread, void *arg,
               int stacksize, int prio)
{
    TaskHandle_t rtos_task;
    /* lwIP 的线程函数签名和 FreeRTOS 的 TaskFunction_t 一致，直接传 */
    xTaskCreate(thread, name, (configSTACK_DEPTH_TYPE)stacksize,
                arg, prio, &rtos_task);
    return rtos_task;
}
```

剩下的都是"小工具"（(PDF p.159)）：`sys_now()` 用 `xTaskGetTickCount()*portTICK_PERIOD_MS` 报毫秒；`sys_arch_protect/unprotect` 包 `taskENTER_CRITICAL/EXIT`（给 `SYS_LIGHTWEIGHT_PROT=1` 用）；`sys_arch_msleep` 包 `vTaskDelay`；`sys_init()` 空函数占位。sys_arch.h 里用 `struct _sys_sem { void *sem; }` 之类的包装结构体给句柄加了点"类型安全"，并提供 `sys_sem_valid / sys_mbox_valid / sys_mutex_valid` 等有效性判断宏（(PDF p.162)）。

> ⚠️ 加完 sys_arch.c 会踩三个"编译坑"，教材逐个点名（PDF p.92）：① err.c 的 `err_to_errno_table` 报错 → lwipopts.h 加 `LWIP_PROVIDE_ERRNO=1`；② `sys_now` 重复定义 → 删掉 ethernetif.c 里裸机版的 sys_now（sys_arch.c 已定义）；③ `typedef int sys_prot_t` 重复 → 注释掉 cc.h 里的那行（sys_arch.h 已定义）。

## 4. 改造收包链路：从"中断直调"到"信号量 + 邮箱"

裸机版收包是中断里直接调 `ethernetif_input`；OS 版把这件事拆给了两个"人"（PDF 第 3.2.3、3.2.4 节 (PDF p.93~96)）。

### 4.1 中断里只干一件事：释放信号量

lwip_comm.c 里的 `lwip_pkt_handle` 不再处理数据，只负责"喊一嗓子"：

```c
#include "FreeRTOS.h"
#include "semphr.h"
#include "task.h"

extern xSemaphoreHandle s_xSemaphore;   /* 二值信号量，ethernetif.c 里创建 */

void lwip_pkt_handle(void)
{
    BaseType_t xHigherPriorityTaskWoken;
    /* 中断里释放二值信号量，唤醒 eth_thread 接收任务 */
    xSemaphoreGiveFromISR(s_xSemaphore, &xHigherPriorityTaskWoken);
    portYIELD_FROM_ISR(xHigherPriorityTaskWoken);   /* 必要时切换任务 */
}
```

### 4.2 low_level_init：创建接收任务

ethernetif.c 的 `low_level_init` 新增两件事：创建二值信号量 + 用 `sys_thread_new` 建一个"收包专用任务" eth_thread（(PDF p.95)）：

```c
s_xSemaphore = xSemaphoreCreateBinary();    /* 创建一个信号量 */

/* 创建处理 ETH_MAC 的任务：收包和协议处理分线程 */
sys_thread_new("eth_thread",
               ethernetif_input,            /* 任务入口函数 */
               netif,                       /* 任务入口函数参数 */
               NETIF_IN_TASK_STACK_SIZE,    /* 任务栈大小 */
               NETIF_IN_TASK_PRIORITY);     /* 任务的优先级 */

HAL_ETH_DMATxDescListInit(&g_eth_handler, g_eth_dma_tx_dscr_tab,
                          g_eth_tx_buf, ETH_TXBUFNB);
HAL_ETH_DMARxDescListInit(&g_eth_handler, g_eth_dma_rx_dscr_tab,
                          g_eth_rx_buf, ETH_RXBUFNB);
HAL_ETH_Start(&g_eth_handler);              /* 开启 ETH */
```

### 4.3 ethernetif_input：从函数变成任务

`ethernetif_input` 彻底变身——不再是"被调用者"，而是常驻的接收任务：等信号量 → 取包 → 把 pbuf 指针投进 tcpip_thread 的邮箱（(PDF p.96)）：

```c
void
ethernetif_input(void *pParams)
{
    struct netif *netif = (struct netif *)pParams;
    struct pbuf *p = NULL;

    while (1)
    {
        /* 阻塞等 ETH 中断释放信号量 */
        if (xSemaphoreTake(s_xSemaphore, portMAX_DELAY) == pdTRUE)
        {
            taskENTER_CRITICAL();
            p = low_level_input(netif);     /* 从 DMA 描述符拷进 pbuf */
            taskEXIT_CRITICAL();

            if (p != NULL)
            {
                /* netif->input 已改为 tcpip_input：
                   把 pbuf 指针作为邮箱消息发给 tcpip_thread */
                if (netif->input(p, netif) != ERR_OK)
                {
                    pbuf_free(p);
                }
            }
        }
    }
}
```

配套改动三处（(PDF p.93~97)）：

- lwip_comm.c：`lwip_init()` 换成 `tcpip_init(NULL, NULL)`（它负责创建 tcpip_thread 和它的邮箱）；`netif_add` 第 7 参数由 `ethernet_input` 改为 `tcpip_input`（收包进内核的入口变了）；删掉 `lwip_periodic_handle`（超时由 tcpip_thread 自己管）
- ethernetif.h：删掉 `ethernetif_input` 和 `sys_now` 的声明（已改由 sys_arch 提供）
- ethernet.c：ETH_IRQHandler 里的 `while` 改 `if`（中断里只能快速进出，不能再循环取包）；ETH 中断优先级必须满足 FreeRTOS 规则（例程设 6，小于 configMAX_SYSCALL_INTERRUPT_PRIORITY，否则中断里调 GiveFromISR 是危险的）

## 5. tcpip_thread：协议栈的"单线程心脏"

带 OS 的 lwIP 有个铁律：**协议栈内核代码只在 tcpip_thread 这一个线程里跑**（tcpip.c 实现，`tcpip_init` 创建）。其他线程想用内核？把"活"打包成消息投进它的邮箱（`TCPIP_MBOX_SIZE=6` 个位置）：

- 📨 数据包消息（TCPIP_MSG_INPKT）：eth_thread 收的 pbuf 指针 → `tcpip_input` → 邮箱 → tcpip_thread 调 `ethernet_input` 解包进 IP/ARP/ICMP 层
- 📨 API 消息（TCPIP_MSG_API）：Netconn 层的 netconn_write/connect 等请求 → 邮箱 → tcpip_thread 执行完通过信号量通知 API 线程（第 11 课细讲）
- 📨 超时处理：tcpip_thread 自己的循环里调 `sys_check_timeouts()`，裸机版主循环的活儿它全包了

好处：**内核无需加锁**（只有它自己碰自己的数据），你的用户任务可以大胆地随便调 API。代价：所有协议处理排队串行，吞吐被单线程限制——但对 MCU 场景绰绰有余。

> 💡 对照记忆：裸机版是"main 循环 = tcpip_thread"；OS 版只是把这个循环搬进了独立的 FreeRTOS 任务，并加了邮箱收信口。收包链路也升级成两段接力：**中断喊信号量 → eth_thread 取包 → 邮箱投递 → tcpip_thread 解包**。

## 6. 应用程序：用户任务与协议栈共存

移植验证的实验结构（PDF 第 3.2.6 节 (PDF p.98)）：main 只做外设初始化和调 `freertos_demo()`；freertos_demo.c 先建 `start_task`（优先级 5）再启动调度器；start_task 里跑 `lwip_comm_init()` 初始化协议栈，成功后建两个任务：

```c
#define LWIP_DMEO_TASK_PRIO   11      /* lwIP 应用任务优先级 */
#define LWIP_DMEO_STK_SIZE    1024    /* lwIP 应用任务栈大小 */
#define LED_TASK_PRIO         10      /* LED 任务优先级 */
#define LED_STK_SIZE          128

taskENTER_CRITICAL();        /* 创建任务的过程不被打断 */

xTaskCreate((TaskFunction_t)lwip_demo_task, "lwip_demo_task",
            LWIP_DMEO_STK_SIZE, NULL, LWIP_DMEO_TASK_PRIO,
            &LWIP_Task_Handler);
xTaskCreate((TaskFunction_t)led_task, "led_task",
            LED_STK_SIZE, NULL, LED_TASK_PRIO, &LEDTask_Handler);

vTaskDelete(StartTask_Handler);   /* 删除开始任务 */
taskEXIT_CRITICAL();
```

注意优先级关系：tcpip_thread（5）< start_task（5 同优先级）< LED（10）< 应用任务（11）。**应用任务比协议栈任务优先级高**——这样应用调 API 时内核能及时响应（高优先级任务等信号量，内核任务被"追着"干活）。你在 FreeRTOS 课学的优先级调度，这里就是实战案例。

## 动手练习

### 练习 3.1：FreeRTOS 版移植 + ping 通

- 1️⃣ 在"你的 lwIP 实验工程"里：lwipopts.h 改 `NO_SYS=0` 并按第 2 节配置；添加 contrib 的 sys_arch.c/h；按第 3 节处理三个编译坑。
- 2️⃣ 按第 4 节改造 lwip_comm.c（tcpip_init + tcpip_input）、ethernetif.c（信号量 + eth_thread）、ethernet.c（if 判断 + 中断优先级 6）。
- 3️⃣ 配静态 IP：`lwip_comm_default_ip_set()` 改 `192.168.1.10`，`LWIP_DHCP=0`；电脑网卡 `192.168.1.2`，网线直连。
- 4️⃣ 按第 6 节搭 freertos_demo 任务骨架（start_task → lwip_demo_task + led_task），下载运行。
- ✅ **怎么做/观察什么**：LED 任务以 1s 周期翻转（证明 FreeRTOS 活着），电脑 `ping 192.168.1.10` 通（TTL=255）。用调试器/串口确认三个线程都在：tcpip_thread、eth_thread、你的应用任务。若 ping 不通：先看 ETH 中断优先级是否在 FreeRTOS 可接管范围（< configMAX_SYSCALL_INTERRUPT_PRIORITY），再看 eth_thread 是否因信号量没人释放而永远阻塞（断点打在 low_level_input 验证）。

### 练习 3.2：让用户任务与协议栈"同居"

- 1️⃣ 在 lwip_demo_task 里加一个自己的 TCP 客户端任务雏形：用 Netconn API 创建 netconn（`netconn_new(NETCONN_TCP)`），先不连服务器，每 1 秒打印一次状态，与 LED 任务并行运行。
- 2️⃣ 同时开着 ping（`ping -t 192.168.1.10`），观察连续 ping 的延迟波动。
- 3️⃣ 把 lwip_demo_task 优先级降到 3（低于 tcpip_thread），再看 ping 延迟。
- ✅ **怎么做/观察什么**：应用任务和协议栈任务互不阻塞（单线程内核 + 邮箱解耦的体现）；优先级实验会看到延迟抖动变大——高优先级应用任务频繁抢占 tcpip_thread，协议处理被挤到后面。这直观演示了"内核单线程"的调度敏感点，也是后面调优的伏笔。真机观察记录两种优先级下的平均/最大 ping 延迟。

## 自测

### 随堂小测 1

**Q1. FreeRTOS 没有邮箱机制，sys_arch.c 用什么模拟 lwIP 的邮箱？**

- 信号量加全局变量
- 存储 void 指针的消息队列
- 事件标志组

<details>
<summary>查看答案</summary>

B。xQueueCreate(size, sizeof(void*)) 创建装指针的队列，sys_mbox_post/trypost/fetch 封装队列收发（PDF p.150）。

</details>

**Q2. 带 OS 移植后，网卡收包到内核的完整链路是？**

- 中断直接调 ethernet_input 解包
- 中断释放信号量 → eth_thread 取包 → 邮箱投递 → tcpip_thread 解包
- 主循环轮询 DMA 描述符

<details>
<summary>查看答案</summary>

B。中断只 GiveFromISR 信号量；eth_thread 等信号量后 low_level_input 取包，再经 netif->input（tcpip_input）投进 tcpip_thread 邮箱（PDF p.94~96）。

</details>

**Q3. tcpip_thread 的作用与协议栈的并发模型是？**

- 多线程并发处理协议，靠互斥量保护
- 协议栈单线程运行，其他线程通过邮箱发消息给它
- 每个协议一个线程，用信号量调度

<details>
<summary>查看答案</summary>

B。tcpip_init 创建唯一的内核线程，TCPIP_MSG_INPKT 数据包消息和 TCPIP_MSG_API 请求都排队进它的邮箱（TCPIP_MBOX_SIZE=6），内核因此无需加锁（PDF p.91、p.97）。

</details>

**Q4. 中断里向邮箱发消息应使用哪个函数？**

- sys_mbox_post（永久阻塞）
- sys_mbox_trypost_fromisr（中断安全版）
- sys_arch_mbox_fetch（阻塞接收）

<details>
<summary>查看答案</summary>

B。trypost_fromisr 内部用 xQueueSendToBackFromISR，唤醒高优先级任务时返回 ERR_NEED_SCHED 让调用方触发切换（PDF p.151）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 3 章（PDF p.88~163）——重点 3.1~3.2 探索者部分和 3.5 sys_arch 文件解析，本课全部依据
- 📖 正点原子《FreeRTOS 开发指南》第 13、14 章——消息队列与信号量/互斥量的 FreeRTOS 侧知识
- 📂 lwIP 源码 `src/api/tcpip.c`——tcpip_thread 主体、tcpip_input 的邮箱消息构造
- 🌐 [lwIP 官网](https://savannah.nongnu.org/projects/lwip/)——contrib 包 `ports/freertos` 目录就是本课 sys_arch.c 的原产地

## 下一步

有不清楚的地方直接问我（Agent 就是你的老师）。下一课预告：第 4 课——钻进 lwIP 的内存管理（mem.c 内存堆 + memp.c 内存池），搞懂之前一直提到的 pbuf 到底从哪块内存"出生"。

| [← 上一课](/my-blog/posts/lwip/0002-baremetal-porting/) | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0004-memory-management/) |