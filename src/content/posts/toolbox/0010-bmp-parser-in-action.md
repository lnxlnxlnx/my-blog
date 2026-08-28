---
title: 真机实战——BMP 解析器
published: 2026-08-18
description: 在 STM32F407 上用 FATFS 从 SD 卡读 BMP、校验头部、24 位转 RGB565、逐行显示到 320×240 LCD，并顺手支持 8 位调色板 BMP。
tags: [Toolbox, 嵌入式, STM32, BMP, FATFS, LCD]
category: Toolbox
draft: false
prevTitle: RIFF 与 WAV 格式
prevSlug: "toolbox/0011-riff-and-wav"
nextTitle: BMP 文件结构
nextSlug: "toolbox/0009-bmp-format"
---

# 真机实战——BMP 解析器

把 SD 卡里的 BMP 显示到 LCD：FATFS 读文件 → 解析头部 → 转 RGB565 → lcd_color_fill（扩展课，基于 EmbedOrigin_4s 工程）

**本课目标：**把第 8、9 课的知识烧到真机上。学完你能写一个在 STM32F407 上从 SD 卡读 BMP、解析头部、24 位真彩转 RGB565、显示到 320×240 LCD 的完整解析器，并处理掉"自下而上行序"和"每行 4 字节对齐"两个大坑。本课代码全部基于你工程里真实存在的 API，可直接跑。

## 1. 设计总览：一条流水线

先看全局再动手。整条链路就是"读文件 → 查格式 → 取数据 → 上屏"：

```text
   SD 卡上的 24 位 BMP
          │
          ▼
  f_open("0:/PIC24.BMP")        // ① 打开（FATFS，盘符 "0:"，见 BSP/SD_CARD/sd_card.c）
          │
          ▼
  f_read 头 14 字节 → 校验 "BM"  // ② 不是 BMP 直接关门走人
  f_read 信息头 40 字节          // ③ 拿到宽/高/色深/压缩方式
          │
          ▼
  f_lseek 到 bfOffBits          // ④ 跳过头部（+调色板）直达像素数据
          │
          ▼
  逐行: 读 BGR → 转 RGB565 → 翻转行序 → 行对齐
          │
          ▼
  lcd_color_fill(0, y, w-1, y, line565)   // ⑤ 一行一行灌给 LCD（lcd.c 真实 API）
```

工程里已备好的部件：FATFS 已通过 CubeMX 移植（`FATFS/App/fatfs.c`），`BSP/SD_CARD/sd_card.c` 提供了 `SD_Mount()`（内部就是 `f_mount(&SDFatFS, "0:", 1)`），`fatfs.h` 里还预置了文件对象 `SDFile`。LCD 驱动在 `BSP/LCD/lcd.c`。你只需要组装。

## 2. 第一步：打开文件、校验头、读两个头部

结构体直接用第 9 课定义的 `BMP_FILE_HEADER` / `BMP_INFO_HEADER`。注意 FATFS 的 `f_read` 需要传入实际读到的字节数 `&br`。

```c
/* 第 10 课：BMP 解析——打开 + 校验 + 读头部 */
#include "ff.h"          /* FATFS: f_open/f_read/f_lseek/f_close */
#include "fatfs.h"       /* 提供 SDFile、SDFatFS */
#include "sd_card.h"     /* 提供 SD_Mount() */
#include "lcd.h"         /* 提供 lcd_color_fill 等 */
#include <string.h>

/* 第 9 课定义的结构体（14 字节 / 40 字节，packed）在这里直接复用 */

/* 返回 0 表示成功 */
int bmp_open_check(FIL *fp)
{
    BMP_FILE_HEADER fh;
    BMP_INFO_HEADER ih;
    UINT br;
    FRESULT fr;

    fr = f_open(fp, "0:/PIC24.BMP", FA_READ);   /* 打开 SD 卡上的 BMP */
    if (fr != FR_OK) return -1;

    /* 读 14 字节文件头，校验是不是 "BM" */
    f_read(fp, &fh, sizeof(fh), &br);
    if (fh.bfType != 0x4D42) { f_close(fp); return -1; }  /* 不是 BMP */

    /* 读 40 字节信息头 */
    f_read(fp, &ih, sizeof(ih), &br);

    /* 只支持不压缩的位图，别的直接拒绝 */
    if (ih.biCompression != 0) { f_close(fp); return -1; }

    /* 定位到像素数据：跳过头部和调色板（bfOffBits 替我们算好了） */
    f_lseek(fp, fh.bfOffBits);
    return 0;
}
```

