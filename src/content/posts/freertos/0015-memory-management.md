---
title: 内存管理
published: 2026-08-26
description: FreeRTOS 课程第 15 课：heap_1~heap_5 五种堆算法的原理、取舍与选型，以及用 xPortGetFreeHeapSize 实时监控堆的实验。
tags: [FreeRTOS, 嵌入式, RTOS, 内存管理, heap]
category: FreeRTOS
draft: false
prevTitle: 空闲任务与低功耗 Tickless
prevSlug: "freertos/0016-idle-task-and-low-power"
nextTitle: 时间管理
nextSlug: "freertos/0014-time-management"
---

# 内存管理

这是 FreeRTOS 系列课程笔记的第 15 课：heap_1 到 heap_5 五种堆算法——原理、取舍与选型，为你的工程选对"粮仓"。**本课目标：**说清三件事：FreeRTOS 为什么不用标准 `malloc`；heap_1~heap_5 五种内存管理算法各适合什么场景；怎么用 `xPortGetFreeHeapSize()` 实时监控堆。学完你能给自己的工程选对堆算法，并能解释"申请 30 字节为什么实际扣了 40 字节"。

---

## 1. 内存管理简介：动态内存与那个"大数组"

FreeRTOS 创建任务、队列、信号量时，内存从哪来？两种方式：**动态方式**——由内核自动从自己管理的堆里申请，对象删除后自动释放；**静态方式**——用户自己提供栈空间和 TCB 内存（API 以 `Static` 结尾，如 `xTaskCreateStatic()`），用静态方式占用的内存即使对象被删也不会归还（PDF 20.1 节 PDF p.411）。

动态方式显然更灵活，那为什么不用 C 库自带的 `malloc()/free()`？教材总结了标准 C 库动态内存管理的几个缺点：

- 并不适用于所有嵌入式系统；
- 占用大量代码空间；
- **没有线程安全机制**——多任务并发申请时可能互相踩踏；
- **具有不确定性**——每次执行耗时不同，实时性无法保证。

所以 FreeRTOS 自己实现了内存管理，并作为移植层的一部分提供了 **5 种算法**，对应 5 个源文件：`heap_1.c` ~ `heap_5.c`。你工程里内存堆的大小由 `configTOTAL_HEAP_SIZE` 决定（教材实验配了 10KB），启用动态分配需把 `configSUPPORT_DYNAMIC_ALLOCATION` 置 1。

---

## 2. heap_1：只分配、不释放（最简单）

heap_1 是 5 种算法里最朴素的：从堆的**低地址向高地址**连续切块，一个 `xNextFreeByte` 指针记录已分配总量。它的 `vPortFree()` 函数体是空的——**申请的内存永远无法释放**（PDF 20.2.1 节 PDF p.412）。

听起来很废？但它有个非常契合现实的特点：**大多数嵌入式应用在启动时创建好所有任务/队列/信号量，之后再也不删**。这种场景 heap_1 完美胜任，而且：

- 具有确定性：每次分配耗时相同；
- 绝不产生内存碎片；
- 实现极简，代码量最小。

它管理的内存堆本质是一个大数组（教材代码原样）：

```c
/* heap_1.c 中的内存堆定义（heap_2/heap_4 同样如此） */
#if ( configAPPLICATION_ALLOCATED_HEAP == 1 )
    extern uint8_t ucHeap[ configTOTAL_HEAP_SIZE ];   /* 用户自定义堆的位置 */
#else
    static uint8_t ucHeap[ configTOTAL_HEAP_SIZE ];   /* 编译器分配的静态数组 */
#endif
```

注意 `configAPPLICATION_ALLOCATED_HEAP`：置 1 时堆的数组由你自己定义，可以放在指定地址（比如外部 SRAM）。heap_5 的多内存区本质就是这一思想的扩展。

---

## 3. heap_2：可释放，但碎片不合并

heap_2 引入"**内存块**"概念，支持释放。每个内存块是一个 `BlockLink_t` 结构体：一个指向下一块的指针 + 块大小，空闲块按**大小从小到大**串成一个单向链表（空闲块链表），分配时用"最适应算法"找到第一个大小合适的块，多余的再切回链表（PDF 20.2.2 节 PDF p.415）。

