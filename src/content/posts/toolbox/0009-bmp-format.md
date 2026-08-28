---
title: BMP 文件结构
published: 2026-08-17
description: BMP 四大组成部分与两个头部结构全部字段，读懂"每行 4 字节对齐"和"自下而上存储"两大坑，并逐字节解剖一个真实 BMP。
tags: [Toolbox, 嵌入式, STM32, BMP, 文件格式]
category: Toolbox
draft: false
prevTitle: 真机实战——BMP 解析器
prevSlug: "toolbox/0010-bmp-parser-in-action"
nextTitle: 像素与调色板
nextSlug: "toolbox/0008-pixels-and-palette"
---

# BMP 文件结构

把像素矩阵装进文件：BITMAPFILEHEADER / BITMAPINFOHEADER / 调色板 / 像素数据（《BMP 图片文件详解》第 2 部分）

**本课目标：**上一课在脑子里有了"像素矩阵 + 调色板"，这一课看它怎么落地成文件。学完你能说清 BMP 的四大组成部分和两个头部结构的所有字段，看懂"每行 4 字节对齐"和"自下而上存储"这两个最容易踩坑的规则，并能用十六进制工具逐字节读出任意 BMP 的参数——这是 0010 课真机解析器的全部前置知识。

## 1. BMP 文件总体结构：四个部分

Windows 位图文件大体分四部分（(章节 2)）：文件头 + 信息头 + 调色板（可无）+ 像素数据。前两部分是固定长度的结构体，调色板只有索引色图才有。

```text
偏移      长度     内容
0x00      14 字节  BITMAPFILEHEADER   // ① 位图文件头：文件类型/大小/数据偏移
0x0E      40 字节  BITMAPINFOHEADER   // ② 位图信息头：宽高/色深/压缩方式
0x36      N 字节   调色板 RGBQUAD[]   // ③ 调色板（16/256 色图才有；真彩图没有）
...       M 字节   像素数据            // ④ 索引值（索引色）或 BGR 值（真彩）

// 前三个部分的长度之和 = bfOffBits，即像素数据的起点
```

> 💡 教材给的快速验证：一个最常见的 24 位真彩 BMP，头部就是 14 + 40 = 54 字节（0x36），像素数据从 0x36 开始。用 WinHex 打开，看到 `42 4D` 开头就对了。

## 2. 位图文件头 BITMAPFILEHEADER：14 字节

固定 14 字节（WORD=无符号 16 位，DWORD=无符号 32 位）（(章节 2)）：

```c
typedef struct tagBITMAPFILEHEADER {
    WORD   bfType;       /* 0x4D42 = 'BM'，所有 BMP 的头两个字节 */
    DWORD  bfSize;       /* 整个文件大小，包括这 14 字节 */
    WORD   bfReserved1;  /* 保留，置 0 */
    WORD   bfReserved2;  /* 保留，置 0 */
    DWORD  bfOffBits;    /* 从文件头到像素数据的偏移 = 前三部分长度之和 */
} BITMAPFILEHEADER;      /* 共 14 字节 */
```

- **bfType**：必须 0x4D42，即字符 "BM"。编程时只用判断它——其他 BA/CI/CP/IC/PT 是 OS/2 的标识，不用管（(章节 2)）
- **bfOffBits 最有用**：信息头和调色板长度随情况变化，靠这个偏移量直接定位像素数据，不用自己推算（(章节 2)）

## 3. 位图信息头 BITMAPINFOHEADER：40 字节

固定 40 字节（(章节 2)），描述尺寸、色深、压缩方式：

