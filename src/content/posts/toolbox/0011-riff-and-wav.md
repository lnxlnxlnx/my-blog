---
title: RIFF 与 WAV 格式
published: 2026-08-19
description: 把声音装进文件：RIFF 块结构与 WAV 波形格式。学完能说清 chunk 四要素、读懂 fmt 和 data 子块，从 PCMWAVEFORMAT 六个字段算出这段音频怎么播放。
tags: [Toolbox, 嵌入式, STM32, WAV, RIFF]
category: Toolbox
draft: false
prevTitle: 真机实战：WAV 播放器
prevSlug: "toolbox/0012-wav-player"
nextTitle: 真机实战 BMP 解析器
nextSlug: "toolbox/0010-bmp-parser-in-action"
---

# RIFF 与 WAV 格式

把声音装进文件：RIFF 块结构 + WAV 波形格式（《WAV 文件格式分析与应用》全文）

**本课目标：**BMP 讲完了图片，这课讲声音。学完你能说清 RIFF"块（chunk）"结构的四个要素，读懂 WAV 文件里的 `fmt` 和 `data` 两个子块，从 `PCMWAVEFORMAT` 的六个字段算出"这段音频怎么播放"，并能用十六进制工具解析任意 WAV 的头部——这是下一课做 WAV 播放器的全部解码依据。

## 1. RIFF 概念：一切从块开始

Windows 下大部分多媒体文件都按"资源互换文件格式"（RIFF，Resources Interchange File Format）存放，WAV、AVI 都是它的衍生物（章节 一）。RIFF 是树状结构，基本构成单位叫**块（chunk）**，每个块由三部分组成（章节 一）：

```text
+--------------------- 一个 chunk（长度 = 数据大小 + 8） ---------------------+
| 辨别码 (4 字节)      |  数据大小 (4 字节)     |  数据 (数据大小 字节)        |
| 4 个 ASCII 字符      |  紧跟数据的长度,Byte   |  实际内容                  |
+---------------------+------------------------+----------------------------+
 例: "fmt "               0x10 = 16                波形参数结构体
```

要点（章节 一）：

- **辨别码**是 4 个 ASCII 字符，如 `"fmt "`（注意最后一个空格）
- **数据大小本身占 4 字节**，所以一个 chunk 总长度 = 数据大小 + 8
- chunk 一般不允许再含 chunk，但 **"RIFF" 和 "LIST" 两个例外**可以嵌套——它们会从数据里切出 4 字节作**格式辨别码**；且整个文件**只能有一个 "RIFF" chunk**（章节 一）

> 💡 教材给的类比很妙（章节 一）：**RIFF chunk = 硬盘根目录，格式辨别码 = 盘符（C: 或 D:），LIST chunk = 子目录，普通 chunk = 文件**。RIFF 文件就是"规定好目录里能放什么"的一套规则。你解析 WAV 时，其实就是沿着这套目录树找你要的文件。

## 2. WAV 文件结构：RIFF 'WAVE' 的两个子块

WAVE 文件是最简单的一种 RIFF 文件，格式类型（格式辨别码）是 `"WAVE"`。RIFF 块里只含两个子块：`"fmt "` 和 `"data"`（章节 二）：

```text
+-------------------------------------------------------------+
|  "RIFF"  |  数据大小  |  "WAVE"                              |   ← 外层 RIFF 块
+-------------------------------------------------------------+
|  "fmt "  |  大小      |  PCMWAVEFORMAT 结构                   |   ← 波形格式子块
+-------------------------------------------------------------+
|  "data"  |  大小      |  声音数据（采样样本）                  |   ← 音频数据子块
+-------------------------------------------------------------+

  "fmt " 块大小 = sizeof(PCMWAVEFORMAT)，数据体就是该结构
  "data" 块大小 = 音频数据的字节数
```

你解析 WAV 时只做两件事：找到 `"fmt "` 读出参数，找到 `"data"` 读出采样。跟第 10 课解析 BMP 的"找头 → 定位数据"是同一套思路。

