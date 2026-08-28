---
title: GIF 格式与 LZW 解码
published: 2026-08-23
description: GIF 是动图鼻祖，它的 LZW 压缩妙在"字典临时现建、文件里一个字都不存"。本课讲清 GIF 文件结构、LZW 的 clear/end code 与码宽动态增长、解码器三个核心函数，并与 LVGL lv_gif 衔接。
tags: [Toolbox, 嵌入式, STM32, GIF, LZW]
category: Toolbox
draft: false
prevTitle: CAN 入门：物理层与特点
prevSlug: "toolbox/0016-can-basics"
nextTitle: JPEG 原理：霍夫曼与文件结构
nextSlug: "toolbox/0014-jpeg-principles-huffman"
---

# GIF 格式与 LZW 解码

256 色 + 字典压缩：一本"边读边抄"的密码本是怎么工作的（依据：Andrew S. Downs《Implementing a GIF Decoder》）

**本课目标：**GIF 是动图鼻祖，它的压缩算法 LZW（Lempel-Ziv-Welch）有个神奇特点——**压缩和解压用的字典是"临时现建"的，文件里一个字都不存**。学完你能：读 GIF 的文件结构（头/描述符/色表/图像数据/扩展块）、讲清 LZW 的 clear/end code 与码宽动态增长、理解解码器的 InitializeDictionary / ReadCode / OutputCode 三个函数，并手推一个小字典。（预计 45~50 分钟）

## 1. GIF 概述：出生 40 年还在线的老将

GIF（Graphics Interchange Format，图形交换格式）由 CompuServe 于 1987 年发布。文件开头 6 个字节直接自报家门（文章 "Header" 节）：

```text
// 结构体视角 (C 风格)
struct Header { Byte signature[3]; Byte version[3]; };
    signature = 'G' 'I' 'F'
    version   = '87a' 或 '89a'        // 87a 基础版, 89a 加了扩展块

// 例子: 49 46 46 38 39 61   == "GIF89a"
```

两大先天限制决定了它的"性格"：**最多 256 色**（调色板索引，最大 2^8）、用 **LZW** 做无损压缩。所以它不适合照片，但适合图标、插画、动图——而 LZW 恰恰是全篇核心。

> 💡 **一段历史课：**LZW 算法被 Unisys 申请了专利（US 4,558,302），GIF 火了几年后 Unisys 开始收许可费，闹得满城风雨，直接催生了免费的 PNG。专利 2003 年（美国）/2004 年（海外）到期，现在用 GIF 没有专利风险了（文章 "The patent" 节）。

## 2. 文件结构：头、描述符、色表、图像数据、扩展块

```text
偏移 0
  "GIF87a" / "GIF89a"                // 6 字节头
  逻辑屏幕描述符 (7 字节)             // 屏幕宽/高 + 标志 + 背景色 + 像素宽高比
  全局色表 (2^N × 3 字节 RGB)         // 最多 256 项, 每项 R,G,B
  ┌──► 0x2C 图像描述符               // 左上角坐标 + 图像宽/高 + 标志
  │     局部色表 (可选)               // 本图私用, 优先于全局表
  │     LZW 最小码宽 (1 字节)         // 如 8 = 每像素 8 位索引
  │     图像数据子块 (子块流, 0x00 结束) // 每子块: 1 长度字节 + 数据
  │  0x21 扩展块 (89a 新增)           // 图形控制/注释/应用...
  └── 循环 ...
  0x3B Trailer                       // 文件结束
```

逻辑屏幕描述符和图像描述符里的标志字节（bitField）按位用：**bit7=0x80** 表示"后面跟色表"（全局或局部），**低 3 位 N** 决定色表大小 = **2^(N+1)** 项（文章 "File format"/"Image Header" 节）。图像描述符的 **bit6=0x40** 是隔行扫描标志：