```c
typedef struct tagBITMAPINFOHEADER {
    DWORD  biSize;             /* 本结构长度，= 40（也可能是 108/124 的新版，要读文件里的实际值） */
    LONG   biWidth;            /* 图像宽度，像素 */
    LONG   biHeight;           /* 图像高度，像素；正数=自下而上，负数=自上而下 */
    WORD   biPlanes;           /* 位面数，恒为 1 */
    WORD   biBitCount;         /* 每像素位数：1/4/8/16/24/32 */
    DWORD  biCompression;      /* 0=BI_RGB 不压缩；1=BI_RLE8；2=BI_RLE4；3=BI_BITFIELDS */
    DWORD  biSizeImage;        /* 像素数据字节数（BI_RGB 时可为 0，自己算） */
    LONG   biXPelsPerMeter;    /* 水平分辨率，像素/米（打印用，显示可忽略） */
    LONG   biYPelsPerMeter;    /* 垂直分辨率，像素/米 */
    DWORD  biClrUsed;          /* 实际用到的颜色数；0 = 用满 2^biBitCount 个 */
    DWORD  biClrImportant;     /* 重要颜色数；0 = 都重要 */
} BITMAPINFOHEADER;            /* 共 40 字节 */
```

- **biBitCount**：1=黑白二色、4=16 色、8=256 色、24=真彩色。本课程只处理不压缩（biCompression=0）的情况（(章节 2)）
- **biHeight 的符号藏了个大坑**：正数说明图像是"倒向的"——像素数据自下而上存储，文件第一行是图像最底行；负数则是正向（自上而下），且负数高度不允许压缩（(章节 2)）
- **biSize 别写死 40**：微软后来出了 BITMAPV4HEADER(108) / V5HEADER(124)，但绝大多数 BMP 还是 40（(章节 2)）。程序里读实际值，跳过时用 `sizeof(文件头14) + biSize + 调色板长度` 的方式兼容
- **biClrUsed**：为 0 时用到的颜色数 = 2^biBitCount；非 0 时调色板尺寸按它算（(章节 2)）

## 4. 调色板与像素数据：两处经典陷阱

**调色板**是一个 RGBQUAD 数组，每个元素 4 字节：**蓝、绿、红、保留**（B、G、R、0 的顺序！）（(章节 2)）：

```c
typedef struct tagRGBQUAD {
    BYTE rgbBlue;      /* 蓝色分量 */
    BYTE rgbGreen;     /* 绿色分量 */
    BYTE rgbRed;       /* 红色分量 */
    BYTE rgbReserved;  /* 保留，置 0 */
} RGBQUAD;             /* 共 4 字节，注意顺序是 BGR */
```

**像素数据**的形态取决于 biBitCount（(章节 2)）：

| biBitCount | 含义 | 像素数据内容 | 字节数/像素 |
|------------|------|--------------|-------------|
| 1 | 2 色 | 调色板索引 0/1 | 1/8（1 字节存 8 像素） |
| 4 | 16 色 | 调色板索引（高 4 位=第 1 像素） | 1/2 |
| 8 | 256 色 | 调色板索引 | 1 |
| 24 | 真彩色 | **B、G、R** 直接值（无调色板） | 3 |

两条铁律（(章节 2)）：

```text
# 铁律 1：每行字节数必须是 4 的整倍数，不足补齐
# 24 位宽 241 像素的图：裸行 241×3=723 字节 → 补齐到 724 字节
# 公式：biWidth' = 大于等于裸行的、离 4 最近的倍数

# 铁律 2：像素数据一般自下而上存储（biHeight 为正数时）
文件第 1 行 ──► 图像最底行（左下角第一个像素）
文件第 2 行 ──► 倒数第二行
    ...
文件最后一行 ──► 图像最顶行（右上角最后一个像素）
```

> ⚠️ 两个最坑的细节：① **真彩像素的字节序是 BGR**（蓝在前红在后），不是直觉的 RGB；② **行对齐和行序都必须在解析时处理**——不做行对齐，读出来的数据整体错位；不翻转行序，图片上下颠倒。0010 课真机上这两个坑都会踩到。

## 5. 代码示例

示例 1：解析时用的两个结构体定义。嵌入式里务必加打包对齐，否则结构体里会出现填充字节，f_read 直接读会错位。

