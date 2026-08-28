---
title: 列表与列表项
published: 2026-08-16
description: FreeRTOS 系列课程第 5 课（原理深入）：逐字段解剖 List_t / ListItem_t / MiniListItem_t 三个结构体，逐函数分析 vListInitialise / vListInsertEnd / vListInsert / uxListRemove 的指针操作，理解内核"为什么到处用列表"。
tags: [FreeRTOS, 嵌入式, RTOS, 列表, 列表项, 双向链表, 内核原理]
category: FreeRTOS
draft: false
prevTitle: 系统启动流程源码解析
prevSlug: "freertos/0006-scheduler-startup"
nextTitle: 任务 API 实战
nextSlug: "freertos/0004-task-api"
---

# 列表与列表项

这是 FreeRTOS 系列课程笔记的第 5 课：FreeRTOS 的"血管系统"——双向链表逐字段、逐函数解剖。**本课目标（原理深入课）：**这是理解 FreeRTOS 内核的第一块硬骨头。学完你能徒手写出 List_t / ListItem_t / MiniListItem_t 三个结构体，说清 vListInitialise / vListInitialiseItem / vListInsertEnd / vListInsert / uxListRemove 五个函数的每一步在改哪些指针，并真正理解"为什么内核到处用列表"。这是第 6 课读懂系统启动流程（就绪列表、延时列表）的必备前提。

## 1. 为什么内核到处用列表

FreeRTOS 源码里大量使用列表和列表项——它们就是数据结构里的**双向链表和节点**（PDF 第 7 章引言（PDF p.110））。想一想调度器要管理什么：几十个任务按优先级分档、按状态分组（就绪、阻塞、挂起）、按唤醒时间排序……这些"一堆东西的集合"，链表是增删都 O(1) 且内存碎片小的组织方式。

先看内核里的使用场景（预告，第 6 课会见到真身）：

- 📋 **就绪任务列表**：`pxReadyTasksLists[configMAX_PRIORITIES]`——每个优先级一条链表，调度器从高到低找"非空链表"取任务。
- ⏳ **阻塞/延时列表**：任务按唤醒时间（xItemValue）升序排队，时间到了就绪。
- 🗑️ **待删除任务列表**：`xTasksWaitingTermination`——被删任务先挂这里，等空闲任务收尸。
- 🔗 还有挂起列表、事件等待列表……

把任务挂进哪个列表，靠的就是 TCB 里那两个列表项 `xStateListItem` / `xEventListItem`。所以列表项有个 `pvOwner` 字段指向"拥有它的对象"（通常是任务控制块）——链表节点与任务之间互相指，形成双向链接（PDF p.111）。

## 2. List_t：列表（双向链表）逐字段

```c
/* list.h —— 列表结构体 */
typedef struct xLIST
{
    listFIRST_LIST_INTEGRITY_CHECK_VALUE   /* 校验值（默认不开启，用于检测数据破坏） */
    volatile UBaseType_t uxNumberOfItems;  /* 列表中列表项的个数（不包含 xListEnd） */
    ListItem_t *configLIST_VOLATILE pxIndex; /* 遍历指针：指向当前列表项，用于遍历 */
    MiniListItem_t xListEnd;               /* 列表末尾标记：一个迷你列表项 */
    listSECOND_LIST_INTEGRITY_CHECK_VALUE  /* 校验值 */
} List_t;
```

四个成员逐个说（PDF 第 7.1.1 节（PDF p.110））：

- 🔒 **两个校验宏**：存确定已知常量，运行中检测列表数据是否被踩坏，默认关闭（`configUSE_LIST_DATA_INTEGRITY_CHECK_BYTES`）。
- 🔢 **uxNumberOfItems**：列表项计数（不含哨兵 xListEnd）。插入 +1，移除 -1，`listCURRENT_LIST_LENGTH()` 读它。
- 👆 **pxIndex**：遍历指针。vListInsertEnd 插到它前面；uxListRemove 移除它指向的项时会回退。内核"轮询"列表时靠它走圈。
- 🏁 **xListEnd**：一个**迷你列表项**，值初始化为 `portMAX_DELAY`（最大），保证升序插入时它永远排最后；同时也作为"哨兵"节点挂载其他列表项。