## 3. WAVEFORMAT / PCMWAVEFORMAT：六个关键字段

`"fmt "` 块的数据体是 `PCMWAVEFORMAT` 结构（章节 二）：

```c
/* WAVEFORMAT：波形格式（14 字节） */
typedef struct {
    WORD  wFormatTag;        /* 编码格式：1 = WAVE_FORMAT_PCM（无压缩 PCM） */
    WORD  nChannels;         /* 声道数：1 单声道，2 双声道 */
    DWORD nSamplesPerSec;    /* 采样频率（每秒采样次数），如 44100 */
    DWORD nAvgBytesPerSec;   /* 每秒数据量 = nChannels × nSamplesPerSec × wBitsPerSample / 8 */
    WORD  nBlockAlign;       /* 块对齐 = nChannels × wBitsPerSample / 8，一次要处理的样本字节数 */
} WAVEFORMAT;

/* PCMWAVEFORMAT = WAVEFORMAT + 采样位数（16 字节） */
typedef struct {
    WAVEFORMAT wf;           /* 波形格式 */
    WORD       wBitsPerSample; /* 每个声道每样本的位数，如 16 */
} PCMWAVEFORMAT;
```

逐字段怎么用（章节 二）：

- **wFormatTag = 1**：PCM 无压缩。其他值（如 ADPCM）得先解压才能播放——本课只处理 PCM
- **nSamplesPerSec**：44100 就是"每秒采 44100 个点"，它决定了播放节奏（配合定时器/DMA）
- **nAvgBytesPerSec**：播放软件用它估算缓冲区大小，也等于"一秒钟吃掉多少数据"
- **nBlockAlign**：一个采样帧（含所有声道）的字节数，读数据时按它整块读
- **wBitsPerSample**：采样位深，16 位就是每个样本 2 字节，各声道一致

## 4. 采样数据布局：16 位单声道/双声道

`"data"` 块里的样本排列取决于声道数（章节 二）：

```text
# 16 位单声道：样本一个个顺序排
| 采样1 低字节 | 采样1 高字节 | 采样2 低字节 | 采样2 高字节 | ...

# 16 位双声道：左右声道交替出现（interleave）
| 左1 低 | 左1 高 | 右1 低 | 右1 高 | 左2 低 | 左2 高 | 右2 低 | 右2 高 | ...

# 都是小端序：低字节在前。一个"帧" = nBlockAlign 字节（双声道 = 4 字节）
```

> ⚠️ 和 BMP 的 BGR 一样，音频也有字节序坑：WAV 里 16 位样本**低字节在前（小端）**。在 STM32 上直接按 uint16_t 读其实正好对齐（Cortex-M 就是小端），但如果你做数据校验、把文件挪到大端环境，就必须交换高低字节——看到 `0x2C 0x01` 要能读出 `0x012C = 300`，而不是 0x2C01。

## 5. 实例分析：逐字节读一个 WAV

教材给了一个真实的 WAV 文件头十六进制转储（实例分析），逐字段拆开：

```text
偏移   十六进制数据                            ASCII    解读
0000   52 49 46 46 0A 06 01 00 57 41 56 45   RIFF....  "RIFF" + 块大小 + "WAVE"
000C   66 6D 74 20 10 00 00 00 01 00 02 00   fmt ....  "fmt " + 块大小 0x10 = 16
0018   44 AC 00 00 10 B1 02 00 04 00 10 00   D........  nSamplesPerSec=0xAC44=44100
0024   64 61 74 61 E6 05 01 00 00 00 00 00   data....  "data" + 块大小 0x000105E6=67046
```