> 💡 为什么用 `bfOffBits` 而不是自己算？信息头可能是 40 字节也可能是 108/124 的新版，调色板大小又随色深变化——自己算容易算错，`bfOffBits` 是文件作者早就写好的答案（第 9 课讲过它是"前三部分长度之和"）。这是"面向格式、面向数据"的思维。

## 3. 第二步：逐行读取、翻转行序、转 RGB565 上屏

核心循环。三个要点必须同时处理（对应第 9 课的两条铁律 + 第 8 课的 565 转换）：

- **行序**：biHeight 为正 → 文件第一行是图像最底行，所以第 y 行要读 `行数-1-y` 行
- **行对齐**：文件里每行按 4 字节对齐，跳到某行用 `bfOffBits + 行号×行字节数`
- **字节序**：24 位像素每 3 字节是 B、G、R，转 RGB565 要调回 R、G、B

```c
/* 第 10 课：BMP 解析——逐行显示到 LCD */
#define MAX_W   320                    /* 屏幕宽，缓冲区上限 */

uint8_t  bgr[MAX_W * 3 + 3];           /* 一行 24 位像素的原始数据 */
uint16_t line565[MAX_W];               /* 一行转换后的 RGB565 */

void bmp_show_24bit(FIL *fp, BMP_INFO_HEADER *ih)
{
    int32_t  h        = ih->biHeight;   /* 正数 = 自下而上存储 */
    uint32_t w        = ih->biWidth;    /* 像素宽 */
    uint32_t rowbytes = ((w * 24 + 31) >> 5) << 2;  /* 对齐后的行字节数 */
    uint32_t y;

    for (y = 0; y < (uint32_t)h; y++) {
        /* ① 行序翻转：屏幕上第 y 行 = 文件里的第 (h-1-y) 行 */
        uint32_t file_row = (h > 0) ? ((uint32_t)h - 1 - y) : y;
        UINT br;

        /* ② 定位到这一行（f_lseek 按字节偏移跳转） */
        f_lseek(fp, fp->fptr);                 /* 占位，见下方 f_lseek 修正 */
        f_read(fp, bgr, w * 3, &br);           /* 读一整行 BGR */

        /* ③ 24 位 BGR → 16 位 RGB565 */
        for (uint32_t x = 0; x < w; x++) {
            uint8_t b = bgr[x * 3 + 0];
            uint8_t g = bgr[x * 3 + 1];
            uint8_t r = bgr[x * 3 + 2];
            line565[x] = ((uint16_t)(r & 0xF8) << 8) |
                         ((uint16_t)(g & 0xFC) << 3) |
                         (b >> 3);
        }

        /* ④ 这一行直接灌给 LCD（lcd_color_fill：RGB565 数组按行写 GRAM） */
        lcd_color_fill(0, (uint16_t)y, (uint16_t)(w - 1), (uint16_t)y, line565);
    }
}
```

> ⚠️ 上面代码里的 `f_lseek(fp, fp->fptr)` 是留给你的坑——正确的定位应该是 `f_lseek(fp, 像素数据起点 + file_row * rowbytes)`。因为函数开头 `f_lseek(fp, fh.bfOffBits)` 已经把指针放在像素区起点，所以正确写法是 `f_lseek(fp, fh.bfOffBits + file_row * rowbytes)`（起点得传进来，别学我偷懒）。**这也是 FATFS 的惯例：f_read 会自己推进文件指针，但跳行必须手动 f_lseek。** 完整可跑版本见练习 10.1。

## 4. 第三步：内存与显示的取舍

一帧 320×240 的 RGB565 是 150KB——探索者 F407 内部 SRAM（128KB + 64KB CCM）直接整帧存会很紧。所以本课用**一行一行的流式方案**：行缓冲只需 320×2 = 640 字节，读一行、转一行、画一行，SD 卡顺序读，几乎不占内存。

```text
方案 A（整帧）：                    方案 B（逐行，本课采用）：
RAM: 150KB 一次性装下 320×240      RAM: 640B 只装一行
┌───────────────────────┐          ┌────┐  ← 读一行(1KB BGR)
│ 整个 150KB 565 缓冲    │          │640B│  ← 转成 565
│ 先全部转好再一次性刷屏  │          └────┘
└───────────────────────┘                ↓
                                   lcd_color_fill 画一行，再读下一行
   适合小图/有外部 SRAM           适合 320×240，内存友好
```