```c
/* heap_2 的内存块结构体 */
typedef struct A_BLOCK_LINK
{
    struct A_BLOCK_LINK * pxNextFreeBlock;  /* 指向下一个空闲内存块 */
    size_t                xBlockSize;       /* 内存块大小（含块头） */
} BlockLink_t;
```

但它有个致命短板：**释放内存时，相邻的空闲块不合并**。多次申请/释放不同大小内存后，堆会被切成许多互不相邻的小洞——明明空闲总量足够，却再也分配不出一块大内存，这就是**内存碎片**。教材明确警告：频繁创建/删除任务、或申请释放不固定大小内存的场景，慎用 heap_2。

---

## 4. heap_3：标准 malloc 的线程安全包装

heap_3 就是对你编译器自带的 `malloc()/free()` 包一层"挂起调度器"保护，保证同一时刻只有一个任务在调库函数，以此解决线程安全问题（PDF 20.2.3 节 PDF p.423）。

两个特殊点：

- 它的堆不是 `ucHeap` 数组，而是**链接器配置的堆**——在启动文件里改 `Heap_Size` 才能调整大小；此时 `configTOTAL_HEAP_SIZE` **无效**。
- C 库的 malloc 依然"不确定性"（耗时不定）、代码量大，所以一般只在特殊需求下才选它。

---

## 5. heap_4：首次适应 + 相邻块合并（最常用）

heap_4 是实际项目里**用得最多的算法**（教材内存管理实验就用它）。它同样用 `BlockLink_t` 管理块，但有两个关键升级（PDF 20.2.4 节 PDF p.425）：

- **按地址排序**：空闲块链表按物理地址从低到高排列，而不是按大小——这是能合并的前提；
- **相邻合并**：释放时若与前后空闲块地址相邻，直接合并成一个大块，碎片被"焊"回去；
- **占用位**：`xBlockSize` 的最高位（bit31）标记该块是否已分配，其余 31 位表示大小，所以单块最大 0x7FFFFFFF 字节。

分配用**首次适应算法**：从头遍历链表，找到第一个够大的空闲块就切分使用。相比 heap_2，即使频繁分配随机大小内存，碎片概率也小得多。所以"需要多次创建/删除任务、队列"的应用，选它基本没错。

---

## 6. heap_5：多内存区合并（外部 SRAM 神器）

heap_5 是 heap_4 的多内存区版本：**分配/释放/合并算法与 heap_4 完全相同**，区别只在初始化——它不自动建堆，要你手动把几块**不连续**的内存区域交给它统一管理（PDF 20.2.5 节 PDF p.437）。F407 探索者的外部 SRAM（FSMC 挂的 1MB 等）和片内 SRAM 就能凑成"一块大堆"。

```c
/* heap_5：内存区域信息结构体与初始化示例 */
typedef struct HeapRegion
{
    uint8_t * pucStartAddress;  /* 内存区域的起始地址 */
    size_t    xSizeInBytes;     /* 内存区域的大小（字节） */
} HeapRegion_t;

/* 注意：区域必须按起始地址从低到高排序，最后以 {NULL, 0} 结尾 */
const HeapRegion_t xHeapRegions[] =
{
    {(uint8_t *)0x20000000, 0x20000},   /* 片内 SRAM 区域（地址按你的工程改） */
    {(uint8_t *)0x68000000, 0x100000},  /* 外部 SRAM/FSMC 区域（举例） */
    {NULL, 0}                           /* 数组终止标志 */
};

int main(void)
{
    /* 必须在创建任何任务/队列之前调用，且只能调用一次 */
    vPortDefineHeapRegions(xHeapRegions);
    /* ... 之后正常创建任务、启动调度器 ... */
}
```

⚠️ 因为 heap_5 不会自动建堆，**不先调用 `vPortDefineHeapRegions()` 就创建任务会直接崩**。另外别用 C 的 `memset` 等函数在堆数组外面乱跑，堆边界由内核管理。