| 偏移 | 字段 | 值（小端展开） | 含义 |
|------|------|----------------|------|
| 00H | RIFF 标志 | "RIFF" | RIFF 容器 |
| 04H | 块大小 | 0x0001060A = 67082 | RIFF 块数据长度 = 文件大小 - 8 |
| 08H | 格式辨别码 | "WAVE" | 这是一个 WAV 文件 |
| 0CH | 子块标志 | "fmt " | 波形格式子块（注意尾空格） |
| 10H | fmt 块大小 | 0x10 = 16 | 数据体 = PCMWAVEFORMAT（16 字节） |
| 14H | wFormatTag | 0x0001 | WAVE_FORMAT_PCM，无压缩 |
| 16H | nChannels | 0x0002 | 双声道 |
| 18H | nSamplesPerSec | 0x0000AC44 = 44100 | CD 级采样率 |
| 1CH | nAvgBytesPerSec | 0x0002B110 = 176400 | = 44100 × 2 × 16/8 ✓ |
| 20H | nBlockAlign | 0x0004 | = 2 × 16/8 = 4 字节/帧 |
| 22H | wBitsPerSample | 0x0010 = 16 | 每样本 16 位 |
| 24H | 子块标志 | "data" | 音频数据子块 |
| 28H | data 块大小 | 0x000105E6 = 67046 | 音频数据字节数 |

数据互相咬合验证：176400 = 44100×2×16/8 ✓；4 = 2×16/8 ✓。时长 = 67046 ÷ 176400 ≈ **0.38 秒**。这段声音就是"44.1kHz、16 位、双声道、不到半秒"的一小段 PCM。

> 💡 这套"字段互相验证"的读法就是嵌入式工程师的第六感：解析任何文件，拿到数据先算一算是否自洽（每秒字节数 = 采样率×声道×位深/8？块对齐对不对？）。对不上说明读错了字段或字节序。第 10 课我们验证过 BMP 的 bfSize，这里再验一遍，习惯就养成了。

## 6. 代码示例

示例 1：RIFF 通用 chunk 头 + WAV 结构体。chunk 头是 RIFF 世界的"通用文件头"，BMP 没有这层——这就是 WAV 比 BMP 多出来的容器层。

```c
/* 第 11 课：RIFF / WAV 结构定义 */
#include <stdint.h>

/* RIFF chunk 通用头：8 字节。辨别码 + 数据大小，数据紧跟其后 */
typedef struct {
    uint8_t  ckID[4];      /* 4 字节辨别码，如 "RIFF"/"fmt "/"data" */
    uint32_t ckSize;       /* 数据大小（不含这 8 字节），小端 */
} __attribute__((packed)) RIFF_CHUNK;

/* "fmt " 块的数据体：PCMWAVEFORMAT（16 字节） */
typedef struct {
    uint16_t wFormatTag;      /* 1 = PCM */
    uint16_t nChannels;       /* 1/2 */
    uint32_t nSamplesPerSec;  /* 44100 */
    uint32_t nAvgBytesPerSec; /* 每秒字节数 */
    uint16_t nBlockAlign;     /* 帧字节数 */
    uint16_t wBitsPerSample;  /* 位深 */
} __attribute__((packed)) PCMWAVEFORMAT;

/* 常用校验宏：检查读到的头是不是 "RIFF"（小端内存比较） */
#define IS_RIFF(p)  ((p)[0]=='R' && (p)[1]=='I' && (p)[2]=='F' && (p)[3]=='F')
```

示例 2：沿 chunk 链遍历，找 `"fmt "` 和 `"data"`。这段逻辑和 BMP 的"跳 bfOffBits"同源，但更通用——它顺着 chunk 大小一路往下跳，以后解析 AVI、其他 RIFF 文件全是它。

```c
/* 第 11 课：遍历 RIFF 子块，取出 fmt 参数和 data 位置 */
/* 假设 file 已打开并停在 RIFF 头之后（偏移 12，即跳过 "RIFF"+大小+"WAVE"） */
int riff_find_data(FIL *fp, PCMWAVEFORMAT *wfmt,
                   uint32_t file_size, uint32_t *data_pos, uint32_t *data_len)
{
    RIFF_CHUNK ck;
    UINT br;
    uint32_t pos = 12;   /* 跳过 "RIFF"(4) + 大小(4) + "WAVE"(4) */

    while (pos + 8 <= file_size) {
        f_lseek(fp, pos);
        f_read(fp, &ck, sizeof(ck), &br);

        if (memcmp(ck.ckID, "fmt ", 4) == 0) {
            f_read(fp, wfmt, sizeof(*wfmt), &br);   /* 读波形参数 */
        } else if (memcmp(ck.ckID, "data", 4) == 0) {
            *data_pos = pos + 8;                     /* 音频数据起点 */
            *data_len = ck.ckSize;                   /* 音频字节数 */
            return 0;
        }
        pos += 8 + ck.ckSize;                        /* 跳到下一个 chunk */
    }
    return -1;   /* 没找到 data */
}

/* 验证要点：读出的 wfmt.nAvgBytesPerSec 应等于
   nSamplesPerSec * nChannels * wBitsPerSample / 8，不符就是读错位了 */
```