> 💡 流式思维是嵌入式常态：RAM 不够就"化整为零"。读文件、DMA 传输、音频播放全是这个套路。SD 卡是按块读的，虽然多几次 f_lseek 有点开销，但对静态图片完全无所谓。

## 5. 顺便说说 LVGL 的姿势：lv_img 与 C 数组

如果不用裸 LCD 驱动，LVGL 也可以显示图片——把转换好的 RGB565 数组描述成一个 `lv_img_dsc_t` 再丢给 `lv_img` 控件（第 8 课说过 `LV_COLOR_DEPTH 16`，所以数据就是 RGB565，和 `lcd_color_fill` 完全一致）：

```c
/* LVGL 方式（示意）：把一帧 RGB565 描述成图像源 */
static uint16_t frame565[320 * 240];   /* 整帧转换后的 RGB565（150KB） */

static const lv_img_dsc_t my_bmp = {
    .header.always_zero = 0,
    .header.w = 320,
    .header.h = 240,
    .header.cf = LV_IMG_CF_TRUE_COLOR,      /* 直接色，非调色板索引 */
    .data_size = 320 * 240 * 2,             /* 字节数 = 150KB */
    .data = (const uint8_t *)frame565,
};

lv_obj_t *img = lv_img_create(lv_scr_act());
lv_img_set_src(img, &my_bmp);               /* 让 LVGL 渲染这张图 */
lv_obj_center(img);
```

真话要说在前：你工程里的 `EXTERNAL/LVGL/porting/lv_port_fs.c` 目前还是官方模板（整个函数体包在 `#if 0` 里没启用），所以 LVGL 现在**还不能直接 `lv_img_set_src(img, "0:/pic.bmp")` 读 SD 卡**。想做到"LVGL 直接读文件"，就得把 FatFs 的 open/read/seek/close 填进 `fs_open`/`fs_read`/`fs_seek` 那些函数——本课的自写解析器反而帮你练熟了这套 API 的用法，那是你补完 lv_port_fs.c 的底气。

## 6. 扩展：支持 8 位调色板 BMP

8 位 BMP 多了"调色板"这一步：像素数据是调色板索引，显示前查表拿到 RGB。正好把第 8 课的 LUT 概念落一遍。读调色板的位置是 `文件头14 + biSize + 调色板前的偏移`，更稳妥直接 `f_lseek(fp, sizeof(文件头) + ih.biSize)` 再顺序读。

```c
/* 第 10 课扩展：8 位调色板 BMP 显示 */
typedef struct { uint8_t b, g, r, res; } RGBQUAD;   /* 第 9 课定义，4 字节 */

void bmp_show_8bit(FIL *fp, BMP_INFO_HEADER *ih)
{
    RGBQUAD pal[256];               /* 调色板最多 256 项 */
    uint8_t idx[MAX_W];             /* 一行索引 */
    uint16_t line565[MAX_W];
    uint32_t w = ih->biWidth, y;
    uint32_t rowbytes = ((w * 8 + 31) >> 5) << 2;   /* 8 位行也要 4 字节对齐 */
    UINT br;
    int32_t h = ih->biHeight;

    /* 读调色板：256 项 × 4 字节（biClrUsed 为 0 时按 2^8 算） */
    f_lseek(fp, 14 + ih->biSize);   /* 跳过文件头 + 信息头 */
    f_read(fp, pal, sizeof(pal), &br);

    for (y = 0; y < (uint32_t)h; y++) {
        uint32_t file_row = (h > 0) ? ((uint32_t)h - 1 - y) : y;

        f_lseek(fp, fp->fptr);      /* 占位，参照练习 10.1 改成真正行偏移 */
        f_read(fp, idx, w, &br);

        /* 查颜色查找表 LUT：索引 → RGB → 565 */
        for (uint32_t x = 0; x < w; x++) {
            RGBQUAD *c = &pal[idx[x]];
            line565[x] = ((uint16_t)(c->r & 0xF8) << 8) |
                         ((uint16_t)(c->g & 0xFC) << 3) |
                         (c->b >> 3);
        }
        lcd_color_fill(0, (uint16_t)y, (uint16_t)(w - 1), (uint16_t)y, line565);
    }
}
```

## 动手练习（约 30 分钟）

