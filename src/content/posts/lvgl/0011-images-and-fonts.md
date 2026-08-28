---
title: 图片与字库 — 让界面"有图有字"
published: 2026-08-27
description: 第 11 课：从纯文字界面到图文并茂——UTF-8 与图标字体、C 字库与文件字库两条路、img/imgbtn/animimg 图片部件、BMP/PNG/JPEG/GIF 解码库全家桶。
tags: [LVGL, 嵌入式, GUI, 图片, 字库, 图标字体, 解码库]
category: LVGL
draft: false
prevTitle: 综合项目 — 打造你的"智能设备控制台"
prevSlug: "lvgl/0012-final-project"
nextTitle: 容器与导航
nextSlug: "lvgl/0010-containers-and-navigation"
---

# 图片与字库 — 让界面"有图有字"

从纯文字界面到图文并茂：中文与图标字体、自定义字库两条路、图片部件、帧动画、解码库全家桶。

**本课目标：**前面十课你一直在跟"文字 + 色块"打交道，本课把"好看"补齐：中文显示、图标字体、自定义字库、图片显示与动画。学完你能给任何页面配上图标、中文和图片，并清楚什么时候该用 C 数组、什么时候该走文件系统。这是产品界面（下一课综合项目）的素材库。

## 1. 文字基础：UTF-8 与内置字体、图标字体

先解决一个隐藏前提：**中文能不能显示，取决于编码**。LVGL 支持 ASCII 和 UTF-8 两种编码（PDF 8.1 节 (PDF p.136)），你工程里 `lv_conf.h` 的 `LV_TXT_ENC` 已经是 `LV_TXT_ENC_UTF8`（lv_conf.h:440），所以只要你的编辑器用 UTF-8 保存源码，`lv_label_set_text` 直接写中文就行，不用额外配置。

但"能显示中文"不等于"有中文字库"——内置的 Montserrat 字体只有西文字符。你的工程目前只使能了 `LV_FONT_MONTSERRAT_14`（`LV_FONT_DEFAULT` 指向它，lv_conf.h:410）。想换字号就去 lv_conf.h 打开对应宏；字号越大占 Flash 和 RAM 越多，够用就好（PDF 8.3 节 (PDF p.139)）。

图标字体是"不用图片的图标"：它把图标做成字体里的特殊字符，随文本一起渲染（PDF 8.2 节 (PDF p.136)）。全部符号枚举在 `lv_symbol_def.h` 里，常用的有 `LV_SYMBOL_HOME / SETTINGS / PLAY / WIFI / BATTERY_FULL / BELL` 等 60 多个。用法就是拼进字符串：

```c
/* 图标字体：字符拼进文本即可 */
lv_obj_t *btn = lv_btn_create(lv_scr_act());
lv_obj_t *lbl = lv_label_create(btn);
lv_label_set_text(lbl, LV_SYMBOL_HOME " 主菜单");   /* 图标 + 文本拼接 */
lv_obj_center(lbl);

/* 内置字库：当前只有 montserrat_14 使能，想换字号先去 lv_conf.h 开宏 */
lv_obj_t *t = lv_label_create(lv_scr_act());
lv_obj_set_style_text_font(t, &lv_font_montserrat_14, LV_STATE_DEFAULT);
lv_label_set_text(t, LV_SYMBOL_SETTINGS " Settings");
```

> 💡 图标字体是"免费的图标库"：不占 Flash 图片空间、任意着色、任意字号。做菜单、状态栏、按钮装饰，先想它，再想图片。

## 2. 自定义字库：C 数组（内部）与文件系统（外部）两条路

内置字库没有汉字，所以中文得自己造字库。LVGL 提供两条路（PDF 8.4 节 (PDF p.140)）：**① C 语言数组（内部读取）**和 **② 文件系统读取（外部 .bin）**。小字库走 C 数组最省事，大字库走文件系统省 RAM。

### 2.1 路线 A：C 数组字库（推荐先学这个）

