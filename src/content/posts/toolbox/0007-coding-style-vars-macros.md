---
title: 变量、宏与常量 + 重构实战
published: 2026-08-15
description: 变量单一职责与声明即初始化、带参宏副作用与 do{}while(0)、const/枚举替代裸宏，并按问题清单把 lvgl_snake.c 完整重构一遍。
tags: [Toolbox, 嵌入式, STM32, 变量, 宏, 重构]
category: Toolbox
draft: false
prevTitle: 像素与调色板
prevSlug: "toolbox/0008-pixels-and-palette"
nextTitle: 命名与函数
nextSlug: "toolbox/0006-coding-style-naming"
---

# 变量、宏与常量 + 重构实战

把学过的规范用起来：正点原子《嵌入式单片机 C 代码规范与风格 V1.1》第 5、6 章（PDF p.20~24）+ 工程重构

**本课目标：**前两课是"认识规范"，这一课是"用规范"。学完你能写干净的变量声明与初始化、识破带参宏的副作用陷阱、会用 `do{}while(0)` 和 `const`/枚举替代裸宏，并照着"问题清单 → 改命名 → 拆函数 → 加注释"的流程把 `lvgl_snake.c` 重构一遍。本课约 50~60 分钟，重构练习是重头戏。

## 1. 变量：一个变量只能有一个功能

第五章第一条（PDF p.20）：**一个变量只能有一个特定功能**，不能因为取值不同代表不同含义就反复复用——最典型的反面教材：

```c
/* 反例：同一个变量身兼两职 */
int time;
time = 200;         /* 表示时间 */
time = getvalue();  /* 又被用作返回值 —— 谁看谁糊涂 */

/* 正例：各归各 */
int time, ret;
time = 200;
ret = getvalue();
```

紧接着的硬规则：**严禁使用未经初始化的变量作为右值**，且首次使用前的初始化**离使用的地方越近越好**。教材还给了两个更优雅的写法（PDF p.20~21）：

```c
/* 不可取：初始化和声明分离, 变量在 if 前处于"半初始化"状态 */
int num;
if (a)
{
    num = 3;
}
else
{
    num = 4;
}

/* 较好：默认有意义的初始化, 只改需要改的分支 */
int num = 3;
if (a)
{
    num = 4;
}

/* 更好：用 ?: 减少数据流和控制流的混合 */
int num = a ? 4 : 3;
```

> ⚠️ 未初始化变量是 C/C++ 最臭名昭著的错误源。嵌入式里更隐蔽：栈上局部变量初值是随机数，有时"碰巧能用"，换个编译器优化等级就翻车。**声明即初始化**是成本最低的防呆。

## 2. 全局变量：少用，封私有

原则（PDF p.20~21）：

- **不用或少用全局变量**。确实需要跨函数共享时，优先用 `static` 修饰成**文件私有**——模块的私有数据不能作为对外接口，直接访问别的模块的私有数据会增强模块间耦合
- **防止局部变量和全局变量重名**，容易让人误读
- **明确全局变量的初始化顺序**：启动阶段"使用"和"初始化"的时序必须分析清楚（典型坑：BSP 函数在 `SystemInit` 之前被调用）
- **尽量减少不必要的数据类型转换**：转换可能改变数据意义和取值

```c
/* 反例：裸全局变量, 谁都能改, 谁都能坏 */
uint16_t score;      /* 模块私有数据暴露给全工程 */

/* 正例：static 私有 + 函数接口 —— 你的 lvgl_snake.c 就是这么干的 ✅ */
static uint16_t snake_length;             /* 文件私有 */
static uint16_t best_score = 0;           /* 文件私有 */

static uint16_t game_get_score(void)      /* 对外只开函数口子 */
{
    return best_score;
}
```

> 💡 检查你工程里的全局变量：`gui_menu.c` 的 `AppState g_app` 是模块间通信，带 `g_` 前缀合理；但如果一个变量只在单文件内用，就立刻改成 `static`。

## 3. 宏定义规范：命名与括号

第六章（PDF p.22）：**常量宏和枚举标签用大写 + 下划线**；"在定义几个相关的常量时，最好使用枚举"。表达式宏的坑主要是**忘记优先级**——凡是用表达式定义常量，整个表达式必须套一层括号：

```c
#define CONSTANT 0x4000
#define CONSTEXP  (CONSTANT | 3)   /* ✅ 外层括号保护 */

/* 反例：你工程里的真雷 —— lvgl_snake.c 第 8 行 */
#define LVGL_SNAKE_MAX_LENGTH (LVGL_SNAKE_GRID_SIZE * LVGL_SNAKE_GRID_SIZE) / 2

/* 一旦被"除"就翻车 */
float ratio = 1.0f / LVGL_SNAKE_MAX_LENGTH;
/* 展开成 1.0f / 144 / 2, 得到 0.00347f, 而不是预期的 1.0f / 72 = 0.01389f */

/* 正例 */
#define LVGL_SNAKE_MAX_LENGTH ((LVGL_SNAKE_GRID_SIZE * LVGL_SNAKE_GRID_SIZE) / 2)
```

