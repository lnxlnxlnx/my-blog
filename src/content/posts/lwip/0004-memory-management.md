---
title: 内存管理
published: 2026-08-17
description: mem.c 动态内存堆（首次适应算法）、memp.c 动态内存池（宏展开）、C 库策略、三方案选型。
tags: [lwIP, 嵌入式, 内存管理]
category: lwIP
draft: false
prevTitle: 网络接口与数据包
prevSlug: "lwip/0005-netif-and-pbuf"
nextTitle: FreeRTOS 移植
nextSlug: "lwip/0003-freertos-porting"
---

# 内存管理

> mem.c 动态内存堆（首次适应算法）、memp.c 动态内存池（宏展开）、C 库策略、三方案选型

**本课目标：**钻到 lwIP 的"心脏仓库"里看看它怎么管内存。学完你能说清：内存堆和内存池各解决什么问题、`struct mem` 怎么用索引串起整块堆、首次适应算法怎么分配和标记、内存池怎么靠一个宏展开出几十个固定大小的池、三个管理策略怎么选。之前移植时看到的 `MEM_SIZE`、`PBUF_POOL_SIZE`、`pbuf_alloc(PBUF_RAW, len, PBUF_POOL)`——这课全部对号入座。

## 1. 内存简介：嵌入式内存管理的两难

lwIP 内核运行时到处都在"借内存"：每个收进来的包要一块 pbuf、每个 TCP 连接要一块 PCB 控制块、每个待发段要一块 TCP_SEG……（PDF 第 4.1 节 (PDF p.164)）。lwIP 提供两种互补的策略：

- 🧱 **动态内存池（memp）**：预先切好一堆固定大小的块，申请/释放都是 O(1) 链表操作，快且无碎片；缺点是块大小固定，有浪费
- 📦 **动态内存堆（mem）**：一整块大数组按需切分，灵活；缺点是会产生碎片、查找慢

用哪个策略由三个宏决定（表 4.1.1）：

| 宏定义 | 含义 |
|--------|------|
| `MEM_LIBC_MALLOC` | 是否用 C 标准库分配策略（默认 0，用 lwIP 自己的堆） |
| `MEMP_MEM_MALLOC` | 是否用 lwIP 内存堆来实现内存池（默认 0，池用独立数组） |
| `MEM_USE_POOLS` | 是否用 lwIP 内存池来实现内存堆（默认 0） |

> ⚠️ 硬规则：**lwIP 内存堆策略和 C 库策略只能二选一**（教材原文强调，(PDF p.164)）。别同时把 MEM_LIBC_MALLOC 和 lwIP 堆都打开，编译期就混乱了。

## 2. 动态内存堆：mem.c 的"大仓库"

### 2.1 内存块结构体：用索引串起链表

整个堆就是一块大数组 `ram_heap`，被切成一段段"内存块"，每块头部带一个管理结构（(PDF p.165)）：

```c
struct mem {
  mem_size_t next;    /* 保存下一个内存块的索引（不是指针！） */
  mem_size_t prev;    /* 保存前一个内存块的索引 */
  u8_t used;          /* 此内存块是否被使用：1 使用、0 未使用 */
};
```

注意 `next`/`prev` 存的是**相对堆首的字节索引**而非地址——好处是链表"搬家"也不失效，且省内存。配套几个对齐宏：`MIN_SIZE=12`（小于它的申请一律按 12 字节给，防止碎成渣）、`SIZEOF_STRUCT_MEM`（块头大小对齐）、`MEM_SIZE_ALIGNED`（堆大小对齐），全部经 `LWIP_MEM_ALIGN_SIZE` 按 `MEM_ALIGNMENT=4` 对齐。

### 2.2 三个"游标"指针

```c
static u8_t *ram;                    /* 指向对齐后的内存堆首地址 */
static struct mem *ram_end;          /* 指向内存堆最后一个内存块 */
static struct mem *lfree;            /* 指向最低地址的那个空闲内存块 */
```

堆空间 = `MEM_SIZE_ALIGNED + 2*SIZEOF_STRUCT_MEM`（首尾各留一个块头）。`ram_end` 是"哨兵"（永远 used=1，表示堆的尽头），`lfree` 是分配的起点——始终指向索引最小的空闲块。