⚠️ 注意 `xListEnd` 是**内嵌成员**不是指针——列表本身的"尾节点"就长在列表里，这也是空列表也能正常工作的原因。

## 3. ListItem_t 与 MiniListItem_t：列表项逐字段

```c
/* list.h —— 列表项结构体 */
struct xLIST_ITEM
{
    listFIRST_LIST_ITEM_INTEGRITY_CHECK_VALUE  /* 校验值 */
    configLIST_VOLATILE TickType_t xItemValue; /* 列表项的值：用于升序排序 */
    struct xLIST_ITEM *configLIST_VOLATILE pxNext;     /* 下一个列表项 */
    struct xLIST_ITEM *configLIST_VOLATILE pxPrevious; /* 上一个列表项 */
    void *pvOwner;      /* 列表项的拥有者：通常是任务控制块 */
    struct xLIST *configLIST_VOLATILE pxContainer;     /* 列表项所在列表 */
    listSECOND_LIST_ITEM_INTEGRITY_CHECK_VALUE /* 校验值 */
};
typedef struct xLIST_ITEM ListItem_t;

/* list.h —— 迷你列表项结构体 */
struct xMINI_LIST_ITEM
{
    listFIRST_LIST_ITEM_INTEGRITY_CHECK_VALUE
    configLIST_VOLATILE TickType_t xItemValue;  /* 值 */
    struct xLIST_ITEM *configLIST_VOLATILE pxNext;     /* 下一个 */
    struct xLIST_ITEM *configLIST_VOLATILE pxPrevious; /* 上一个 */
};
typedef struct xMINI_LIST_ITEM MiniListItem_t;
```

五个字段逐个说（PDF 第 7.1.2 节（PDF p.111））：

- 🔢 **xItemValue**：列表项的值。vListInsert 按它**升序**定位插入点；延时列表里它就是"唤醒时刻"。`listSET_LIST_ITEM_VALUE()` 设置。
- 🔗 **pxNext / pxPrevious**：前后邻居指针，双向链表的核心。摘链/插链全靠这两个指针的四步接线。
- 👤 **pvOwner**：指向拥有这个列表项的"对象"。对任务状态列表项来说就是 TCB——`listGET_LIST_ITEM_OWNER()` 取出后强转成 TCB 指针，就能拿到"这个链表节点代表哪个任务"。
- 📦 **pxContainer**：指向列表项所在的列表。一个列表项同一时刻只能属于一个列表，插入时登记、移除时清空；uxListRemove 靠它找到"老家"。

**迷你列表项 vs 完整列表项**（PDF 第 7.1.3 节（PDF p.112））：迷你版砍掉了 pvOwner 和 pxContainer，只保留值 + 前后指针。为什么能砍？因为 xListEnd 只当"哨兵"用——它不代表任何任务，也不需要知道自己属于哪个列表。少两个指针字段，每个列表省 8 字节，几十个列表下来也是真金白银。

> 💡 记忆锚点：**列表项是"节点的骨架"，pvOwner 是"节点承载的内容"**。内核的套路永远是：列表只管把节点串起来，取任务时用 pvOwner 反查 TCB。第 6 课你会看到 `listGET_OWNER_OF_HEAD_ENTRY()` 频繁出现，就是这套路。

## 4. 函数一、二：vListInitialise 与 vListInitialiseItem

列表和列表项定义后必须初始化才能用（PDF 第 7.2.1~7.2.2 节（PDF p.113~114））。

