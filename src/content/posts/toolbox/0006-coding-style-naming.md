---
title: 命名与函数
published: 2026-08-14
description: unix 小写下划线命名、g_/p_ 前缀与"模块名_动词"函数结构，函数设计七条军规（单一职责、参数检查、错误处理、static）。
tags: [Toolbox, 嵌入式, STM32, 命名, 函数]
category: Toolbox
draft: false
prevTitle: 变量、宏与常量 + 重构实战
prevSlug: "toolbox/0007-coding-style-vars-macros"
nextTitle: 规范总览与排版注释
nextSlug: "toolbox/0005-coding-style-format"
---

# 命名与函数

见名知义：正点原子《嵌入式单片机 C 代码规范与风格 V1.1》第 3、4 章（PDF p.16~19）

**本课目标：**命名是代码的"说明书"。学完你能按 unix 风格（小写下划线）给文件、变量、函数、宏起名，理解 `g_`/`p_` 前缀和"模块名_动词"的函数结构，并掌握函数设计的七条军规（单一职责、参数检查、错误处理、static 等）。练习直接给你自己的 `gui_menu.c` 做"命名体检"。本课约 45~60 分钟。

## 1. 命名总则：清晰是第一位的

正点原子采用大部分软件工程师通用的 **unix 风格**命名（Linux 内核同款）：**单词小写，用下划线连接**，例如 `read_adc1_value()`（PDF p.16）。几条注意事项：

- **命名一定要清晰**：用完整的单词或公认缩写，让人一读就懂。`int book_number;` 可以，`int bkn;` 不行
- **不要随意缩写，更不要用汉语拼音！**（教材原话打了三个感叹号）
- **互斥语义用互斥词组**：add/remove、begin/end、create/destroy、get/release、lock/unlock、open/close、show/hide、send/receive…看到 get 就该想到有 release
- 移植第三方驱动代码时，**保持原风格**，别强行改成自己的
- **禁止单字节命名变量**，唯一例外：i、j、k 作为局部循环变量

```c
/* 反例：猜谜游戏 */
int n;                /* n 是什么？*/
int wjgs;             /* 拼音缩写，人神共愤 */
int a = 1, b = 2;     /* a/b 意义不明 */

/* 正例：见名知义 */
int book_number;              /* 图书数量 */
int number_of_book;           /* 一样合格 */
int max_level;                /* 最大关卡 */
int i;                        /* 循环变量，唯一被允许的单字节 */
```

## 2. 文件命名与变量命名

文件统一**小写命名**（PDF p.16）：你的 `lvgl_2048.c`、`gui_menu.c`、`lvgl_snake.c` 都合格。

变量命名（PDF p.16）：

- 单词小写 + 下划线连接；**不要用匈牙利命名法**（bFlag、nCount 那种）
- **尽量避免全局变量**；实在要全局，用 `g_` 前缀（如你的 `gui_menu.c` 里 `AppState g_app`，✅ 教科书级示范）；指针变量可用 `p_` 前缀（教材例：`p_gpiox`）
- 文件内私有的全局变量用 `static` 修饰（你代码里的 `static uint16_t snake_length;` ✅）
- **数据类型统一用 stdint 固定宽度类型**：u8/u16/u32 弃用，改用 `uint8_t/uint16_t/uint32_t` 及有符号 `int8_t/…/int64_t`——你的 2048 和 snake 代码早已全部用 `uint8_t` 等，✅ 直接过关

```c
/* 反例：匈牙利 + 拼音混合风 */
u8 bFlag;            /* 类型前缀, 教材明确不用 */
uint16_t xz;         /* 像素?? 开关?? */
char *chpStr;        /* 匈牙利指针, 谢绝 */

/* 正例：unix 风格 + 前缀表意 */
uint8_t flag;              /* 普通局部变量 */
int16_t g_cur_temp;        /* 全局变量, g_ 开头 */
char *p_name_buf;          /* 指针变量, p_ 开头 */
static uint32_t rng_state; /* 文件私有, static */
```

## 3. 函数命名与宏命名

函数命名和变量一样（PDF p.17）：小写 + 下划线。**嵌入式最实用的结构是"模块名_动词"**，模块归属一目了然，还能靠编辑器的自动补全把同一模块的函数聚在一起：

- `lcd_clear()`、`lcd_show_string()` —— LCD 模块
- `lvgl_snake_init()`、`lvgl_snake_set_dir()` —— 你工程里现成的 ✅ 典范
- 内部私有函数直接动词化（`menu_create`、`update_labels`），只要语义清晰也可以

宏命名（PDF p.17）：**常量宏全大写 + 下划线**，如 `#define PI_ROUNDED 3.14`。你的 `GAME_2048_EE_ADDR_BASE`、`LVGL_2048_GRID_SIZE` ✅。