`mem_init()` 干的事（(PDF p.166)）：把首块建好（prev=0、used=0、next=MEM_SIZE_ALIGNED），尾块 ram_end 标记 used=1，lfree 指向首块，最后创建一个互斥量 `mem_mutex` 保护整个堆（有 OS 时 malloc/free 会被互斥量串行化）。

### 2.3 mem_malloc：首次适应 + 现场划分

算法名字叫 **First Fit（首次拟合）**：从 `lfree`（低地址）出发，沿 `next` 索引依次找，第一个"剩余空间够大"的空闲块就直接切（(PDF p.167)）：

```c
void *
mem_malloc(mem_size_t size_in)
{
  mem_size_t ptr, ptr2, size;
  struct mem *mem, *mem2;

  /* ……校验、对齐 size…… */

  /* 从最低的空闲块 lfree 开始，沿 next 索引寻找足够大的空闲块 */
  for (ptr = mem_to_ptr(lfree); ptr < MEM_SIZE_ALIGNED - size;
       ptr = ((struct mem *)(void *)&ram[ptr])->next)
  {
    mem = ptr_to_mem(ptr);              /* 取它的地址 */
    /* 空间大小必须排除内存块头大小 */
    if ((!mem->used) &&
        (mem->next - (ptr + SIZEOF_STRUCT_MEM)) >= size)
    {
      /* 剩余空间够再放一个新块头 + MIN_SIZE 才拆分，
         否则整块给用户（会产生一点碎片，但避免无法管理的碎块） */
      if (mem->next - (ptr + SIZEOF_STRUCT_MEM) >= (size +
           SIZEOF_STRUCT_MEM + MIN_SIZE_ALIGNED))
      {
        /* 在用户空间的后面插入一个新的空闲内存块 mem2 */
        ptr2 = (mem_size_t)(ptr + SIZEOF_STRUCT_MEM + size);
        mem2 = ptr_to_mem(ptr2);
        mem2->used = 0;
        mem2->next = mem->next;
        mem2->prev = ptr;
        mem->next = ptr2;
        mem->used = 1;                  /* 当前块标记为已使用 */
        if (mem2->next != MEM_SIZE_ALIGNED)
        {
            ((struct mem *)(void *)&ram[mem2->next])->prev = ptr2;
        }
      }
      else                              /* 剩余太小：整块给出（碎片） */
      {
        mem->used = 1;
      }
      /* 若分配出去的正是 lfree 指向的块，就把 lfree 往后挪到下一个空闲块 */
      if (mem == lfree)
      {
        struct mem *cur = lfree;
        while (cur->used && cur != ram_end)
        {
          cur = ptr_to_mem(cur->next);
        }
        lfree = cur;
      }
      /* 返回用户空间地址（跳过块头） */
      return (u8_t *)mem + SIZEOF_STRUCT_MEM + MEM_SANITY_OFFSET;
    }
  }
  return NULL;                          /* 没找到合适的块 */
}
```

这个函数把分配过程讲透了：**先找（首次适应）、再切（拆出新空闲块）、后挪（维护 lfree）**。教材特别点出"剩余空间连一个块头都放不下"的判断——如果强拆，会产生无法再分配的碎块，所以宁可整块给用户。

### 2.4 mem_free：三步归还

释放极简（(PDF p.170)）：

```c
void
mem_free(void *rmem)
{
  struct mem *mem;
  if (rmem == NULL)         /* 空指针直接返回 */
  {
    return;
  }
  /* 从用户地址回退一个块头，找到控制块 */
  mem = (struct mem *)(void *)((u8_t *)rmem - (SIZEOF_STRUCT_MEM +
                                              MEM_SANITY_OFFSET));
  mem->used = 0;            /* 标记为未使用 */
  /* 若释放的块比 lfree 更靠前，更新 lfree（始终指向最低地址空闲块） */
  if (mem < lfree)
  {
    lfree = mem;
  }
}
```