带参宏还有几条禁令（PDF p.22~23）：

- **避免影响控制流程的宏**：宏里写 `return`，会让"调用"它的函数悄悄退出，防不胜防
- **不要定义"可作为左值"的宏**：`FOO(x) = y` 这种用法，一旦宏改成内联函数就崩
- **宏的参数不允许发生变化**：见下节副作用

## 4. 带参宏的副作用与 do{}while(0)

经典副作用（PDF p.22~23）：宏是文本替换，参数被**原样粘贴**，传 `i++` 就会执行多次：

```c
#define SQUARE(a) ((a) * (a))

int a = 5;
int b;
b = SQUARE(a++);   /* 展开为 ((a++) * (a++)), a 被自增两次 */
                   /* 结果 a = 7, 而不是期望的 6 */

/* 应改为: 先自增, 再传参 */
b = SQUARE(a);
a++;               /* 结果 a = 6, 只执行一次 */
```

多语句宏的正确姿势：**函数宏不管几个参数，一定用 `do{}while(0)` 包裹**（PDF p.23~24）。看看不用它的下场：

```c
/* 反例: 多语句宏不加 do{}while(0) */
#define foo(x) fun1(x); fun2(x);

if (!x)
    foo(x);        /* 展开后: if (!x) fun1(x); fun2(x); */
                   /* fun2 在 x 为假时也会执行 —— 静默出错! */

/* 正例: do{}while(0) 结构 */
#define foo(x) do { fun1(x); fun2(x); } while (0)

if (!x)
    foo(x);
else
    bar(x);        /* 展开后语法、逻辑全部正确 */
```

```c
/* 教材里的标准写法: 多语句宏一律 do{}while(0) */
#define DHT11_IO_IN()           \
    do {                        \
        GPIOC->MODER &= ~(3 << (13 * 2)); \
        GPIOC->MODER |= 0 << 13 * 2;      \
    } while (0)
```

> ⚠️ 记死：**能写成内联函数（static inline）的就不要写函数宏**（教材原话）。函数宏没有类型检查、调试器里看不见、展开报错看不懂。只有需要"操作寄存器"这类场景才值得用函数宏。

## 5. 常量：const 与枚举

三条（PDF p.22~23）：

- **常量建议用 const 定义来代替宏**——宏常量没有数据类型，const 有。类型能让编译器帮你抓错（比如把 `uint32_t` 传给 `uint16_t` 参数时报警告）
- **几个相关的常量，用枚举**：一个枚举就是一组互相关联的合法取值，编译器还能做范围检查
- **魔法数字要消灭**：散落在代码里的裸数字，改名/改值都要全局搜，迟早漏一个

```c
/* 反例: 裸魔法数字满天飞 */
if (board[r][c] >= 2048) { ... }   /* 2048 是什么? 胜利阈值? */
uint8_t buf[5];                     /* 5 是什么? 魔数+1? */

/* 正例: const 有类型, 枚举带分组, 宏管配置 */
#define TILE_WIN_VALUE 2048         /* 胜利阈值, 大写常量宏 */
static const uint16_t TILE_EMPTY_COLOR = 0xCDC1B4;  /* 有类型的 const */

typedef enum
{
    TILE_2 = 2,
    TILE_4 = 4,
    TILE_8 = 8,
    TILE_16 = 16
} TileValue;                        /* 相关常量用枚举 */

uint8_t buf[EE_BUF_SIZE];           /* 宏配置, 见名知义 */
```

## 6. 综合重构实战：给 lvgl_snake.c 做体检

把前六节全部串起来，走一遍完整的规范重构流程。以 `BSP/LVGL_APP/lvgl_snake.c`（382 行）为例：

### 第一步：列问题清单

| # | 位置 | 问题 | 对应规则 |
|---|------|------|----------|
| 1 | 第 8 行 | `LVGL_SNAKE_MAX_LENGTH` 表达式缺外层括号 | 6 章 §3 优先级 |
| 2 | 第 28 行 | 注释"游戏状态变量c"结尾多了个 c | 2 章注释要校对 |
| 3 | 第 29 行 | 注释超 80 列且冗长绕口 | 2.1.2 行宽 |
| 4 | 全文 | `//` 风格注释遍布 | 2.2.1 放弃 // |
| 5 | 第 56/64 行 | `rng_next/rng_seed` 与 lvgl_2048.c 完全重复 | 4 章 §2 重复代码提炼 |
| 6 | 全部函数 | 没有 doxygen 函数头（@brief/@param） | 2.2.3 函数注释 |

### 第二步到第四步：改命名 → 拆函数 → 加注释