```c
/* 反例：从你自己的 gui_menu.c 里挑的 */
void GuiMenu_Init(void)       /* PascalCase, 与同文件其他函数不一致 */
void GuiMenu_Navigate(int8_t) /* 大写风格, 教材不认可 */
void menu_create(void)        /* 小写, 但同文件两套风格并存 */

/* 正例：统一成模块名_动词 */
void gui_menu_init(void)
void gui_menu_navigate(int8_t dir)
void gui_menu_create(void)
```

> ⚠️ 反例的代码就是真的——你的 `gui_menu.c` 里 `GuiMenu_Init`（PascalCase）和 `menu_create`（小写）同时存在。不是哪个错，是**不一致**。规范的意义不在于某一种风格更高贵，而在于一个文件里只能有一种风格。第 4 节原则 3 说"公司内部代码风格必须统一"，对你自己 3000 行的工程同样适用。

## 4. 函数设计：简短与单一职责

第四章开篇就是硬指标（PDF p.18）：**函数要简短、漂亮，并且只能完成一件事**；本地变量最好不超过 5~10 个，否则就要重新构思、拆分成更小的函数。配套规则：

- **一个函数只做一个功能**：和函数无关或关联很弱的代码不要塞进来，职责不清的函数最难改
- **重复代码提炼成函数**："明明说一遍就能记住的事，非要说好几遍"——重复代码一定要消灭
- **不同函数之间用空行隔开**
- **嵌套不能过深，新增代码不超过 4 层**（if/for/while 互相包含的深度），嵌套太深烧脑

```c
/* 反例：一个函数干三件事, 本地变量 12 个 */
void game_new_game(void)
{
    /* 第一件事: 读 EEPROM 最高分 */
    uint8_t buf[5] = {0};
    at24cxx_init();
    at24cxx_read(90, buf, 5);
    uint32_t best = buf[1] | (buf[2] << 8);
    /* 第二件事: 生成两个随机块 */
    for (int i = 0; i < 2; i++)
    {
        uint32_t rnd = rng_state * 1103515245u + 12345u;
        rng_state = rnd;
        board[rnd % 16 / 4][rnd % 4] = 2;
    }
    /* 第三件事: 刷 UI */
    ...
}

/* 正例：拆成四个函数, 各司其职 —— 你的 lvgl_2048.c 实际就是这样拆的 ✅ */
static void load_best_score(void);      /* EEPROM */
static void add_random_tile(void);      /* 随机块 */
static void update_labels(void);        /* UI */
void lvgl_2048_new_game(void)           /* 只做编排 */
{
    memset(board, 0, sizeof(board));
    score = 0;
    game_over = false;
    game_won = false;
    add_random_tile();
    add_random_tile();
    update_labels();
}
```

## 5. 函数设计：参数、错误与 static

剩下几条同样在 PDF p.18~19：

- **对参数做合法性检查**：指针参数不检查，传入野指针直接崩溃；范围参数不检查，可能算到溢出。STM32 官方库函数就普遍做参数检查
- **对错误返回做全面处理**：函数用返回值报告错误，调用方必须处理，不能无视
- **函数集中退出**：当一个函数从多处退出且都需要做清理时，用 `goto` 集中到出口标签（Linux 源码大量这么用）；不需要清理就直接 `return`
- **文件内私有的函数一律 static**：只在同文件被调用的函数必须加 `static`，避免和其他库的同名函数混淆（你代码里的 `load_best_score`/`menu_create` 等都是 static ✅）

```c
/* 正例: 参数检查 + 错误处理 + 集中退出 */
int sd_read_sector(uint8_t *buf, uint32_t sector, uint32_t count)
{
    int res = 0;
    char *temp_buf = NULL;

    if (buf == NULL || count == 0)         /* 参数合法性检查 */
    {
        return -EINVAL;
    }

    temp_buf = malloc(SECTOR_SIZE * count);
    if (temp_buf == NULL)
    {
        return -ENOMEM;
    }

    if (res = sd_read_disk(temp_buf, sector, count))  /* 错误返回要处理 */
    {
        goto out;                          /* 集中退出 */
    }
    memcpy(buf, temp_buf, SECTOR_SIZE * count);

out:
    free(temp_buf);
    return res;
}
```

## 6. 工程实例：给你的代码做"命名体检"

用本课规则把你的三个 LVGL 应用文件过一遍，结果是喜忧参半：