关于**合并逻辑**：教材在与 C 库对比时明确说，lwIP 内存堆策略"可以合并相邻的空闲内存块，减少内存碎片化，提高内存利用率"（(PDF p.180)）——这也是它优于裸 malloc 的关键点。对比记忆：C 库的 malloc/free 不会把相邻空闲块拼回一个大块，反复申请释放后堆会被"碎尸万段"。

> 💡 形象记忆：堆像一列火车车厢（块），每节车厢门牌号是索引（next/prev），乘务员 `lfree` 永远站在"最靠前的空车厢"门口。分配=从门口上车切座位，释放=座位变空并把乘务员往前拉。lwIP 用索引不用指针，这列火车还能"整列平移"都不乱。

## 3. 动态内存池：memp.c 的"预制件仓库"

### 3.1 思路与场景

很多数据结构**大小固定、生命周期短、申请频繁**（TCP_PCB、UDP_PCB、TCP_SEG、pbuf……）。给它们跑堆分配既慢又容易碎。内存池的做法（(PDF p.171)）：初始化时把一整块内存切成 `num` 个固定大小的块，用单链表串好；申请 = 从链表头取一个，释放 = 放回链表头。缺点：块大小固定，用不满就浪费。

### 3.2 四个文件的"宏交响曲"

池的实现分布在四个文件，靠宏展开生成所有代码（(PDF p.171~172)）：

- `memp_std.h`：声明"有哪些池"——按协议开关宏列举，例如 `LWIP_MEMPOOL(TCP_PCB, MEMP_NUM_TCP_PCB, sizeof(struct tcp_pcb), "TCP_PCB")`，只有 `LWIP_TCP=1` 时 TCP 相关的池才被收录
- `memp_priv.h`：两个管理结构体——`struct memp { struct memp *next; }`（空闲块串链）和 `struct memp_desc { u16_t size; u16_t num; u8_t *base; struct memp **tab; }`（描述一类池：块大小、块数、基地址、空闲链头）
- `memp.h`：用 `##` 连接符把每个池名变成枚举成员 `MEMP_##name`，得到 `memp_t` 枚举和总数 `MEMP_MAX`
- `memp.c`：用 `LWIP_MEMPOOL_DECLARE` 宏为每个池展开出一个对齐数组 + `memp_desc` 结构体，并实现 init / malloc / free

`LWIP_MEMPOOL_DECLARE` 展开后大致长这样（(PDF p.174)）：

```c
/* 以 LWIP_MEMPOOL_DECLARE(RAW_PCB, 4, 20, "RAW_PCB") 为例展开 */
u8_t memp_memory_RAW_PCB_base[4 * (MEMP_SIZE + 20对齐后)]; /* 池的存储数组 */
static struct memp *memp_tab_RAW_PCB;                      /* 空闲链头 */
const struct memp_desc memp_RAW_PCB = {
  20,                        /* 每个内存块大小 */
  4,                         /* 内存块数量 */
  memp_memory_RAW_PCB_base,  /* 基地址 */
  &memp_tab_RAW_PCB          /* 指向空闲链头 */
};
```

所有池的描述符再汇总成一个数组 `memp_pools[MEMP_MAX]`，索引正好对应枚举 `memp_t`。

### 3.3 初始化 / 申请 / 释放

初始化就是把空闲块串成链表（(PDF p.176)）：

```c
void memp_init_pool(const struct memp_desc *desc)
{
  int i;
  struct memp *memp;
  *desc->tab = NULL;                       /* 空闲链头先置空 */
  memp = (struct memp *)LWIP_MEM_ALIGN(desc->base);   /* 内存对齐 */
  /* 把该池所有内存块按固定步长串成单链表 */
  for (i = 0; i < desc->num; ++i)
  {
    memp->next = *desc->tab;
    *desc->tab = memp;
    memp = (struct memp *)(void *)((u8_t *)memp + MEMP_SIZE + desc->size);
  }
}
```

申请和释放更是"两头操作链表"（(PDF p.177~178)）：