用 LVGL 官方的**在线字体转换器**（[lvgl.io/tools/fontconverter](https://lvgl.io/tools/fontconverter)）把 TTF 转成 C 数组。七个关键项（PDF 8.4.1 节 (PDF p.140)）：

- **Name**：字库名，之后 `LV_FONT_DECLARE` 要用它，别用中文名
- **Size**：像素字号；**Bpp**：抗锯齿深度，一般 4 即可，越大越占内存
- **Range**：字符范围，只填 `0x20-0x7E`（西文字符+标点），别贪多
- **Symbols**：直接填你要用的汉字，例如 `你好LVGL`
- 选好 TTF 文件 → **Convert** → 下载 `xxx.c` → 加入工程 → 声明调用

```c
#include "my_Font16.h"        /* 转换器生成的字库文件，加入工程编译 */

LV_FONT_DECLARE(my_Font16)    /* 声明：名字必须和转换时的 Name 一致 */

void font_demo_create(void)
{
    lv_obj_t *label = lv_label_create(lv_scr_act());
    lv_obj_set_style_text_font(label, &my_Font16, LV_STATE_DEFAULT);
    lv_label_set_text(label, "你好 LVGL");   /* 只有转换时选中的字符才显示 */
    lv_obj_center(label);
}
```

### 2.2 路线 B：文件系统字库

中文字库动辄几百 KB，塞进 C 数组会撑爆 Flash。这时把字库转成 `.bin` 放 SD 卡，运行时用 `lv_font_load("盘符:/xxx.bin")` 加载（对应源码 lv_font_loader.h，加载失败返回 NULL，用完 `lv_font_free` 释放）。

但前提是 **LVGL 侧的文件系统得先接通**。你的工程现状要如实交代：`LV_USE_FS_FATFS` 是 0（lv_conf.h:644），`lv_port_fs.c` 还是官方模板（整个文件被 `#if 0` 关着，模板盘符写的是 'P'）。好消息是 LVGL 源码里自带现成的官方 FatFS 驱动 `src/extra/libs/fsdrv/lv_fs_fatfs.c`，接法只有三步：

```c
/* ① lv_conf.h：打开官方 FatFS 驱动。盘符必须和 f_mount 的卷号一致！
 *    本工程 BSP/SD_CARD/sd_card.c 里挂载的是 "0:"，所以字母用 '0' */
#define LV_USE_FS_FATFS 1
#define LV_FS_FATFS_LETTER '0'

/* ② main.c 初始化段：lv_init() 之后挂载 SD 卡 */
SD_Mount();                   /* 内部就是 f_mount(&SDFatFS, "0:", 1) */

/* ③ lv_extra_init 发现 LV_USE_FS_FATFS != '\0' 会自动调用 lv_fs_fatfs_init()
 *    注册驱动。之后 LVGL 所有文件 API 统一用 "0:/路径" 访问 SD 卡 */

/* 用法：.bin 字库放进 SD 卡，运行时加载 */
lv_font_t *f = lv_font_load("0:/font16.bin");
if (f != NULL) {
    lv_obj_set_style_text_font(label, f, LV_STATE_DEFAULT);
}
```

> ⚠️ **盘符一致性红线**：LVGL 的盘符字母、`f_mount` 的卷号、路径里的前缀三者必须完全一致。本工程 SD 卡挂的是 `"0:"`，所以统一用 `'0'` 和 `"0:/..."`；lv_port_fs.c 模板里的 'P'、教材例程里的 "A:/" 都是"另一套江湖"，混用必然打开失败。## 3. 图片部件 img：三种源 + 四板斧

图片部件的图片来源有三种（PDF 17.2.1 节 (PDF p.239)）：**C 语言数组**（在线图片转换器 [lvgl.io/tools/imageconverter](https://lvgl.io/tools/imageconverter) 生成，`LV_IMG_DECLARE` 声明）、**外部文件**（"0:/APP/my_img.bin"，需要文件系统；原格式如 BMP/PNG 还需要解码库，见第 5 节）、**图标字体**（`LV_SYMBOL_*` 直接当源）。

设置好源之后，还有四板斧可以玩（PDF 17.2.2~17.2.6 节 (PDF p.240)）：

- **缩放**：`lv_img_set_zoom`，256（`LV_IMG_ZOOM_NONE`）= 100%，128 = 一半，512 = 两倍
- **旋转**：`lv_img_set_angle`，角度值 ÷ 10 = 实际度数（转 45° 填 450）；`lv_img_set_pivot` 改旋转中心
- **偏移**：`lv_img_set_offset_x/y`，移出边界会从另一侧绕回来
- **重新着色**：`lv_obj_set_style_img_recolor` + `lv_obj_set_style_img_recolor_opa`，透明度默认 0（看不见效果），配合状态切换可以做出"选中/按下"效果

```c
LV_IMG_DECLARE(img_logo)      /* imageconverter 生成的 C 数组图片 */

void img_demo_create(void)
{
    lv_obj_t *img = lv_img_create(lv_scr_act());

    /* 图片来源之一：C 数组（另两种：文件路径、图标字体） */
    lv_img_set_src(img, &img_logo);

    lv_img_set_zoom(img, 256);            /* 256 = 100% = LV_IMG_ZOOM_NONE */
    lv_img_set_angle(img, 450);           /* 实际角度 = 450 / 10 = 45° */
    lv_img_set_pivot(img, 0, 0);          /* 旋转中心改到左上角 */

    lv_obj_set_style_img_recolor(img, lv_color_hex(0x00A0E9), 0);
    lv_obj_set_style_img_recolor_opa(img, LV_OPA_50, 0);  /* 不着色看不到 */
    lv_obj_center(img);
}
```

> 💡 缩放和旋转是**运行时变换**，每帧都要重算像素，很吃 CPU。静态摆放的图片别转，让设计师直接出好尺寸；只有"转起来"的需求（指针、风扇叶）才用。

## 4. 会"按"的图片：imgbtn 图片按钮与 animimg 帧动画

### 4.1 图片按钮 imgbtn

普通按钮是"色块 + 文字"，图片按钮是"整张图就是按钮"（PDF 28 章 (PDF p.340)）。它支持 6 种状态（`LV_IMGBTN_STATE_RELEASED / PRESSED / DISABLED / CHECKED_*` 等），每种状态可配不同的图；图片只支持 C 数组或文件路径，不支持图标字体。按下时的"动感"靠样式叠加：

```c
LV_IMG_DECLARE(img_btn_normal);
LV_IMG_DECLARE(img_btn_pressed);

void imgbtn_demo_create(void)
{
    lv_obj_t *ib = lv_imgbtn_create(lv_scr_act());

    /* 三张图位：左 / 中 / 右（一般只用中间，左右传 NULL） */
    lv_imgbtn_set_src(ib, LV_IMGBTN_STATE_RELEASED, NULL, &img_btn_normal, NULL);
    lv_imgbtn_set_src(ib, LV_IMGBTN_STATE_PRESSED,  NULL, &img_btn_pressed, NULL);

    /* 按下时叠加"变暗 + 下沉 5px"，手感更好 */
    lv_obj_set_style_img_recolor_opa(ib, LV_OPA_30, LV_STATE_PRESSED);
    lv_obj_set_style_img_recolor(ib, lv_color_black(), LV_STATE_PRESSED);
    lv_obj_set_style_translate_y(ib, 5, LV_STATE_PRESSED);
    lv_obj_center(ib);
}
```

### 4.2 动画图片 animimg

原理就是"多帧连播"：把几张连贯的图按顺序循环展示（PDF 40 章 (PDF p.448)）。注意：`LV_USE_ANIMIMG` 在你工程里目前是 0（lv_conf.h:529），用之前要先打开。

```c
/* 前提：lv_conf.h 里 LV_USE_ANIMIMG 置 1 */
LV_IMG_DECLARE(img_frame0);
LV_IMG_DECLARE(img_frame1);
LV_IMG_DECLARE(img_frame2);

static lv_img_dsc_t *s_frames[] = { &img_frame0, &img_frame1, &img_frame2 };

void animimg_demo_create(void)
{
    lv_obj_t *anim = lv_animimg_create(lv_scr_act());
    lv_animimg_set_src(anim, s_frames, 3);              /* 帧数组 + 帧数 */
    lv_animimg_set_duration(anim, 600);                 /* 一轮 600ms */
    lv_animimg_set_repeat_count(anim, LV_ANIM_REPEAT_INFINITE);
    lv_animimg_start(anim);                             /* 开播 */
    lv_obj_center(anim);
}
```

## 5. 解码库全家桶：BMP / PNG / JPEG(SJPG) / GIF

想让 `lv_img_set_src(img, "0:/xxx.png")` 直接显示原格式文件，就得开解码库。四个开关都在 lv_conf.h 的"解码库"板块，你工程里目前**全为 0**（lv_conf.h:658~668）。打开对应宏、确认源码文件在编译列表里即可，`lv_init` 会自动注册解码器，不用手动 init。

| 解码库 | 使能宏 | 要点（PDF 章节） |
|--------|--------|------------------|
| BMP | `LV_USE_BMP` | 只能从文件加载；颜色格式要和 LV_COLOR_DEPTH(16) 匹配；不支持调色板（42 章 p.458） |
| PNG | `LV_USE_PNG` | 解码内存 = 宽×高×4 字节，是内存大户（43 章 p.464） |
| JPEG | `LV_USE_SJPG` | 普通 jpg 解码吃全图内存；SJPG 是专为嵌入式切片的格式，用 jpg_to_sjpg.py 转换；只解码所需部分，不能缩放旋转（44 章 p.468） |
| GIF | `LV_USE_GIF` | 解码内存 = 宽×高×4（16 位色深时）；无独立 init 函数，创建部件即自动播放（45 章 p.474） |

GIF 用 `lv_gif_create` 系列 API，播放完想重播就 `lv_gif_restart`：

```c
/* 前提：LV_USE_GIF 置 1，并把 lv_gif.c + gifdec.c 加入工程编译 */

void gif_demo_create(void)
{
    lv_obj_t *gif = lv_gif_create(lv_scr_act());
    lv_gif_set_src(gif, "0:/PIC/loading.gif");    /* 文件系统路径 */
    lv_obj_center(gif);
}

/* 播完想再来一遍： */
lv_gif_restart(gif);
```

> ⚠️ **解码库是内存炸弹**：一张 320×240 的 PNG 解码就要 320×240×4 ≈ 300 KB RAM——比你 F407 的全部 SRAM（192 KB）还多，直接死给你看。所以解码库只适合**小图**（几十 KB 级别）；大图要么压缩尺寸，要么用在线工具转 C 数组（无解码开销）。

## 动手练习（约 40 分钟）

### 练习 11.1：生成"你好 LVGL"中文 C 字库并显示

- 1️⃣ 打开 [lvgl.io 在线字体转换器](https://lvgl.io/tools/fontconverter)（服务器在国外，偶尔转换失败，多试几次或换浏览器）。**需要网络。**
- 2️⃣ Name 填 `my_Font16`，Size 填 16，Bpp 选 4；选一个系统 TTF 字体（黑体/雅黑都行）。
- 3️⃣ Range 只填 `0x20-0x7E`，Symbols 填 `你好LVGL`，点 Convert，得到 my_Font16.c。
- 4️⃣ 把 my_Font16.c 加入工程，照第 2.1 节代码写 `font_demo_create()`，在 GuiMenu 里切一个入口调用，编译烧录。
- **观察什么：** "你好 LVGL" 清晰显示；如果把 Symbols 里没转过的汉字（比如"世界"）写进文本，会显示为方框或缺字——这就是"只转了用到的字"的含义。再对比一下工程 Flash 增量，感受中文字库的代价。

### 练习 11.2：从 SD 卡加载图片显示

- 1️⃣ 按第 2.2 节三步接线：lv_conf.h 打开 `LV_USE_FS_FATFS` 并设 `LV_FS_FATFS_LETTER '0'`；main.c 里 lv_init() 后调 `SD_Mount()`；确认 lv_fs_fatfs.c 在工程编译列表里。
- 2️⃣ 用 GIMP/画图做一张**小尺寸**（比如 64×64）BMP 图，24 位色深即可（BMP 解码器会转成 16 位），拷到 SD 卡根目录改名 `test.bmp`。
- 3️⃣ lv_conf.h 打开 `LV_USE_BMP`，确认 lv_bmp.c 参与编译；然后 `lv_img_create` + `lv_img_set_src(img, "0:/test.bmp")`。
- **观察什么：** 图片上屏即成功。若花屏/黑屏 → 检查色深匹配；若完全不显示 → 打开串口日志看是路径问题（盘符/卷号不一致）还是挂载问题（SD_Mount 返回值）。把日志截图，这是排查文件类问题的标准流程。

## 自测（答完再点答案）

### 随堂小测 1

Q1. 想让界面直接显示中文，第一步该做什么？
- A. 确认 lv_conf.h 的 LV_TXT_ENC 是 UTF-8，源码用 UTF-8 保存
- B. 换一块支持中文显示的高端屏幕
- C. 在工程里外挂一个全汉字库文件

<details>
<summary>查看答案</summary>

A。UTF-8 编码（PDF 8.1 节 p.136），本工程 lv_conf.h:440 已就位；但中文字符要显示出来还得有包含该汉字的中文字库。
</details>

Q2. 在线转换器生成的 C 数组字库，调用前必须做什么？
- A. 先 LV_FONT_DECLARE 声明，再用 lv_obj_set_style_text_font 设置
- B. 放进 SD 卡，运行时用 lv_font_load 从文件加载
- C. 把 LV_FONT_DEFAULT 改成任意字体名称

<details>
<summary>查看答案</summary>

A。C 数组字库声明即用（PDF 8.4.1 节 p.140）；B 是文件系统字库的做法，C 不存在这种用法。
</details>

Q3. lv_img_set_zoom(img, 128) 的效果是什么？
- A. 图片放大到原来的两倍大小
- B. 图片缩小到原来的一半大小
- C. 图片不缩放，保持原始尺寸

<details>
<summary>查看答案</summary>

B。256（LV_IMG_ZOOM_NONE）= 100%，128 = 50%，512 = 200%（PDF 17.2.5 节 p.241）。
</details>

Q4. 一张 320×240 的 PNG 解码需要大约多少 RAM？
- A. 约 300 KB，超出 F407 的 SRAM 承受范围，必须控制图片尺寸
- B. 约 75 KB，普通项目可以放心随便用
- C. 约 1.2 MB，只有带外部 SDRAM 的开发板能跑

<details>
<summary>查看答案</summary>

A。宽×高×4 = 307,200 字节 ≈ 300 KB（PDF 43.1 节 p.464），而 F407 全部 SRAM 才 192 KB，所以解码库只适合小图。
</details>

## 推荐阅读

- 📖 正点原子《LVGL 开发指南 V1.5》第 8 章（字库，PDF p.136）、第 17 章（图片，PDF p.239）、第 28 章（图片按钮，PDF p.340）、第 40 章（动画图像，PDF p.448）、第 42~45 章（BMP/PNG/JPEG/GIF 解码库，PDF p.458/464/468/474）——本课全部依据
- 🌐 [LVGL 官方文档 Fonts（v8.3）](https://docs.lvgl.io/8.3/overview/font.html)——字库原理与字体转换细节
- 🌐 [LVGL 官方文档 Images（v8.3）](https://docs.lvgl.io/8.3/overview/image.html)——图片源、变换与着色
- 🛠️ [字体转换器](https://lvgl.io/tools/fontconverter) / [图片转换器](https://lvgl.io/tools/imageconverter)——本课两个练习都靠它们

## 下一步

有问题随时问我（Agent 就是你的老师）。下一课预告：[第 12 课：综合项目](/my-blog/posts/lvgl/0012-final-project/)——把 11 课的知识收拢成一个"智能设备控制台"，那是你的毕业作品。

| [← 上一课](/my-blog/posts/lvgl/0010-containers-and-navigation/) | [课程目录](/my-blog/posts/lvgl/00-总览/) | [下一课 →](/my-blog/posts/lvgl/0012-final-project/) |