```c
/* 第 9 课：BMP 头部结构（解析专用，__packed 禁止编译器对齐填充） */
#include <stdint.h>

typedef struct {
    uint16_t bfType;       /* 0x4D42 = "BM" */
    uint32_t bfSize;       /* 文件总大小 */
    uint16_t bfReserved1;  /* 0 */
    uint16_t bfReserved2;  /* 0 */
    uint32_t bfOffBits;    /* 像素数据偏移 */
} __attribute__((packed)) BMP_FILE_HEADER;    /* 14 字节 */

typedef struct {
    uint32_t biSize;           /* 信息头大小 40 */
    int32_t  biWidth;          /* 宽度（像素） */
    int32_t  biHeight;         /* 高度；正=自下而上，负=自上而下 */
    uint16_t biPlanes;         /* 恒为 1 */
    uint16_t biBitCount;       /* 1/4/8/24 常用 */
    uint32_t biCompression;    /* 0 = BI_RGB 不压缩 */
    uint32_t biSizeImage;      /* 像素数据字节数 */
    int32_t  biXPelsPerMeter;  /* 水平分辨率 */
    int32_t  biYPelsPerMeter;  /* 垂直分辨率 */
    uint32_t biClrUsed;        /* 实际颜色数，0 = 2^biBitCount */
    uint32_t biClrImportant;   /* 重要颜色数 */
} __attribute__((packed)) BMP_INFO_HEADER;    /* 40 字节 */

typedef struct {
    uint8_t rgbBlue;      /* 注意顺序：B、G、R、保留 */
    uint8_t rgbGreen;
    uint8_t rgbRed;
    uint8_t rgbReserved;
} __attribute__((packed)) RGBQUAD;            /* 4 字节 */
```

示例 2：两个必会的计算——行字节数（4 字节对齐）和调色板大小。

```c
/* 行字节数：裸字节向上取整到 4 的倍数 */
/* 教材公式：biWidth' = 大于等于裸行、离 4 最近的整倍数 */
uint32_t bmp_line_bytes(uint32_t width, uint32_t bpp)
{
    return ((width * bpp + 31) >> 5) << 2;   /* 等价于 ceil(width*bpp/32)*4 */
}

/* 像素数据总字节数（未压缩时）：biSizeImage 可为 0，自己算更稳 */
uint32_t bmp_data_size(uint32_t width, int32_t height, uint32_t bpp)
{
    uint32_t lines = (uint32_t)(height > 0 ? height : -height); /* 高度取绝对值 */
    return bmp_line_bytes(width, bpp) * lines;
}

/* 调色板项数：biClrUsed 为 0 时按 2^biBitCount 算 */
uint32_t bmp_palette_count(uint32_t bpp, uint32_t clr_used)
{
    return (clr_used != 0) ? clr_used : (1u << bpp);
}

/* 验证：240 宽 24 位 → 240*3=720，已对齐，行字节数 720 */
/*       241 宽 24 位 → 723 → 向上取整到 724（教材原例） */
```

## 6. 实例分析：逐字节读一个真彩 BMP

拿一个 24 位真彩 BMP 的开头做解剖（假设是张 320×240 的图，教材"表 6-01"与结构定义综合）：

```text
偏移  十六进制                              ASCII     字段值
0000  42 4D 36 84 03 00 00 00 00 00       BM6......  bfType=0x4D42 "BM"; bfSize=0x00038436=230,454
000A  36 00 00 00 28 00 00 00 40 01      6...(...@.  bfOffBits=0x36=54; biSize=40; biWidth=320
0014  00 00 F0 00 00 00 01 00 18 00       .........  biHeight=240; biPlanes=1; biBitCount=24
001E  00 00 00 00 00 84 03 00 00 00       .........  biCompression=0(BI_RGB); biSizeImage=0x38400=230,400
0028  00 00 00 00 00 00 00 00 00 00       .........  分辨率与颜色数全 0（=用满所有颜色）
0036  00 F8 80 FF 00 38 ...                数据区      像素从这里开始：每 3 字节 = B,G,R
```