- **隔行（interlaced）**：数据分 4 趟下传——第 1 趟行 0,8,16…，第 2 趟行 4,12,20…，第 3 趟行 2,6,10…，第 4 趟行 1,3,5…（间隔 8/8/4/2，文章 "Interlacing" 节）。解码后要重排（Normalize）回逐行顺序
- **扩展块（0x21 + 标签）**：89a 引入，支持文字叠加、动画帧、应用专用数据（如 `0xF9` 图形控制扩展控制帧延时与透明色、`0xFF` 应用扩展写循环次数）——动画的秘密就藏在这里

图像数据子块的读法是：读 1 字节长度 `count`，再读 `count` 字节，直到遇到长度 0 结束（文章 Listing 4 末尾）。

## 3. LZW 压缩原理：边读边抄的密码本

LZW 的思路：把重复出现的"颜色序列"登记进一本字典，给每个序列一个编号（码字 code），输出码字代替长序列。而**字典不随文件发送**——编码器读原始数据时建字典，解码器读码流时**重建一模一样的字典**（文章 "Introduction" 节）。

```text
# 初始 (LZW 最小码宽 = size, 常见 8)
根节点   : 0 .. 2^size − 1          // 直接是调色板的颜色
clear 码 : 2^size                   // 清除码: 重建字典
end   码 : 2^size + 1               // 结束码: 数据流终止
新码起点 : 2^size + 2               // 从这里开始登记新序列

# 码宽 (每个码字占几位)
初始 = size + 1 位 → 随着字典变满, 依次 +1, 最大 12 位
(2^12 = 4096 个码字是上限, 满了就发 clear 重建字典)
```

关键概念（文章 "The code dictionary" 节）：字典节点是一个"颜色 + 父节点下标"，从叶子沿父链一路走到根，就能拼出这个码字代表的整个颜色序列——它其实是棵树。编码/解码同时进行，谁都不用存字典。

## 4. 解码器实现：三个函数拆解

文章把解码拆成三个函数（Listing 1/2/3），逻辑非常干净。

### ① InitializeDictionary：用调色板灌满根节点

```c
/* ===== 初始化字典 (文章 Listing 1) ===== */
typedef struct { uint8_t r, g, b; uint16_t parent; } DictNode;
static DictNode dict[4096];       /* 最大 2^12 = 4096 个码字 */
static int clear_code, end_code, start_code;
static int next_code;             /* 下一个待写入的码字 */
static int curr_code_size;        /* 当前码宽 (位) */
static int first_char;            /* 上一个输出串的首字符 */
static int stack[4096], sp;       /* OutputCode 用的反转栈 */

void lzw_init(int size)           /* size = LZW 最小码宽(色表位数) */
{
    int limit = 1 << size;
    clear_code = limit;           /* 清除码 = 2^size */
    end_code   = clear_code + 1;  /* 结束码 */
    start_code = clear_code + 2;  /* 第一个新码字 */
    next_code  = start_code;
    curr_code_size = size + 1;    /* 初始码宽 = size + 1 */

    for (int i = 0; i < limit; i++) {   /* 根节点 = 全局色表项 */
        dict[i].r = gct[i * 3];
        dict[i].g = gct[i * 3 + 1];
        dict[i].b = gct[i * 3 + 2];
        dict[i].parent = 0;       /* 根节点没有父节点 */
    }
    sp = 0;
}
```

### ② ReadCode：读一个变长码字（LSB-first）

码宽不是固定的——这正是 LZW 最"tricky"的地方。文章用 12 路 switch 精确处理"上次读剩几位"的边界（Listing 2）。现代写法是维护一个位缓冲，思路完全一致：

```c
/* ===== 变长码读取: LSB-first, 记住上次剩下的位 (Listing 2 思路) ===== */
static uint32_t bit_buf;   /* 位缓冲 */
static int      bit_cnt;   /* 缓冲内有效位数 */
static const uint8_t *block; static int bidx;   /* 当前子块数据 */

static uint32_t read_bits(int n)        /* 0 < n <= 12 */
{
    while (bit_cnt < n) {               /* 不够就从子块补字节 */
        bit_buf |= (uint32_t)block[bidx++] << bit_cnt;
        bit_cnt += 8;
    }
    uint32_t v = bit_buf & ((1u << n) - 1);
    bit_buf >>= n;
    bit_cnt -= n;
    return v;
}
```