重构后，`rng_next/rng_seed` 提炼进公共小模块，两个游戏文件共用一份随机数代码；函数头按 doxygen 模板补齐。改完逐条对照：

```c
/* 重构后: 宏带全括号, 注释按规范改写 */
/* 网格尺寸（单元格数）和蛇的最大长度 */
#define LVGL_SNAKE_GRID_SIZE   12
#define LVGL_SNAKE_MAX_LENGTH  ((LVGL_SNAKE_GRID_SIZE * LVGL_SNAKE_GRID_SIZE) / 2)

/**
 * @brief 伪随机数生成（LCG 算法）
 * @note  公式: X(n+1) = (a * X(n) + c) mod m, 与 2048 模块共用
 * @retval 下一个伪随机数
 */
static uint32_t rng_next(void)
{
    rng_state = rng_state * 1103515245u + 12345u;
    return rng_state;
}
```

> 💡 重构铁律：**每次只改一类问题，改完立刻编译 + 跑一遍游戏**。先把 1~4（纯格式）一轮改完编译一次，再做 5（拆函数）和 6（注释），最后全量回归。别想着一次改到位——改出 bug 时你根本不知道是哪步改坏的。

## 动手练习（约 35 分钟）

### 练习 7.1（重构练习）：按清单重构 lvgl_snake.c

1. 打开 `BSP/LVGL_APP/lvgl_snake.c`，对照第 6 节的 6 条问题清单逐条修改。
2. 宏括号、注释笔误、`//` 改 `/* */`、行宽、doxygen 函数头——分两轮改，每轮编译一次。
3. 第 5 条"重复代码提炼"按你自己的判断做：可以抽一个 `BSP/LCG/rng.c` 公共模块，也可以先记录 TODO 并说明理由——**但必须给出明确决策**。

**验收标准：**编译零警告零错误；贪吃蛇玩法、EEPROM 存分、方向控制与重构前完全一致；清单 6 条全部闭环。

### 练习 7.2：消灭魔法数字（扩展）

1. 看 `lvgl_2048.c` 的 `tile_color()`：一堆 `0xCDC1B4` 这样的裸颜色值。给 12 个颜色建一个枚举或一组 `static const uint16_t`，用"见名知义"的标识符替代。
2. 顺带把 `lvgl_2048_init()` 里的 `cell_size = 50`、`gap = 6` 抽成宏或 const。

**验收标准：**全文件搜索不到裸的 0x 颜色字面量；编译零警告；游戏界面颜色与重构前逐像素一致。

## 自测（答完再点答案）

### 随堂小测

**Q1. 以下哪段宏定义符合规范？**

- A. #define MAX_NUM N + 1
- B. #define MAX_NUM (N + 1)
- C. #define MAX_NUM (N) + (1)

<details><summary>查看答案</summary>

B。表达式常量必须整段套括号，防止优先级问题（PDF p.22~23）。C 只保护了各自，MAX_NUM 整体仍无保护。

</details>

**Q2. int a = 5; b = SQUARE(a++); 执行后 a 等于？**

- A. a = 5
- B. a = 6
- C. a = 7

<details><summary>查看答案</summary>

C。宏展开为 ((a++)*(a++))，自增执行两次（PDF p.23）。

</details>

**Q3. 多语句函数宏为什么要用 do{}while(0) 包裹？**

- A. 让宏拥有独立的变量作用域
- B. 保证展开后逻辑和语法始终正确
- C. 让宏可以被递归调用

<details><summary>查看答案</summary>

B。裸多语句宏在 if/else 下展开会改变控制流甚至编译报错，do{}while(0) 把它包成一条语句（PDF p.23~24）。

</details>

**Q4. 常量为什么建议用 const 而不用宏？**

- A. 宏定义没有数据类型
- B. 宏会占用更多内存
- C. 宏无法跨文件使用

<details><summary>查看答案</summary>

A。宏常量没有类型，const 有类型，编译器能帮忙做类型检查（PDF p.23）。

</details>

## 推荐阅读

- 📖 正点原子《嵌入式单片机 C 代码规范与风格 V1.1》第 5、6 章（PDF p.20~24）——本课全部依据
- 🔍 [do{}while(0) 原理分析](https://blog.csdn.net/xiaoyilong2007101095/article/details/77067686)——教材附录引用的经典文章，讲清了"为什么要包一层"
- 🧹 反思清单：把 0005/0006/0007 三课的检查项合成一份"工程体检表"，每次写完代码过一遍

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：第 8 课——像素与调色板。三课规范学完，回到你正在玩的 LVGL 世界：看看屏幕上的颜色是怎么组织的，你的 2048 颜色表会迎来一次"懂行"的升级。

| [← 上一课](/my-blog/posts/toolbox/0006-coding-style-naming/) | [课程目录](/my-blog/posts/toolbox/00-总览/) | [下一课 →](/my-blog/posts/toolbox/0008-pixels-and-palette/) |