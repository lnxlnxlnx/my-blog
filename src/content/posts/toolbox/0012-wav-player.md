---
title: 真机实战：WAV 播放器
published: 2026-08-20
description: 不新增硬件，把工程现成的 DAC 波形机制改造成一台 SD 卡点唱机：解析 WAV 头、按采样率配定时器、8/16 位 PCM 转 12 位缓冲、DMA 双缓冲流畅播放。
tags: [Toolbox, 嵌入式, STM32, WAV, DAC, DMA]
category: Toolbox
draft: false
prevTitle: JPEG 原理：DCT 与量化
prevSlug: "toolbox/0013-jpeg-principles-dct"
nextTitle: RIFF 与 WAV 格式
nextSlug: "toolbox/0011-riff-and-wav"
---

# 真机实战：WAV 播放器

不新增硬件，把工程现成的 DAC 波形机制改造成一台 SD 卡点唱机（工程扩展课）

**本课目标：**第 11 课你认识了 WAV 的 RIFF 结构，这一课动手把它播出来。核心思路一句话：**复用工程里的 DAC + TIM6 + DMA 波形播放机制，把"数学波表"换成"SD 卡里的 PCM 数据"**。学完你能：解析 WAV 头、按采样率配置定时器、把 8/16 位 PCM 转成 12 位 DAC 缓冲、用 DMA 双缓冲实现流畅播放，并做出播放/暂停/停止控制。（预计 45~50 分钟）

## 1. 设计总览：从 SD 卡到喇叭要过几道门

整个链路就三步，和工程已有的波形功能几乎一一对应：

```text
# SD 卡侧 (FATFS)
x.wav ──f_open/f_read──► PCM 字节流 (8 位 或 16 位, 小端)

# 转换: PCM ──► 12 位无符号 DMA 样本
8 位:  sample << 4            // 0..255 → 0..4080
16 位: (sample >> 4) + 2048   // ±32767 → 0..4095

# 播放: DAC + TIM6 + DMA  (和 wave_lib 完全同款)
g_wav_buf[] ──DMA1_Stream5──► DAC1 CH1 (PA4)
TIM6 TRGO 触发, 更新频率 = 采样率 ──► 每个样本播一次
```

对比一下就会发现，我们只是把 `wave_lib.c` 里"生成 1024 点数学波形"这一步，换成了"从 SD 卡读 PCM 并转格式"。其余硬件链路一根线都不用动。

## 2. 复用工程的 DAC 波形机制（先读 BSP\wave_lib.c）

打开 `BSP/WAVE_LIB/wave_lib.c`，你会看到这套现成机制，四个关键事实（务必核对，后面代码全靠它）：

| 事实 | 证据（源码位置） |
|------|------------------|
| DAC 用 **通道 1，引脚 PA4** | `Core/Src/dac.c`：`DAC_TRIGGER_T6_TRGO`，PA4 = DAC_OUT1 |
| **TIM6 触发采样**，不是软件轮询 | dac.c 里 DAC 触发源 = TIM6 TRGO |
| DMA 是 **字宽（32 位）循环模式** | dac.c：`DMA1_Stream5 / Channel7`，`DMA_CIRCULAR`，word 对齐 |
| 样本格式 **12 位右对齐** | `wave_lib.c`：`HAL_DAC_Start_DMA(..., DAC_ALIGN_12B_R)`，缓冲是 `uint32_t g_wave_cur[1024]` |

再看 `Wave_SetFreq()` 的频率逻辑（wave_lib.c:76）：TIM6 时钟 72MHz，更新频率 = 72M / ((PSC+1)×(ARR+1))。它把更新频率设成 `hz × 1024`，缓冲正好 1024 点，所以 **每 1024 个样本转一圈 = 一个完整波形周期**，输出波形频率就是 `hz`。

🎯 这给我们的启发：**播放 WAV 时把 TIM6 更新频率直接设成采样率**（每触发一次播一个样本），DMA 循环跑完一整圈的时间 = 缓冲长度 ÷ 采样率，就是这段声音的真实时长。

> 💡 **DMA 双缓冲的"免费午餐"：**DMA 循环模式自带 Half Transfer（半区完成）和 Transfer Complete（整圈完成）两个中断点。你只要在这两个中断里往"下一半"缓冲塞数据，播放就不中断——这就是教科书里的 **双缓冲（double buffering）**，工程不用改 DMA 配置就天然支持。

## 3. 代码①：解析 WAV 头部（找 fmt 和 data）