对照公式验证：biSizeImage = 230400 = 320×240×3 ✓（320 宽恰好 4 对齐，无补齐）。bfOffBits = 14 + 40 = 54 ✓（真彩无调色板）。bfSize = 54 + 230400 = 230454 = 0x00038436 ✓。三个数字互相咬合，这就是"读懂文件"的样子。

## 动手练习（约 20 分钟）

### 练习 9.1：解剖一张真实 BMP

1. 用画图工具随便存一张 24 位 BMP（或从 SD 卡读卡器取一张），用 WinHex 或 VS Code 的 Hex Editor 插件打开。
2. 验证：头两个字节是 42 4D？bfSize 的 4 字节（小端）展开成十进制，和文件大小一致吗？
3. 读出 biWidth / biHeight / biBitCount，再用本课公式手算 bfOffBits，看和文件里 bfOffBits 是否一致——一致说明你完全读懂了。

### 练习 9.2：找行对齐的补位字节

1. 用画图工具存一张宽 241 像素（或任何非 4 倍数宽度）的 24 位 BMP。
2. 定位到像素数据起点，数第一行的 723 个数据字节，再看第 724 个字节是什么——它是不被显示的对齐填充。
3. 顺便看看 biHeight 是正是负？像素数据第一行对应图像的哪一行？（提示：倒着看就对了）

## 自测（答完再点答案）

### 随堂小测

**Q1. BMP 文件头 BITMAPFILEHEADER 的 bfType 字段值必须是？**

- A. 0x424D，即字符串 "BM"
- B. 0x4D42，即字符串 "BM"
- C. 0x4D42，即字符串 "MB"

<details><summary>查看答案</summary>

B。bfType 为 0x4D42，文件头两个字节显示为 "BM"（章节 2）。

</details>

**Q2. biHeight 为正数时，像素数据的存储顺序是？**

- A. 自上而下：第一行是图像最顶行
- B. 自下而上：第一行是图像最底行
- C. 与扫描方向无关，按颜色排序

<details><summary>查看答案</summary>

B。正数 = 倒向位图，数据自下而上存；负数才是自上而下（章节 2）。

</details>

**Q3. 24 位真彩 BMP 中，每个像素的 3 字节顺序是？**

- A. 红、绿、蓝（RGB）
- B. 蓝、绿、红（BGR）
- C. 绿、红、蓝（GRB）

<details><summary>查看答案</summary>

B。位图数据每 3 字节为 B、G、R 顺序（章节 2 像素数据说明）。

</details>

**Q4. 宽 241 像素的 24 位 BMP，每行实际占用多少字节？**

- A. 723 字节，直接用裸行大小
- B. 724 字节，补齐到 4 的整倍数
- C. 728 字节，补齐到 8 的整倍数

<details><summary>查看答案</summary>

B。241×3=723，向上取 4 的倍数得 724（教材原例：biWidth=241 → biWidth'=244）。

</details>

## 推荐阅读

- 📖 《BMP 图片文件详解》第 2 部分（"BMP 文件格式分析"）——本课全部依据：两个头结构的全部字段、表 6-01 偏移表、彩色表与像素数据细节
- 🔧 VS Code 插件 `Hex Editor` 或 WinHex——练习 9.1/9.2 的解剖工具

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 10 课——真机实战！用 FATFS 从 SD 卡读出 BMP，解析头部、转换 RGB565，用 lcd_color_fill 把图片显示到你的 320×240 LCD 上，8 位调色板 BMP 也顺手支持。

| [← 上一课](/my-blog/posts/toolbox/0008-pixels-and-palette/) | [课程目录](/my-blog/posts/toolbox/00-总览/) | [下一课 →](/my-blog/posts/toolbox/0010-bmp-parser-in-action/) |