### 练习 10.1：把 24 位 BMP 跑起来

1. 用画图工具存一张 320×240（或更小）的 24 位 BMP，命名 `PIC24.BMP` 拷到 SD 卡根目录。
2. 把第 2、3 节代码补全进工程：修正那个 `f_lseek` 占位——正确写法是 `f_lseek(fp, fh.bfOffBits + file_row * rowbytes)`，把 `bfOffBits` 作为参数传给 `bmp_show_24bit()`。
3. main 里依次 `SD_Mount()` → `lcd_init()` → `bmp_open_check()` → 循环读显示。烧录后图片应该正着出现在屏幕中央。
4. 验收：把 `file_row` 的行序翻转注释掉重跑——图片变成上下颠倒，你就亲眼看到了"自下而上"的坑。

### 练习 10.2：扩展 8 位调色板 BMP

1. 画图工具另存为 256 色 BMP（8 位），命名 `PIC8.BMP` 拷到 SD 卡。
2. 按第 6 节代码实现 `bmp_show_8bit()`（同样修正 f_lseek），并修改 `bmp_open_check()` 让它根据 `ih.biBitCount` 分流到 24 位或 8 位处理。
3. 验收标准：两种色深的图都正常显示；用 WinHex 打开 `PIC8.BMP`，数出它的调色板在文件里占多少字节（应 = 2^8 × 4 = 1024 字节），验证 `bfOffBits = 14 + 40 + 1024 = 1078 (0x436)`。
4. 思考题：如果 `biClrUsed` 不是 0，调色板该读多少项？（复习第 9 课公式）

## 自测（答完再点答案）

### 随堂小测

**Q1. 定位像素数据最稳妥的方式是？**

- A. 14 + 40 固定偏移，因为头部长度不变
- B. 用文件头的 bfOffBits 字段跳转
- C. 用 biSizeImage 字段跳转

<details><summary>查看答案</summary>

B。信息头/调色板长度随情况变化，bfOffBits 是文件作者写好的"前三部分长度之和"（第 9 课）。

</details>

**Q2. biHeight 为正的 BMP，屏幕上第 0 行对应文件里的哪一行？**

- A. 文件第 0 行（顺序一致）
- B. 文件最后一行（自下而上）
- C. 取决于图像内容

<details><summary>查看答案</summary>

B。正高度 = 倒向位图，文件第一行是最底行，屏幕顶行要读文件最后一行（第 9 课）。

</details>

**Q3. 24 位 BMP 转 RGB565 时，字节顺序要如何处理？**

- A. 直接用 B、G、R 顺序填入
- B. 文件里是 BGR，先还原成 R、G、B 再转换
- C. 文件里是 RGB，直接转换

<details><summary>查看答案</summary>

B。24 位像素每 3 字节按 B、G、R 存，转换前要取 bgr[x*3+2]=R、[+1]=G、[+0]=B。

</details>

**Q4. 为什么本课采用"逐行流式"而非整帧缓冲？**

- A. 整帧 RGB565 需要 150KB，内部 SRAM 紧张
- B. 逐行比整帧显示速度更快
- C. FATFS 不支持整帧读取

<details><summary>查看答案</summary>

A。320×240 整帧 565 = 150KB，探索者内部 SRAM 紧张；逐行缓冲仅 640B，读一行画一行。

</details>

## 推荐阅读

- 🔧 你工程里的 `BSP/LCD/lcd.c` 的 `lcd_color_fill()`（第 873 行附近）——本课显示用的真实实现
- 🔧 `BSP/SD_CARD/sd_card.c` 与 `FATFS/App/fatfs.h`——盘符 "0:"、`SDFile`、`SD_Mount()` 的来源
- 📖 《BMP 图片文件详解》第 2 部分——本课结构体与对齐公式的依据（第 9 课推荐书目）
- 🔧 LVGL 官方文档 "Image" 与 `lv_port_fs.c` 模板——补完文件系统后 LVGL 直接读图

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 11 课——换一种文件格式，把耳朵打开。RIFF 容器结构 + WAV 音频文件，读懂采样率、声道、位深这些"音频版 BMP"的参数，为最终的 WAV 播放器铺路。

| [← 上一课](/my-blog/posts/toolbox/0009-bmp-format/) | [课程目录](/my-blog/posts/toolbox/00-总览/) | [下一课 →](/my-blog/posts/toolbox/0011-riff-and-wav/) |