---

## 7. 五种算法选型对比表

| 算法 | 申请 | 释放 | 碎片合并 | 堆来源 | 典型场景 |
| --- | --- | --- | --- | --- | --- |
| heap_1 | ✅ 低地址往高切 | ❌ 不支持 | —（无碎片） | ucHeap 数组 | 启动建完所有对象、永不删除 |
| heap_2 | ✅ 最适应 | ✅ | ❌ 不合并 | ucHeap 数组 | 少量删除任务，大小固定（易碎片，慎用） |
| heap_3 | ✅ 包装 malloc | ✅ | 取决于编译器 | 启动文件 Heap_Size | 必须用 C 库堆的特殊场景 |
| heap_4 | ✅ 首次适应 | ✅ | ✅ 相邻合并 | ucHeap 数组 | **最常用**：频繁创建/删除对象 |
| heap_5 | ✅ 同 heap_4 | ✅ | ✅ 同 heap_4 | 多段指定地址 | 片内 + 外部 SRAM 合并成大堆 |

选型一句话：**默认 heap_4，绝不删对象可退 heap_1，内存不够用且板上有外扩 SRAM 就上 heap_5**。heap_2 和 heap_3 留作备选，心里有数即可。

---

## 8. 内存管理实验：用 xPortGetFreeHeapSize 看堆

教材实验 20 的玩法：按键 0 用 `pvPortMalloc(30)` 申请 30 字节并打印地址，按键 1 用 `vPortFree()` 释放，同时用 `xPortGetFreeHeapSize()` 在 LCD 上实时显示剩余堆大小。实验结果有个非常反直觉的细节（PDF 20.3.3 节 PDF p.444）：

> 申请 30 字节，剩余堆却少了 **40** 字节。原因：heap_4 的块头结构体占 8 字节（32 位系统），再加 `portBYTE_ALIGNMENT`（F4 上是 8）字节对齐，30 + 8 向上对齐到 8 的整数倍 = 40。所以"申请 N 字节"不等于"堆减少 N 字节"。

```c
/* 内存管理实验核心代码（教材实验 20，精简） */
void task1(void *pvParameters)
{
    uint8_t key  = 0;
    uint8_t *buf = NULL;
    size_t free_size = 0;

    while (1)
    {
        key = key_scan(0);
        switch (key)
        {
            case KEY0_PRES:                     /* 申请 30 字节并打印地址 */
                buf = pvPortMalloc(30);
                sprintf((char *)buf, "0x%p", buf);
                printf("malloc: %s\n", buf);
                break;
            case KEY1_PRES:                     /* 释放 */
                if (NULL != buf)
                {
                    vPortFree(buf);
                    buf = NULL;
                }
                break;
            default:
                break;
        }
        free_size = xPortGetFreeHeapSize();     /* 当前堆剩余字节数 */
        printf("heap free: %u / %u\n",
               (unsigned)free_size, (unsigned)configTOTAL_HEAP_SIZE);
        vTaskDelay(10);
    }
}
```

> 💡 养成好习惯：**申请和释放成对出现**。每次 `pvPortMalloc` 都要想清楚"谁、在哪、什么时候 free"。忘了释放就是内存泄漏——嵌入式产品最常见的慢性病之一（教材 p.446 专门叮嘱）。

> ⚠️ 切换堆算法 = 换源文件，别"配"错了地方：工程里 `portable/MemMang/` 目录下有 5 个 `heap_x.c`，**同一时间只能把其中一个加入编译**。加两个会重复定义 `pvPortMalloc`，编译直接报错；想换算法就移除旧的、加入新的，然后重新编译。

---

## 动手练习

### 练习 15.1：xPortGetFreeHeapSize 监控堆——看创建/删除任务的"出血量"