```c
/* list.c —— 初始化列表 */
void vListInitialise(List_t *const pxList)
{
    /* ① 初始化时列表中只有 xListEnd，遍历指针指向它 */
    pxList->pxIndex = (ListItem_t *)&(pxList->xListEnd);

    /* ② xListEnd 的值初始化为最大值，升序排序时永远排最后 */
    pxList->xListEnd.xItemValue = portMAX_DELAY;

    /* ③ 空列表：哨兵的前后指针都指向自己（循环链表） */
    pxList->xListEnd.pxNext = (ListItem_t *)&(pxList->xListEnd);
    pxList->xListEnd.pxPrevious = (ListItem_t *)&(pxList->xListEnd);

    /* ④ 列表项计数清零 */
    pxList->uxNumberOfItems = (UBaseType_t)0U;

    /* ⑤ 写入完整性校验值 */
    listSET_LIST_INTEGRITY_CHECK_1_VALUE(pxList);
    listSET_LIST_INTEGRITY_CHECK_2_VALUE(pxList);
}

/* list.c —— 初始化列表项 */
void vListInitialiseItem(ListItem_t *const pxItem)
{
    /* 列表项不属于任何列表 */
    pxItem->pxContainer = NULL;
    /* 写入校验值 */
    listSET_FIRST_LIST_ITEM_INTEGRITY_CHECK_VALUE(pxItem);
    listSET_SECOND_LIST_ITEM_INTEGRITY_CHECK_VALUE(pxItem);
}
```

逐行要点：vListInitialise 就干四件事——pxIndex 归位到哨兵、哨兵值拉满、哨兵自指成环、计数清零。**自指成环**是精髓：空列表时从 xListEnd 出发走一圈还是回到 xListEnd，遍历逻辑无需特判"空"；vListInitialiseItem 更简单，只清 pxContainer，保证它"不在任何列表里"。

## 5. 函数三：vListInsertEnd——插到 pxIndex 前面（无序插入）

把新列表项插到 **pxIndex 当前指向的列表项之前**，不做排序（PDF 第 7.2.3 节（PDF p.115））。注意：pxIndex 不一定指向 xListEnd，可能指向任意列表项。

```c
/* list.c —— 列表末尾插入列表项（"末尾"指 pxIndex 之前） */
void vListInsertEnd(List_t *const pxList, ListItem_t *const pxNewListItem)
{
    /* 记录插入点：pxIndex 指向的列表项 */
    ListItem_t *const pxIndex = pxList->pxIndex;

    /* 校验列表和列表项完整性（调试用） */
    listTEST_LIST_INTEGRITY(pxList);
    listTEST_LIST_ITEM_INTEGRITY(pxNewListItem);

    /* ① 新节点的两个指针先接线 */
    pxNewListItem->pxNext = pxIndex;              /* 新节点 → 插入点 */
    pxNewListItem->pxPrevious = pxIndex->pxPrevious; /* 新节点 → 插入点的前一个 */

    /* ② 插入点前一个节点回头指向新节点 */
    pxIndex->pxPrevious->pxNext = pxNewListItem;
    pxIndex->pxPrevious = pxNewListItem;          /* 插入点前驱换成新节点 */

    /* ③ 登记所属列表，计数加一 */
    pxNewListItem->pxContainer = pxList;
    (pxList->uxNumberOfItems)++;
}
```

逐行逻辑：先改新节点的两条出边，再改旧邻居的两条入边——四步接线，顺序不能乱（先接新节点再断旧链，保证中间态链表不断裂）。`pxContainer = pxList` 意味着"这个列表项现在属于 pxList 了"。为什么内核用这个"无序尾插"？典型场景：同优先级就绪任务的轮转——新就绪任务排到队尾，pxIndex 步进即可实现时间片轮换。

## 6. 函数四：vListInsert——按值升序插入（有序插入）

先找到插入位置，再接线（PDF 第 7.2.4 节（PDF p.116~117））。