### ③ OutputCode：沿父链压栈，反转输出整串

一个码字代表的是一整串颜色。做法：从该节点一路向上走到根，全压进栈（顺序是反的），再出栈就还原了正序（Listing 3）。栈顶元素就是这一串的**首字符**，供建字典用：

```c
/* ===== 输出一个码字 (Listing 3): 压栈再反转 ===== */
void lzw_output(int code, uint8_t *dst, int *idx)
{
    int prev = code;
    sp = 0;

    /* 从叶子沿父链走到根, 压栈 (得到逆序) */
    do {
        if (code == end_code || code == clear_code) break;
        stack[sp++] = code;
        prev = code;
        code = dict[code].parent;
    } while (code != 0);

    /* 处理走到 0 节点时的 off-by-one */
    if (prev > end_code) stack[sp++] = code;

    first_char = stack[sp - 1];     /* 栈顶 = 串的首字符 */

    /* 出栈即还原正序, 写入输出流 */
    while (sp > 0) {
        int c = stack[--sp];
        dst[(*idx)++] = dict[c].r;  /* 按调色板 RGB 输出 */
        dst[(*idx)++] = dict[c].g;
        dst[(*idx)++] = dict[c].b;
    }
}
```

## 5. 主解码循环：边读边建字典（含 KwKwK 特例）

把三块拼起来就是主循环（Listing 4 精简）。注意三种分支：**已存在的码字**（输出 + 用"上一串+本串首字符"建新码字）、**还没定义的码字**（KwKwK 特例：先建字典再输出）、**clear/end 码**（重建字典 / 结束）：

```c
/* ===== 主解码循环 (文章 Listing 4 精简) ===== */
code = read_bits(curr_code_size);
while (code == clear_code) code = read_bits(curr_code_size);  /* 跳过开头 clear */
lzw_output(code, img, &out);
last = code;

while (1) {
    if (next_code >= (1 << curr_code_size) && curr_code_size < 12)
        curr_code_size++;           /* 字典快满, 码宽 +1 */

    code = read_bits(curr_code_size);

    if (code == end_code) break;                        /* 结束 */
    if (code == clear_code) {                           /* 重建字典 */
        lzw_init(init_size);
        while (code == clear_code) code = read_bits(curr_code_size);
        lzw_output(code, img, &out);
        last = code;
        continue;
    }

    if (code < next_code) {             /* 已存在的码字 */
        lzw_output(code, img, &out);
        dict[next_code].parent = last;              /* 新串 = 旧串 + 首字符 */
        dict[next_code].r = dict[first_char].r;
        dict[next_code].g = dict[first_char].g;
        dict[next_code].b = dict[first_char].b;
        next_code++;
    } else {                            /* code == next_code: KwKwK 特例 */
        dict[next_code].parent = last;
        dict[next_code].r = dict[first_char].r;
        dict[next_code].g = dict[first_char].g;
        dict[next_code].b = dict[first_char].b;
        next_code++;
        lzw_output(code, img, &out);
    }
    last = code;
}
```

> ⚠️ **KwKwK 特例最容易绕晕：**解码器可能遇到"字典里还没有的码字"——它必然是"上一串 + 上一串的首字符"（编码器刚生成、还没轮到这个码字就发了）。必须先把它写进字典，再输出。手推一遍练习 15.1 你就彻底懂了。

## 6. 与 LVGL 衔接：lv_gif

LVGL 的 `lv_gif` 正是用上面这套 LZW 解码（底层是 `gifdec`，即 gd_GIF），包成 `lv_img` 的子类：对象创建后定时器自动推进动画帧（lv_gif.h:30，内部有 `lv_timer_t` 驱动）：

```c
/* ===== lv_gif 使用 (LVGL v8.3) ===== */
lv_obj_t *gif = lv_gif_create(lv_scr_act());   /* 创建对象 (img 子类) */
lv_gif_set_src(gif, "A:/anim.gif");           /* 指定 GIF 文件 */
lv_obj_center(gif);
/* 需要重播时: lv_gif_restart(gif); */
```