## 动手练习（约 20 分钟）

### 练习 11.1：解剖一个真实 WAV

1. 用录音机（或画图工具生成的音频）导出一小段 WAV，用 WinHex / VS Code Hex 插件打开。
2. 对照第 5 节表格，逐字节读出全部参数：RIFF 块大小、fmt 块大小、wFormatTag、nChannels、nSamplesPerSec、nAvgBytesPerSec、nBlockAlign、wBitsPerSample、data 块大小。
3. 验收：验证 nAvgBytesPerSec = nSamplesPerSec×nChannels×wBitsPerSample/8，nBlockAlign = nChannels×wBitsPerSample/8，再算算这段音频时长。

### 练习 11.2：用 C 扫描 chunk 链

1. 用第 10 课搭好的 FATFS + SD 卡环境，把示例 2 的 `riff_find_data()` 跑起来，读 SD 卡上的 `TEST.WAV`。
2. 打印出 wfmt 的六个字段，和练习 11.1 用 Hex 工具读到的值对比，必须完全一致。
3. 思考题：如果播放 2 秒这段音频，需要为 `data` 数据准备多大的缓冲区？（提示：nAvgBytesPerSec × 2）

## 自测（答完再点答案）

### 随堂小测

**Q1. 一个 chunk 的总长度是？**

- A. 数据大小
- B. 数据大小加 8
- C. 数据大小加 4

<details><summary>查看答案</summary>

B。辨别码 4 字节 + 数据大小 4 字节 + 数据，共"数据大小 + 8"（章节 一）。

</details>

**Q2. WAV 文件里格式辨别码 "WAVE" 出现在哪？**

- A. 每个子块的辨别码位置
- B. "fmt " 块的数据体里
- C. 外层 RIFF chunk 数据的最前面 4 字节

<details><summary>查看答案</summary>

C。RIFF/LIST 块从数据中切出 4 字节作格式辨别码，WAVE 文件就是 "WAVE"（章节 一/二）。

</details>

**Q3. wFormatTag = 1 表示什么？**

- A. 16 位采样
- B. 无压缩的 PCM 音频
- C. 双声道

<details><summary>查看答案</summary>

B。1 = WAVE_FORMAT_PCM，表示波形数据是未压缩的 PCM（章节 二）。

</details>

**Q4. 16 位双声道 WAV 中，样本的排列顺序是？**

- A. 全部左声道，再全部右声道
- B. 左右声道交替：左1右1左2右2…，每样本低字节在前
- C. 按采样时间倒序排列

<details><summary>查看答案</summary>

B。多声道样本交替出现，16 位每样本 = 低字节+高字节（小端）（章节 二）。

</details>

## 推荐阅读

- 📖 《WAV 文件格式分析与应用》全文——本课全部依据（RIFF 概念、WAV 结构、实例分析 hexdump）
- 🔧 Windows 自带录音机 + WinHex / VS Code Hex 插件——练习 11.1 的素材与工具

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 12 课——WAV 播放器！把本课解析出的参数喂给 STM32 的 DAC + DMA + 定时器，让 SD 卡里的 PCM 数据真正变成声音从喇叭里放出来。

| [← 上一课](/my-blog/posts/toolbox/0010-bmp-parser-in-action/) | [课程目录](/my-blog/posts/toolbox/00-总览/) | [下一课 →](/my-blog/posts/toolbox/0012-wav-player/) |