```c
/* list.c —— 按 xItemValue 升序插入列表项 */
void vListInsert(List_t *const pxList, ListItem_t *const pxNewListItem)
{
    ListItem_t *pxIterator;
    const TickType_t xValueOfInsertion = pxNewListItem->xItemValue;

    listTEST_LIST_INTEGRITY(pxList);
    listTEST_LIST_ITEM_INTEGRITY(pxNewListItem);

    /* ① 特判：待插入值是最大值，直接放哨兵前面（即列表末尾） */
    if (xValueOfInsertion == portMAX_DELAY)
    {
        pxIterator = pxList->xListEnd.pxPrevious;
    }
    else
    {
        /* ② 从哨兵出发遍历，停在"下一个节点的值大于待插值"的位置 */
        for (pxIterator = (ListItem_t *)&(pxList->xListEnd);
             pxIterator->pxNext->xItemValue <= xValueOfInsertion;
             pxIterator = pxIterator->pxNext)
        {
        }
    }

    /* ③ 四步接线：插到 pxIterator 之后 */
    pxNewListItem->pxNext = pxIterator->pxNext;
    pxNewListItem->pxNext->pxPrevious = pxNewListItem;
    pxNewListItem->pxPrevious = pxIterator;
    pxIterator->pxNext = pxNewListItem;

    /* ④ 登记所属列表，计数加一 */
    pxNewListItem->pxContainer = pxList;
    (pxList->uxNumberOfItems)++;
}
```

逐行逻辑：特判 `portMAX_DELAY` 是性能优化——延时列表里"永不唤醒"的任务（值最大）不用遍历直接插末尾；遍历条件 `pxNext->xItemValue <= 待插值` 保证升序且稳定（相等值时新节点排在老节点后面）；最后的四步接线和 vListInsertEnd 同一套路。典型场景：延时列表按唤醒时刻排序、事件等待列表按优先级排序。

## 7. 函数五：uxListRemove——摘链

把列表项从它所在的列表里移除，返回剩余列表项数量（PDF 第 7.2.5 节（PDF p.118））。

```c
/* list.c —— 从列表中移除列表项 */
UBaseType_t uxListRemove(ListItem_t *const pxItemToRemove)
{
    /* ① 从列表项自己的 pxContainer 找回"老家"列表 */
    List_t *const pxList = pxItemToRemove->pxContainer;

    /* ② 摘链：让前后邻居互相指，绕过自己 */
    pxItemToRemove->pxNext->pxPrevious = pxItemToRemove->pxPrevious;
    pxItemToRemove->pxPrevious->pxNext = pxItemToRemove->pxNext;

    /* ③ 如果遍历指针正指向被移除项，回退到上一个列表项 */
    if (pxList->pxIndex == pxItemToRemove)
    {
        pxList->pxIndex = pxItemToRemove->pxPrevious;
    }

    /* ④ 清空所在列表标记，计数减一 */
    pxItemToRemove->pxContainer = NULL;
    (pxList->uxNumberOfItems)--;

    /* ⑤ 返回移除后列表中剩余列表项的数量 */
    return pxList->uxNumberOfItems;
}
```

逐行逻辑：移除动作本身只是两步——"后邻居的前驱改成我的前驱"、"前邻居的后继改成我的后继"，自己被彻底跳过；pxIndex 修正防止遍历指针悬空；最后 pxContainer 清空，表示"我不属于任何列表了"。返回值被内核用来判断列表是否空了（如判断该优先级是否还有就绪任务）。

> ⚠️ 两个易错点：① 移除后的列表项，其 pxNext/pxPrevious **仍残留指向链表**（单向的"幽灵链接"），内核靠 pxContainer 判断归属，所以移除后不能再用它遍历；② 列表操作函数**不是线程安全的**——内核只在临界区内调用它们。你自己的应用代码若要操作共享列表，也要用 taskENTER_CRITICAL 保护，否则任务切换会撕碎链表。

## 8. 宏速查 + 插入删除实验