| 位置 | 现状 | 诊断 |
|------|------|------|
| `gui_menu.c` 的 `g_app` | 全局变量带 `g_` 前缀 | ✅ 符合教材 3.3 |
| `gui_menu.c` 的 `GuiMenu_Init/Enter/Navigate` | PascalCase | ⚠️ 违反 unix 风格，且与同文件 `menu_create` 不一致 |
| `lvgl_2048.c` 的 `lvgl_2048_init/move` | 模块名_动词 | ✅ 教材 3.4 典范 |
| `lvgl_2048.c` 的 `load_best_score` 等 | 小写清晰，但缺模块前缀 | ⚠️ static 私有可接受；若要对外则应为 `lvgl_2048_load_best_score` |
| `lvgl_snake.c` / `lvgl_2048.c` 的 `rng_next/rng_seed` | 两个文件各抄了一份 | ⚠️ 违反第 4 章"重复代码提炼成函数" |
| 宏 `GAME_2048_EE_ADDR_BASE` 等 | 全大写 + 下划线 | ✅ 符合教材 3.5 |

> 💡 改名是小事，改引用才是大事。重命名对外函数时，先全工程 `Find in Files`（MDK 快捷键 Ctrl+Shift+F）搜出所有调用点，**头文件声明、调用处、定义处三处同步改**，改完立即全量编译验证。

## 动手练习（约 30 分钟）

### 练习 6.1：给 gui_menu.c 做命名体检并重命名

1. 列出 `gui_menu.c` 里所有函数和全局变量的名字，按"unix 小写 / 模块前缀 / 语义清晰"三列打勾。
2. 把 `GuiMenu_Init / GuiMenu_Navigate / GuiMenu_Enter` 统一重命名为 `gui_menu_init` 等（模块前缀 `gui_menu_`）。
3. 用 Find in Files 找出头文件 `gui_menu.h` 及 main 里所有调用点，三处同步改。

**验收标准：**全工程搜不到 `GuiMenu_` 前缀；编译零警告零错误；重新烧录后菜单、翻页、进入游戏功能全部正常。

### 练习 6.2（重构练习）：把重复的三连循环拆成函数

1. 打开 `lvgl_2048.c` 的 `lvgl_2048_move()`（约 50 行）：左右移动和上下移动各有"读行 → slide_and_merge_line → 写回"三连，**复制粘贴了两遍**。
2. 提炼两个小函数：`static void board_read_line(uint8_t row_or_col, bool is_row, uint16_t *line, lvgl_2048_dir_t dir)` 和 `static void board_write_line(...)`，让 `lvgl_2048_move()` 四个方向共用一套逻辑。
3. 改完跑一轮 2048：上下左右滑动、合并、加分、新方块、Game Over 全部正常。

**验收标准：**`lvgl_2048_move()` 体长明显下降；代码里不再出现方向循环的重复块；游戏行为与改动前完全一致。

## 自测（答完再点答案）

### 随堂小测

**Q1. 正点原子采用的命名风格是？**

- A. unix 风格：小写 + 下划线
- B. PascalCase：单词首字母大写
- C. 匈牙利命名法：类型前缀

<details><summary>查看答案</summary>

A。unix 风格（Linux 内核同款），匈牙利和 PascalCase 都不是（PDF p.16）。

</details>

**Q2. 全局变量的推荐前缀是？**

- A. s_ 开头
- B. g_ 开头
- C. 不用前缀

<details><summary>查看答案</summary>

B。全局变量用 g_ 前缀提高可读性，指针可用 p_（PDF p.16）。

</details>

**Q3. 以下哪个函数名符合教材规范？**

- A. SetSnakeDirection()
- B. setdir_snake_lvgl()
- C. lvgl_snake_set_dir()

<details><summary>查看答案</summary>

C。"模块名_动词"，小写 + 下划线（PDF p.17）。

</details>

**Q4. 只在文件内部调用的函数，应该？**

- A. 加 static 限定作用域
- B. 声明在头文件里
- C. 加上 extern 关键字

<details><summary>查看答案</summary>

A。static 确保只在声明它的文件可见，避免与其他库同名函数冲突（PDF p.19）。

</details>

## 推荐阅读

- 📖 正点原子《嵌入式单片机 C 代码规范与风格 V1.1》第 3、4 章（PDF p.16~19）——本课全部依据
- 🔍 对照阅读：Linux 内核的 `Documentation/process/coding-style.rst`——教材说它的风格与 Linux 高度一致
- 🧹 检查你自己的工程：`Find in Files` 搜 `[A-Z][a-z]+_` 模式，抓出所有 PascalCase 命名

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 7 课——变量、宏与常量 + 重构实战。你会亲手把 `lvgl_snake.c` 按规范重构一遍，包括那个缺括号的 `LVGL_SNAKE_MAX_LENGTH`。

| [← 上一课](/my-blog/posts/toolbox/0005-coding-style-format/) | [课程目录](/my-blog/posts/toolbox/00-总览/) | [下一课 →](/my-blog/posts/toolbox/0007-coding-style-vars-macros/) |