- 1️⃣ 在你的 FreeRTOS 分支工程里写一个监控任务：每 500ms 打印一次 `xPortGetFreeHeapSize()`，并在任务创建时先记录基线值。
- 2️⃣ 再写一个"破坏任务"：按一次按键就 `xTaskCreate` 一个 512 字栈的任务，再按一次 `vTaskDelete` 删掉它。
- **观察什么：**创建时堆掉多少？删除后堆恢复多少？若"恢复值 < 掉的值"，说明有泄漏——对照第 5 课学的 TCB 构成，估算一个任务该占多少内存，验证你的观察。
- 3️⃣ 把监控打印换成屏幕/串口显示，连续创建删除 50 次，确认堆大小稳定（用 heap_4 应该能保持）。

### 练习 15.2：切换 heap_4 → heap_2，对比碎片行为（简述即可）

- 1️⃣ 备份当前工程（或记录文件列表），把 `heap_4.c` 从编译里移除，加入 `heap_2.c`，重新编译。
- 2️⃣ 重复练习 15.1 的创建/删除操作（建议任务栈大小改得不一致，比如 256/384/512 轮换，加剧碎片）。
- 3️⃣ 记录 heap_2 下"剩余堆"随操作次数的变化曲线。**观察什么：**heap_2 的剩余量会呈现阶梯式下降（碎片累积），heap_4 则基本稳定——在笔记里用一句话总结两者差异。
- 4️⃣ 收尾：切回 heap_4，确认工程恢复原状。

---

## 自测

### 随堂小测 1

FreeRTOS 不直接使用标准 C 库 malloc 的主要原因不包括？

- A. C 库 malloc 没有线程安全机制
- B. C 库 malloc 每次执行耗时不确定
- C. C 库 malloc 申请的内存无法释放

<details>
<summary>查看答案</summary>

C。C 库 malloc 可以 free；它的问题是线程不安全、耗时不确定、代码量大、不普适（PDF p.411）。
</details>

### 随堂小测 2

heap_2 与 heap_4 最本质的区别是？

- A. heap_4 能合并物理地址相邻的空闲块，heap_2 不能
- B. heap_2 支持释放，heap_4 不支持
- C. heap_4 用栈管理内存，heap_2 用链表

<details>
<summary>查看答案</summary>

A。两者都支持申请/释放，但 heap_4 的空闲链表按地址排序并做相邻块合并，碎片更少（PDF p.425）。
</details>

### 随堂小测 3

heap_4 下申请 30 字节，堆实际减少 40 字节，原因组合是？

- A. 8 字节块头 + 8 字节对齐
- B. 4 字节块头 + 4 字节对齐
- C. 30 字节直接分配，另 10 字节是调试开销

<details>
<summary>查看答案</summary>

A。32 位系统 BlockLink_t 占 8 字节，加上 portBYTE_ALIGNMENT=8 对齐，30+8 对齐到 40（PDF p.444）。
</details>

### 随堂小测 4

想用 heap_5 管理片内 SRAM + 外部 SRAM 两块内存，必须做的事是？

- A. 定义 xHeapRegions 数组并先调用 vPortDefineHeapRegions()
- B. 在 FreeRTOSConfig.h 里把 configTOTAL_HEAP_SIZE 改成两倍
- C. 两个区域都要定义成 configAPPLICATION_ALLOCATED_HEAP

<details>
<summary>查看答案</summary>

A。heap_5 不会自动建堆，必须先按地址升序定义区域数组并调用 vPortDefineHeapRegions()（PDF p.437）。
</details>

---

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 20 章（PDF p.411~446）——五种算法源码逐段分析，本课依据
- 🌐 [FreeRTOS 官方文档：Heap Memory Management](https://www.freertos.org/a00111.html)——heap_1~heap_5 官方说明与对比
- 🌐 [Mastering the FreeRTOS Real Time Kernel](https://www.freertos.org/Documentation/RTOS_book.html)——官方书 Chapter 2 Heap Memory Management，讲透了"选堆"的工程思维

---

## 下一步

下一课预告：第 16 课——空闲任务与低功耗 Tickless。系统里那个"最闲的人"其实干着回收内存和睡大觉两件大事，本课教你让它睡得又快又省电。有任何不清楚的地方，直接问我（Agent 就是你的老师）。

| [← 上一课](/my-blog/posts/freertos/0014-time-management/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0016-idle-task-and-low-power/) |
| --- | --- | --- |