第 11 课讲过 RIFF 的 chunk 结构，这里按规矩逐块扫描——因为 `fmt` 和 `data` 中间可能夹着 `LIST`、`fact` 等可选块，靠"固定偏移"读很容易翻车。注意 `fmt` 可能带扩展（size 大于 16 字节），要跳过：

```c
/* ===== 1) WAV 头解析: RIFF / fmt / data ===== */
#pragma pack(1)
typedef struct {
    uint16_t format;    /* 1 = PCM 线性编码 */
    uint16_t channels;  /* 1 = 单声道, 2 = 立体声 */
    uint32_t rate;      /* 采样率: 8000 / 22050 / 44100 ... */
    uint32_t byte_rate; /* 每秒字节数 = rate * block_align */
    uint16_t block_align;
    uint16_t bits;      /* 8 位 / 16 位 */
} WavFmt;
#pragma pack()

static FIL g_file;           /* FATFS 文件对象 */
static WavFmt g_fmt;
static uint32_t g_data_left; /* data 块还剩多少字节没播 */
static uint8_t  g_playing;   /* 播放中标志 */

/* 打开 WAV, 成功后文件指针停在 data 数据区开头 */
static int wav_open(const char *path)
{
    BYTE hdr[12], ck[8];
    UINT br;

    if (f_open(&g_file, path, FA_READ) != FR_OK) return -1;
    if (f_read(&g_file, hdr, 12, &br) != FR_OK || br != 12) return -1;
    if (memcmp(hdr, "RIFF", 4) != 0 || memcmp(hdr + 8, "WAVE", 4) != 0)
        return -1;   /* 不是 RIFF/WAVE 文件 */

    for (;;) {   /* 逐块扫描: fmt 和 data 之间可能有 LIST/fact 等块 */
        if (f_read(&g_file, ck, 8, &br) != FR_OK || br != 8) return -1;
        uint32_t sz = (uint32_t)ck[4]        | ((uint32_t)ck[5] << 8) |
                      ((uint32_t)ck[6] << 16) | ((uint32_t)ck[7] << 24);
        if (memcmp(ck, "fmt ", 4) == 0) {
            if (sz < 16) return -1;
            if (f_read(&g_file, &g_fmt, 16, &br) != FR_OK || br != 16) return -1;
            if (sz > 16) f_lseek(&g_file, f_tell(&g_file) + (sz - 16)); /* 跳扩展 */
        } else if (memcmp(ck, "data", 4) == 0) {
            g_data_left = sz;
            return 0;   /* 文件指针正好停在声音数据开头 */
        } else {
            f_lseek(&g_file, f_tell(&g_file) + sz);   /* 跳过未知块 */
        }
    }
}
```

小端序是 WAV 的硬规矩：`sz` 的低字节在前，所以拼装顺序是 `ck[4] | ck[5]<<8 | ck[6]<<16 | ck[7]<<24`，别写反。

## 4. 代码②：按采样率配置定时器

把 `wave_lib.c` 的 PSC/ARR 动态计算照抄一份，唯一的区别是目标频率直接等于 `nSamplesPerSec`（而不是 hz×1024）。这样每个 TIM6 更新事件正好触发一次 DAC 采样：

```c
/* ===== 2) 采样率 → TIM6 分频 (沿用 wave_lib 的动态 PSC/ARR 思路) ===== */
static void wav_set_rate(uint32_t fs)
{
    /* TIM6 时钟 72MHz, 更新频率 = 72M / ((PSC+1)*(ARR+1)) */
    uint32_t div = 72000000 / fs;
    if (div < 1) div = 1;

    uint32_t psc_div = (div + 65535) / 65536;  /* 让 ARR 不超 16 位上限 */
    if (psc_div < 1) psc_div = 1;

    uint32_t psc = psc_div - 1;
    uint32_t arr = div / psc_div;
    if (arr > 1) arr--; else arr = 0;

    __HAL_TIM_SET_PRESCALER(&htim6, psc);
    __HAL_TIM_SET_AUTORELOAD(&htim6, arr);
}
```

验证一下：8kHz 时 `div = 72M/8000 = 9000`，`psc=0, arr=8999`，更新频率正好 8kHz；44.1kHz 时 `div = 1632`，也精确落在 16 位范围内。

## 5. 代码③：PCM → 12 位缓冲 + 双缓冲填充

DAC 只认 12 位无符号整数，所以无论文件是 8 位还是 16 位，都要先换算（见第 1 节公式）。这一节把"读 SD 卡 + 换算 + 填半区"打包成一个函数，两个 DMA 回调各填一个半区：