```c
/* 申请：从链头取一个块 */
static void *
do_memp_malloc_pool(const struct memp_desc *desc)
{
  struct memp *memp;
  memp = *desc->tab;                       /* 取空闲链头 */
  if (memp != NULL)
  {
    *desc->tab = memp->next;               /* 链头后移 */
    return ((u8_t *)memp + MEMP_SIZE);     /* 返回跳过管理头的用户空间 */
  }
  return NULL;                             /* 池耗尽，返回 NULL */
}

/* 释放：把块放回链头 */
static void
do_memp_free_pool(const struct memp_desc *desc, void *mem)
{
  struct memp *memp;
  memp = (struct memp *)(void *)((u8_t *)mem - MEMP_SIZE); /* 找回管理头 */
  memp->next = *desc->tab;                 /* 新块插到链头 */
  *desc->tab = memp;
}
```

池耗尽时 `memp_malloc` 返回 NULL——还记得第 2 课 `low_level_input` 里 pbuf 申请失败就 `LINK_STATS_INC(link.memerr)` 丢包吗？就是这里池不够了。

## 4. 使用 C 库管理策略：一个"省事但不建议"的选项

把 `MEM_LIBC_MALLOC=1`，lwIP 的 `mem_malloc`/`mem_free` 就变成 C 库 `malloc`/`free` 的薄封装（(PDF p.178)）：

```c
/* mem.c 中可被覆盖的 C 库函数别名 */
#ifndef mem_clib_free
#define mem_clib_free        free
#endif
#ifndef mem_clib_malloc
#define mem_clib_malloc      malloc
#endif
#ifndef mem_clib_calloc
#define mem_clib_calloc      calloc
#endif
```

为什么教材说"不建议"？两条硬伤（(PDF p.180)）：

- ❌ C 库**不能合并相邻的空闲内存块**，反复申请释放后碎片化严重
- ❌ C 库分配器体积大、行为不可控（有的还要求堆初始化配置），嵌入式场景难把握

而且它和 lwIP 内存堆**只能二选一**。所以默认配置（三个宏全 0）就是"lwIP 自己的堆 + 自己的池"的组合拳。

## 5. 三方案对比选型

| 策略 | 速度 | 碎片 | 适用场景 | 代表用途 |
|------|------|------|----------|----------|
| 动态内存池 memp | ⚡ 快（链表头 O(1)） | 无碎片（固定大小） | 大小固定、频繁申请的数据结构 | pbuf、TCP_PCB、TCP_SEG、API 消息 |
| 动态内存堆 mem | 🐢 慢（首次适应查找） | 有碎片（但可合并相邻块） | 大小可变、偶尔申请的大块数据 | 大缓冲区、用户自定义数据 |
| C 库 malloc | 取决于实现 | 碎片严重（不合并） | 基本不推荐 | —— |

选型口诀：**固定小件用池，可变大块用堆，C 库靠边站**。这也是 `pbuf_alloc` 分 `PBUF_POOL`（池，快）和 `PBUF_RAM`（堆，可大）两种来源的底层原因——第 6 课讲 pbuf 时你会回来再看这张表。

> ⚠️ 调参指南：堆不够用改 `MEM_SIZE`，池不够用改 `MEMP_NUM_XXX` / `PBUF_POOL_SIZE`；改完记得看 `LWIP_STATS=1` 时的统计输出，别拍脑袋。内存对齐 `MEM_ALIGNMENT` 别乱动，4 字节对齐是 Cortex-M 的基本盘。

## 动手练习

### 练习 4.1：解剖你工程里的 mem.c / memp.c

- 1️⃣ 在"你的 lwIP 实验工程"里打开 `src/core/mem.c` 和 `src/core/memp.c`（以及 `src/include/lwip/priv/memp_std.h`）。
- 2️⃣ 用搜索定位：`struct mem`、`mem_init`、`mem_malloc`、`mem_free`、`memp_init_pool`、`do_memp_malloc_pool`、`do_memp_free_pool`，对照本课贴出的代码逐行读。
- 3️⃣ 在 `memp_std.h` 里数一数你的工程编译出了多少个池，对照 lwipopts.h 里的 `MEMP_NUM_*` 宏验证数量来源。
- ✅ **怎么做/观察什么**：把 `mem_malloc` 的 for 循环和 `do_memp_malloc_pool` 的链表头操作各画一张小图（块/索引/指针关系），画完你就真正"见过"这两种算法了。能说出你的工程里 pbuf 池和 TCP_SEG 池各自的数量配置即达标。