> ⚠️ **动画 GIF 在 F407 上是"内存大户"：**GIF 必须先整帧解出再上屏，320×240 的 RGB565 全帧要 320×240×2 ≈ **150KB**，而 F407 总共 192KB RAM。而且工程里 `LV_USE_GIF` 默认 0（lv_conf.h:668），要用得改成 1 重新编译。真机建议：小尺寸动图（如图标级 96×96 ≈ 18KB）或先降帧。这正是你在第 13、14 课学的"内存换时间"权衡。

## 动手练习

### 练习 15.1：手推 LZW 解码字典

1. 场景：LZW 最小码宽 = 3（8 色），调色板 `1 = 红`、`2 = 蓝`。码流（十进制）为：`8, 1, 2, 10, 10, 9`（8=clear，9=end，初始码宽 4 位）。
2. 画一张表，逐码字记录：输出什么颜色串、新建的码字内容（父节点 + 颜色）、first_char、next_code。
3. 验证：6 个输出像素是不是 `红 蓝 红 蓝 红 蓝`？新建的 10、11、12 三个码字各代表什么串？码宽有变化吗？

### 练习 15.2：解剖一张真实 GIF

1. 找一张 .gif（没有就用 LVGL 自带的动图素材），HxD 打开，确认开头 6 字节是 GIF87a 还是 GIF89a。
2. 读出逻辑屏幕的宽（2 字节小端）、全局色表大小（标志位低 3 位 +1 再取 2 次幂，乘 3 字节验证色表区间）。
3. 找到第一个 0x2C 图像描述符的偏移，读出图像宽高；再找 0x21 扩展块（89a 动画一定有几个），记录它们的标签值。

## 自测

### 随堂小测

**Q1. GIF 文件开头 6 个字节是？**

- A. 'GIF87a' 或 'GIF89a'
- B. 'RIFFWAVE' 六个字符
- C. 4 字节魔数加版本号
- D. 'GIF' 加 3 字节随机数

<details><summary>查看答案</summary>

A。签名 'GIF' + 版本 '87a'/'89a'，共 6 字节。

</details>

**Q2. 解码过程中 LZW 码宽为什么会增大？**

- A. 因为图像的颜色越来越多
- B. 字典码字变多，需要更多位表示
- C. 为了提高压缩率必须持续增大
- D. 与文件大小成正比增长

<details><summary>查看答案</summary>

B。码字空间被占满，next_code ≥ 2^码宽 时 +1，最大 12 位。

</details>

**Q3. clear code（清除码）的用途是？**

- A. 标记一帧图像的数据结束
- B. 清空并重建字典，重新开始编码
- C. 表示某个像素是透明色
- D. 表示隔行扫描开始

<details><summary>查看答案</summary>

B。字典塞满或数据特性变化时发 clear，重置字典从头建。

</details>

**Q4. LVGL 里播放 GIF 动画的第一步是？**

- A. lv_gif_create 创建对象再 set_src
- B. 直接用 lv_img 就能自动动起来
- C. 先调用 lv_split_jpeg_init
- D. 用 lv_timer 手动逐帧刷新

<details><summary>查看答案</summary>

A。lv_gif 是 lv_img 子类，create 后 lv_gif_set_src 指定文件，内部定时器自动播放。

</details>

## 推荐阅读

- 📖 Andrew S. Downs《Implementing a GIF Decoder》全文——本课全部依据（Header/Screen/Image Descriptor、LZW 字典、ReadCode/OutputCode/主循环、隔行、专利史）
- 🔧 工程源码：`EXTERNAL/LVGL/src/extra/libs/gif/lv_gif.c` 与 `gifdec.c`——可对照本文读懂 LVGL 的实现

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 16 课——从图像世界切换回总线世界，认识 CAN 物理层：为什么汽车里到处都是这对差分线。

| [← 上一课](/my-blog/posts/toolbox/0014-jpeg-principles-huffman/) | [课程目录](/my-blog/posts/toolbox/00-总览/) | [下一课 →](/my-blog/posts/toolbox/0016-can-basics/) |