```c
/* ===== 3) PCM → 12 位 DAC 缓冲 + 双缓冲填充 ===== */
#define WAV_BUF_SAMPLES  2048              /* DMA 总样本数 (uint32) */
#define WAV_BUF_HALF     (WAV_BUF_SAMPLES / 2)

static uint32_t g_wav_buf[WAV_BUF_SAMPLES]; /* DMA 源: 12 位右对齐 */
static uint8_t  g_pcm[WAV_BUF_HALF * 2];    /* PCM 中转区 */

/* 从 SD 卡读一段 PCM, 转成 12 位样本填进第 half 个半区 */
static uint32_t wav_fill_half(uint32_t half)
{
    if (g_data_left == 0) return 0;         /* 播完了 */

    uint32_t need = (g_fmt.bits == 8) ? WAV_BUF_HALF : WAV_BUF_HALF * 2;
    if (need > g_data_left) need = g_data_left;

    UINT br;
    if (f_read(&g_file, g_pcm, need, &br) != FR_OK) return 0;
    g_data_left -= br;

    uint32_t *dst = g_wav_buf + half * WAV_BUF_HALF;
    uint32_t n = (g_fmt.bits == 8) ? br : br / 2;

    for (uint32_t i = 0; i < n; i++) {
        if (g_fmt.bits == 8) {
            dst[i] = (uint32_t)(g_pcm[i] << 4);   /* 8 位: 0..255 → 0..4080 */
        } else {
            int16_t v = (int16_t)((g_pcm[i*2+1] << 8) | g_pcm[i*2]);
            dst[i] = (uint32_t)((v >> 4) + 2048);  /* 16 位: ±32767 → 0..4095 */
        }
    }
    /* 不足半区时用最后一个样本填满, 防止循环回绕出爆音 */
    if (n > 0) {
        uint32_t last = dst[n - 1];
        for (uint32_t i = n; i < WAV_BUF_HALF; i++) dst[i] = last;
    }
    return br;
}
```

> 💡 **8 位 vs 16 位的换算口诀：**8 位无符号往左挪 4 位（255→4080），16 位有符号往右挪 4 位再加 2048 偏置（把 -32768..32767 整个平移到 0..4095 上）。两个方向都能恰好填满 12 位，一个"浪费"高 4 位、一个"利用"高 4 位——本质都是把波形搬进 DAC 的满量程。

## 6. 代码④：播放控制 + DMA 回调

最后一步把前面的零件组装起来。注意回调是 HAL 的 `__weak` 空函数，工程里直接重写同名函数即可（和工程覆写 `BSP_SD_Init` 一个套路）：

```c
/* ===== 4) 播放 / 暂停 / 停止 + DMA 回调 ===== */
int Wav_Play(const char *path)
{
    if (wav_open(path) != 0) return -1;
    if (g_fmt.format != 1 || (g_fmt.bits != 8 && g_fmt.bits != 16)) return -2;

    wav_set_rate(g_fmt.rate);       /* 定时器频率 = 采样率 */
    wav_fill_half(0);               /* 先预填两个半区再启动 */
    wav_fill_half(1);

    g_playing = 1;
    HAL_DAC_Start_DMA(&hdac, DAC_CHANNEL_1, g_wav_buf,
                      WAV_BUF_SAMPLES, DAC_ALIGN_12B_R);
    HAL_TIM_Base_Start(&htim6);
    return 0;
}

void Wav_Pause(void)  { g_playing = 0; HAL_TIM_Base_Stop(&htim6); }
void Wav_Resume(void) { g_playing = 1; HAL_TIM_Base_Start(&htim6); }

void Wav_Stop(void)
{
    g_playing = 0;
    HAL_TIM_Base_Stop(&htim6);
    HAL_DAC_Stop_DMA(&hdac, DAC_CHANNEL_1);
    if (g_file.fs) f_close(&g_file);   /* 释放文件句柄 */
}

/* DMA 循环: 半区0 放完 → HalfCplt, 半区1 放完 → Cplt */
void HAL_DAC_ConvHalfCpltCallbackCh1(DAC_HandleTypeDef *hdac)
{
    (void)hdac;
    if (g_playing) wav_fill_half(0);   /* 后台补半区0 */
}
void HAL_DAC_ConvCpltCallbackCh1(DAC_HandleTypeDef *hdac)
{
    (void)hdac;
    if (g_playing) wav_fill_half(1);   /* 后台补半区1 */
}
```

双缓冲的时间账要算清楚（工程 RAM 预算）：`g_wav_buf` 2048×4 = 8KB，加上 `g_pcm` 2KB，共 10KB，对 F407 的 192KB RAM 很轻松。44.1kHz 时半区 1024 个样本 ≈ 23ms，SDIO 4 线读 2KB 通常几毫秒——窗口充裕。