### 练习 4.2：改 MEM_SIZE 与 PBUF_POOL_SIZE，观察系统反应

- 1️⃣ 把 `MEM_SIZE` 从 10*1024 改到 40*1024，编译对比 .map 文件里 RAM 占用变化，下载后 ping 验证功能不受影响。
- 2️⃣ 把 `PBUF_POOL_SIZE` 从 8 改到 2，电脑上 `ping -l 1400 192.168.1.10` 发大包，观察丢包。
- 3️⃣ （可选）把 `LWIP_STATS` 打开，串口观察 mem/memp 统计。
- ✅ **怎么做/观察什么**：MEM_SIZE 变大 → RAM 占用明显上涨（堆是静态数组，编译期就占好位置）；PBUF_POOL_SIZE=2 时大包 ping 丢包率飙升——接收时 `pbuf_alloc(PBUF_RAW, len, PBUF_POOL)` 申请不到池块直接丢帧（对应 low_level_input 的 memerr 路径）。做完把两个参数改回原值，并在记录里写下"改哪个参数、系统有什么反应"。

## 自测

### 随堂小测 1

**Q1. 内存堆结构体 struct mem 的 next/prev 成员保存的是什么？**

- 相邻内存块的指针地址
- 相对堆首的字节索引
- 内存块的使用计数

<details>
<summary>查看答案</summary>

B。next/prev 保存的是内存块在 ram_heap 中的字节索引，配合 ptr_to_mem/mem_to_ptr 换算地址（PDF p.165、p.167）。

</details>

**Q2. lwIP 内存堆的 First Fit 分配算法，特点是？**

- 从高地址开始找最大的空闲块
- 从低地址找第一个足够大的空闲块并切分
- 每次都把堆平均切成两半

<details>
<summary>查看答案</summary>

B。lfree 指向最低地址空闲块，从它开始沿 next 找第一个"剩余够大"的块；优点保留高地址大块，缺点产生小碎片（PDF p.164、p.167）。

</details>

**Q3. 内存池申请失败时（池耗尽），memp_malloc 返回什么？**

- 0，表示分配成功
- NULL，调用方需自行丢包处理
- 自动转向内存堆继续分配

<details>
<summary>查看答案</summary>

B。do_memp_malloc_pool 取不到空闲块返回 NULL，例如 low_level_input 里 pbuf 申请失败就丢包并统计 memerr（PDF p.177，结合 PDF p.60）。

</details>

**Q4. 以下哪个是教材不建议使用 C 库 malloc 管理 lwIP 内存的原因？**

- C 库分配速度太快，容易造成缓冲区溢出
- C 库不能合并相邻空闲块，碎片化严重
- C 库不支持 4 字节对齐

<details>
<summary>查看答案</summary>

B。C 标准库管理策略不能合并相邻的空闲内存块，易碎片化；而 lwIP 堆策略可以合并，且 MEM_LIBC_MALLOC 与 lwIP 堆只能二选一（PDF p.180）。

</details>

## 推荐阅读

- 📖 正点原子《lwIP 开发指南 V1.7》第 4 章（PDF p.164~180）——本课全部依据
- 📂 lwIP 源码 `src/core/mem.c`、`src/core/memp.c`、`src/include/lwip/priv/memp_std.h`——对照阅读的最佳教材
- 📕 STM32F407 参考手册内存章节——MCU 内存布局与对齐要求的背景知识
- 🌐 [lwIP 官网](https://savannah.nongnu.org/projects/lwip/)——lwIP 2.1.3 源码与文档下载

## 下一步

有不清楚的地方直接问我（Agent 就是你的老师）。下一课预告：第 5 课——网络接口管理（netif 结构体与多网卡链表）和数据包结构 pbuf，把"网卡怎么抽象、数据怎么装"这两块拼图补上，内核的面貌就基本完整了。

| [← 上一课](/my-blog/posts/lwip/0003-freertos-porting/) | [课程目录](/my-blog/posts/lwip/00-总览/) | [下一课 →](/my-blog/posts/lwip/0005-netif-and-pbuf/) |