list.h 里还有一批操作宏，本质是"给字段赋值/取值"的语法糖（PDF 第 7.3 节（PDF p.119））：

| 宏 | 作用 | 内核典型用法 |
|------|------|------|
| `listSET_LIST_ITEM_VALUE` | 设置列表项的值 | 延时列表写入唤醒时刻 |
| `listGET_LIST_ITEM_VALUE` | 读取列表项的值 | 判断延时是否到期 |
| `listSET_LIST_ITEM_OWNER` | 设置拥有者 | 任务入列时登记自己的 TCB |
| `listGET_OWNER_OF_HEAD_ENTRY` | 取队首的拥有者 | 调度器取"下一个要跑的任务" |
| `listGET_NEXT` | 取下一个列表项 | 轮转遍历 |
| `listLIST_IS_EMPTY` | 判断列表是否为空 | 查某个优先级是否有人排队 |
| `listREMOVE_ITEM` | 封装 uxListRemove | 任务出列 |

教材实验 7.4（PDF 第 7.4 节（PDF p.120~127））把上面的函数串起来：初始化 1 个列表 + 3 个列表项 → 逐个 vListInsert → uxListRemove 摘掉列表项 2 → vListInsertEnd 把它插回末尾，每步用串口打印所有节点的 `pxNext/pxPrevious` 地址验证顺序。

```c
/* 仿教材实验骨架：验证插入顺序 */
void task1(void *pvParameters)
{
    /* 第一步：初始化列表和三个列表项 */
    vListInitialise(&TestList);
    vListInitialiseItem(&ListItem1);
    vListInitialiseItem(&ListItem2);
    vListInitialiseItem(&ListItem3);

    /* 第二步：给列表项赋值后按升序插入 */
    listSET_LIST_ITEM_VALUE(&ListItem1, 3);
    listSET_LIST_ITEM_VALUE(&ListItem2, 1);
    listSET_LIST_ITEM_VALUE(&ListItem3, 2);
    vListInsert(&TestList, &ListItem1);
    vListInsert(&TestList, &ListItem2);
    vListInsert(&TestList, &ListItem3);
    /* 打印顺序应为：List2(1) → List3(2) → List1(3) */

    /* 第三步：移除列表项 2，链表变成 List3 → List1 */
    uxListRemove(&ListItem2);

    /* 第四步：把列表项 2 插到末尾（pxIndex 之前） */
    vListInsertEnd(&TestList, &ListItem2);
    /* 打印顺序应为：List3 → List1 → List2 */

    while (1)
    {
        vTaskDelay(10);
    }
}
```

教材下载验证里能看到一串地址（如 0x200000CC 的列表、0x200000D4 的 xListEnd、0x200000E0 起的三个列表项（PDF p.124~127））——xListEnd 恰好在列表结构体内偏移 8 字节处，pxIndex 初始化时指向它，插入后指针链与预期完全一致。地址会变，但**链接关系不变**。

## 动手练习（约 40 分钟）

### 练习 5.1：仿照教材写列表插入/删除验证代码

- 1️⃣ 在你的 FreeRTOS 分支工程里新建一个任务（优先级最低），内部定义 `List_t TestList` 和三个 `ListItem_t`，包含 `list.h` 后完成：初始化 → 赋不同值（3/1/2）→ 依次 vListInsert → 打印链表顺序。
- 2️⃣ 手动实现一个打印函数：从 `TestList.pxIndex` 出发，循环 `listGET_NEXT()` 走到 xListEnd，打印每个节点的 xItemValue 和地址（用 printf "%p"）。
- 3️⃣ 再执行 uxListRemove(&ListItem2) 和 vListInsertEnd(&TestList, &ListItem2)，每步打印对比。
- **观察什么：**升序插入后打印 1→2→3（按值）；移除 2 后 1→3；末尾插入后 1→3→2。对照教材 PDF p.124~127 的地址打印结果，确认你的链表链接关系与教材一致。改一改插入顺序（先插大值再插小值），验证升序逻辑与插入顺序无关。