> ⚠️ **在 DMA 中断里直接 f_read 是"够用就好"的做法：**中断里做文件系统调用有风险（可重入、优先级、阻塞时长）。严谨的做法是在回调里只置一个"该填数据"的 flag，在主循环或 FreeRTOS 任务里填充。本课示例为了最短路径选择直接调用，你上真机如果遇到爆音/卡顿，第一件事就是把它挪到任务里。另外本代码按**单声道**写：立体声请先做左右声道平均再填缓冲，否则一个样本帧的 4 字节会被拆错位。

## 动手练习（约 20 分钟）

### 练习 12.1：让 F407 唱出第一个 WAV

1. 用 Audacity / 在线工具 / Python 生成一个 8kHz、8 位、单声道的 WAV（比如 1 秒 440Hz 正弦波），复制到 SD 卡根目录。
2. 在工程里加 `wav_player.c/h`，把本课 4 段代码组装好，`main()` 里先 `SD_Mount()` 再 `Wav_Play("0:/test.wav")`。
3. 用示波器或耳机听 PA4 输出，确认音高、时长都对。把采样率从 8k 换成 22.05k 再生成一次，验证播放速度是否随之变化。

### 练习 12.2：串口打印 WAV 参数

1. 在 `wav_open()` 成功后加一行 `printf`，把 `format/channels/rate/bits/data_size` 全打出来。
2. 用十六进制工具（HxD 或 VS Code Hex 插件）手动解析同一文件，验证程序读到的值和文件字节对得上（小端序！）。
3. 思考：如果采样率 44100、16 位、立体声、时长 3 分钟，data 块该多大？用 `byte_rate` 验证一下你的估算。

## 自测（答完再点答案）

### 随堂小测

**Q1. 工程里 Wave_SetFreq(hz) 把 TIM6 更新频率设成 hz×1024，意味着什么？**

- A. 每 1024 次转换输出一个完整波形周期，波形频率 = hz
- B. 采样率被固定成 1024Hz，和波形内容无关
- C. 1024 是 DAC 的位数，与频率毫无关系
- D. TIM6 每 1024 微秒才触发一次采样

<details><summary>查看答案</summary>

A。缓冲 1024 点、TIM6 频率 = hz×1024，所以一圈 = 1/hz 秒，波形频率 = hz（wave_lib.c:76）。

</details>

**Q2. 播放 WAV 时，TIM6 的更新频率应该设成多少？**

- A. 固定 1024Hz，与文件无关
- B. 固定 72MHz 定时器时钟
- C. 等于 WAV 头的采样率 nSamplesPerSec
- D. 等于声道数乘以采样率

<details><summary>查看答案</summary>

C。每触发一次播一个样本，更新频率必须等于采样率，声音才不走样。

</details>

**Q3. 16 位有符号 PCM 要喂给 12 位无符号 DAC，正确做法是？**

- A. 直接赋值，自动丢弃低 4 位即可
- B. 右移 4 位后再加 2048 偏置
- C. 左移 4 位后取绝对值
- D. 除以 16 四舍五入就够了

<details><summary>查看答案</summary>

B。±32767 → (v>>4)+2048 → 0..4095，覆盖 12 位满量程。

</details>

**Q4. 双缓冲（HalfCplt/Cplt 回调后台补数据）解决的核心问题是？**

- A. 把采样率上限提高一倍
- B. 避免 SD 卡读取阻塞导致播放断流
- C. 让程序更省 RAM 内存
- D. 让 WAV 支持立体声播放

<details><summary>查看答案</summary>

B。一边播一边往另一半塞数据，播放与读卡并行，不卡顿。

</details>

## 推荐阅读

- 📖 《WAV 文件格式分析与应用》全文——第 11 课教材，本课 WAV 结构依据（fmt/data 子块、PCM 采样布局）
- 🔧 工程源码：`BSP/WAVE_LIB/wave_lib.c`、`Core/Src/dac.c`、`Core/Src/tim.c`——本课全部复用对象
- 🎵 Audacity / sox——生成测试 WAV 的免费工具

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 13 课——从 WAV 走进 JPEG 世界，先搞懂 DCT 与量化这两个有损压缩的心脏。

| [← 上一课](/my-blog/posts/toolbox/0011-riff-and-wav/) | [课程目录](/my-blog/posts/toolbox/00-总览/) | [下一课 →](/my-blog/posts/toolbox/0013-jpeg-principles-dct/) |