### 练习 5.2：思考——为什么内核到处用列表

- 1️⃣ 在 FreeRTOS 内核源码里用搜索工具搜 `pxReadyTasksLists` 和 `xTasksWaitingTermination`、`xDelayedTaskList1`，数一数它们被哪些函数引用（建议直接读 tasks.c）。
- 2️⃣ 在 tasks.c 里看 `prvInitialiseTaskLists()`：它对每个优先级调用 vListInitialise——想想为什么就绪列表是"优先级数"条，而不是一条。
- **观察什么：**就绪/阻塞/挂起任务全部由列表组织：同优先级任务在一条就绪链上轮转（vListInsertEnd + pxIndex 步进），延时任务按唤醒时刻升序排队（vListInsert），删除的任务在等待终止列表里排队等空闲任务回收（uxListRemove + 空闲任务循环）。你还能顺便预习第 6 课启动流程的骨架——列表就是调度器的"收纳盒"。

## 自测（答完再点答案）

### 随堂小测 1

Q1. 列表结构体中 xListEnd 成员是什么类型？

- A. 完整的 ListItem_t 列表项
- B. MiniListItem_t 迷你列表项
- C. 指向 ListItem_t 的指针

<details>
<summary>查看答案</summary>

B。xListEnd 是迷你列表项（哨兵），值初始化为 portMAX_DELAY，标记列表末尾（PDF p.110）。

</details>

### 随堂小测 2

Q2. vListInsert 按什么规则决定插入位置？

- A. 按 xItemValue 升序排列插入
- B. 按 pvOwner 地址大小插入
- C. 总是插到列表的最前面

<details>
<summary>查看答案</summary>

A。vListInsert 遍历列表，把新列表项按 xItemValue 升序插到合适位置（PDF p.116）。

</details>

### 随堂小测 3

Q3. uxListRemove 的返回值是什么？

- A. 被移除列表项的值
- B. 移除后列表中剩余列表项的数量
- C. 被移除列表项的地址

<details>
<summary>查看答案</summary>

B。函数返回移除后列表中列表项的数量（uxNumberOfItems），内核据此判断列表是否为空（PDF p.118）。

</details>

### 随堂小测 4

Q4. 列表项 pvOwner 字段指向的对象通常是？

- A. 列表项所在的列表
- B. 拥有该列表项的任务控制块
- C. 下一个列表项

<details>
<summary>查看答案</summary>

B。pvOwner 指向包含该列表项的对象（通常是 TCB），使列表项与对象双向链接（PDF p.111）。

</details>

## 推荐阅读

- 📖 正点原子《FreeRTOS 开发指南 V1.12》第 7 章（PDF p.110~128）——本课全部依据，含实验完整源码与地址打印结果
- 🌐 [FreeRTOS 内核官方仓库（GitHub）](https://github.com/FreeRTOS/FreeRTOS-Kernel)——list.h / list.c 完整源码，对照本课逐行读
- 🌐 [Mastering the FreeRTOS™ Real Time Kernel](https://www.freertos.org/Documentation/RTOS_book.html)——第 3 章就绪列表的组织方式可对照理解
- 📖 同书第 8 章（PDF p.129 起）——下一课预告：启动流程里 pxReadyTasksLists 的真身

## 下一步

列表是内核的"血管"，现在你摸清了每一条血管的走线。下一课顺着血流看心脏：系统启动流程——调度器怎么初始化这些列表、第一个任务怎么跑起来的。啃完这块，FreeRTOS 对你就不再是黑盒了。有问题随时丢给我！

| [← 上一课](/my-blog/posts/freertos/0004-task-api/) | [课程目录](/my-blog/posts/freertos/00-总览/) | [下一课 →](/my-blog/posts/freertos/0006-scheduler-startup/) |