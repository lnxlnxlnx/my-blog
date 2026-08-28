---
title: 对象系统与屏幕
published: 2026-08-18
description: 第 2 课：万物皆对象——lv_obj 对象树、父子关系、创建与删除、屏幕与图层、坐标/大小/对齐，并亲手搭出"仪表盘雏形"。这是后续所有控件课的公共地基。
tags: [LVGL, 嵌入式, GUI, 对象系统, 屏幕, 布局]
category: LVGL
draft: false
prevTitle: 样式系统
prevSlug: "lvgl/0003-styles"
nextTitle: LVGL 是怎么转起来的
nextSlug: "lvgl/0001-how-lvgl-runs"
---

# 对象系统与屏幕

万物皆对象：lv_obj 的树、父与子、创建与删除、屏幕与图层、布局与对齐。

**本课目标：**上一课你知道了 LVGL 怎么转起来，这一课认识"屏幕上的一切"——对象。学完你能用 lv_obj_create 造出带父子关系的界面，知道对象放哪、怎么对齐、怎么删干净，并亲手搭出"仪表盘雏形"。这是后续所有控件课（按钮、滑块、图表）的公共地基。

## 1. 万物皆对象（6.2 对象介绍）

LVGL 里，用户界面的基本构建单位是**对象（Object）**，也叫小部件（Widget）：按钮、标签、图片、滑块、图表……全是对象（PDF 6.2 节 (PDF p.82)）。

有意思的是：LVGL 是纯 C 写的，但它硬是用结构体模拟出了"类"的继承机制。核心是 `lv_obj_t` 这个结构体，先实例化出一个基础对象，再靠它"衍生"出各种专用部件。衍生出来的部件会**继承父对象的基本属性**（大小、位置、样式、事件），所以你能用一套统一的 `lv_obj_set_xxx` 函数管理所有部件，比如：

```c
void lv_obj_set_size(lv_obj_t * obj, lv_coord_t w, lv_coord_t h);   /* 大小 */
void lv_obj_set_pos(lv_obj_t * obj, lv_coord_t x, lv_coord_t y);    /* 位置 */
void lv_obj_add_style(lv_obj_t * obj, lv_style_t * style, lv_style_selector_t selector); /* 样式 */
```

每个对象都有 5 个基本属性：**大小、父类、样式、事件、位置**（PDF 6.2.1 (PDF p.82)）。除了这些公共属性，不同部件还有私有属性——比如滑块有"当前值"和"范围值"，用专门的 API 设置：

```c
lv_slider_set_range(slider, 0, 100);          /* 设置滑块的范围值 */
lv_slider_set_value(slider, 40, LV_ANIM_ON);   /* 设置滑块当前值（带动画） */
```

记住这个心智模型：**公共属性一套函数管，私有属性各管各**。这样你就不会在 50 个部件 API 里迷路。

## 2. 父与子：LVGL 的对象树（6.2.3）

父对象就是子对象的**容器**——子对象被创建出来那一刻，就"装"在父对象里面了。规则只有两条：

- 一个父类可以有多个子类；一个子类只有一个父类（屏幕除外，它是顶层根）
- 坐标参考：子对象设置位置时，**原点在父对象的左上角**，不是屏幕左上角（PDF 6.2.3 (PDF p.83)）

父子之间有三条铁律，划重点：

1. **父动子随**：父对象移动，所有子对象跟着移动——这是"整体挪一组控件"的秘诀
2. **子动父不动**：子对象随便跑，父对象纹丝不动
3. **越界默认不可见**：子对象超出父对象范围的部分会被裁掉（默认），不是报错，是"看不见"

> ⚠️ **丢控件第一大嫌疑**：子对象坐标算错、跑到父对象外面去了，代码"没错"但屏幕上就是看不到。排查时先看子对象的父是谁、坐标参考点在哪。

这棵"树"就是 LVGL 的布局根基，后面学布局、学样式继承都建立在它上面。

## 3. 创建与删除对象（6.2.4）

所有部件的创建函数风格高度统一：`lv_<widget>_create(parent)`，唯一参数是父对象指针，返回值是新建对象（PDF 6.2.4 (PDF p.84)）：

```c
lv_obj_t * obj = lv_obj_create(lv_scr_act());      /* 创建基础对象，父是当前活动屏幕 */
lv_obj_t * btn = lv_btn_create(lv_scr_act());      /* 创建按钮，父也是屏幕 */
```

创建对象会**消耗内存**（从 LV_MEM_SIZE 的池子里），删除时释放。四个删除函数各司其职：

| 函数 | 行为 | 典型场景 |
|------|------|----------|
| `lv_obj_del(obj)` | 立即删除对象及全部子对象 | 日常清理 |
| `lv_obj_clean(obj)` | 只删全部子对象，父对象保留 | 清空容器再重建列表 |
| `lv_obj_del_async(obj)` | 下次 lv_timer_handler 时删 | 在事件回调里删自己（安全） |
| `lv_obj_del_delayed(obj, ms)` | 延时 ms 毫秒后删 | 倒计时后消失的提示 |

### 屏幕：没有父对象的特殊对象（6.2.5）

屏幕（Screen）是 LVGL 对象树的"根"：它没有父对象。默认情况下 LVGL 初始化时已经帮你创建了一个活动屏幕，直接用：

```c
lv_obj_t * scr = lv_scr_act();   /* 获取当前活动屏幕（常用来当父对象） */
lv_obj_t * scr2 = lv_obj_create(NULL);  /* 手动创建新屏幕：传 NULL 表示没有父 */
```

你做的 2048、贪吃蛇界面，最终都长在某个屏幕上。多屏幕切换（lv_scr_load）是后面课程的内容，本课先把"单屏"玩透。

## 4. 图层：谁盖在谁上面（6.2.6）

三个问题，一次讲清（PDF 6.2.6 (PDF p.84)）：

**① 重叠时谁在上？**后创建的对象画在前景，会盖住先创建的。所以想"谁在最上面"，要么后创建，要么手动调层。

**② 怎么调层？**三个函数：

- `lv_obj_set_top(obj)` — 点击它时自动置顶（像 PC 上点窗口把它带到前面）
- `lv_obj_move_foreground(obj)` — 直接挪到前景
- `lv_obj_move_background(obj)` — 直接挪到背景

**③ LVGL 有哪些图层？**一共三层，从下到上：

| 图层 | 获取 | 用途 |
|------|------|------|
| 活动屏幕层 `scr_act` | `lv_scr_act()` | 你的主界面，所有业务控件都放这 |
| 顶层 `top` | `lv_layer_top()` | 菜单栏、弹窗等"永远压在内容上面"的东西 |
| 系统层 `sys` | `lv_layer_sys()` | 鼠标光标等系统级元素 |

实操体会：把"加载中"遮罩、下拉通知栏放到 `lv_layer_top()`，就不用担心被后创建的控件盖住。

## 5. 布局：坐标、大小、对齐（6.3）

LVGL 布局深受 CSS 启发，就三件事（PDF 6.3 节 (PDF p.86)）：

### 5.1 坐标与大小

```c
lv_obj_set_x(obj, 10);                 /* 设置 x 轴坐标（相对父左上角） */
lv_obj_set_y(obj, 10);                 /* 设置 y 轴坐标 */
lv_obj_set_pos(obj, 10, 10);           /* 一起设 */
lv_obj_set_width(obj, 200);            /* 设置宽度 */
lv_obj_set_height(obj, 100);           /* 设置高度 */
lv_obj_set_size(obj, 200, 100);        /* 宽高一起设 */
```

坐标和大小都能用**百分比**：`lv_pct(50)` 表示父对象尺寸的 50%——屏幕 320×240，子对象设 `lv_pct(100)` 宽就是 320 像素：

```c
lv_obj_set_pos(obj, lv_pct(10), lv_pct(10));   /* 坐标按百分比 */
lv_obj_set_height(obj, lv_pct(50));            /* 高度是父对象的一半 */
```

> 💡 设置坐标/大小后，对象的值**不会立刻更新**（布局要等重绘时算）。如果你设完马上读坐标，读到的还是旧值。想立即生效就调 `lv_obj_update_layout(obj)` 强制重算（PDF 6.3.1 (PDF p.86)）。

### 5.2 对齐：解放双手的关键

手写像素坐标做对齐又累又脆，LVGL 提供了一套完整的对齐模式（PDF 6.3.3 (PDF p.86)）：内部对齐 `LV_ALIGN_TOP_LEFT / TOP_MID / TOP_RIGHT / BOTTOM_LEFT / BOTTOM_MID / BOTTOM_RIGHT / LEFT_MID / RIGHT_MID / CENTER`，还有外部对齐 `LV_ALIGN_OUT_TOP_MID / OUT_BOTTOM_LEFT` 等（对象 2 贴在对象 1 外面）。三个设置函数：

```c
lv_obj_center(obj);                             /* 在父对象里居中，等价于 align+偏移 0 */
lv_obj_align(obj, LV_ALIGN_CENTER, 0, 0);       /* 按模式对齐，后两个是偏移像素 */
lv_obj_align_to(obj, other, LV_ALIGN_OUT_BOTTOM_MID, 0, 10); /* 相对另一个对象（可以没有父子关系） */
```

## 代码示例 1：父对象移动，子对象跟随

完整的可烧录函数（放在 BSP 或 main 里调用一次即可），演示"容器"思想：

```c
/* 演示：父容器带着一群子控件整体移动 */
void lvgl_demo_container(void)
{
    /* 1. 创建一个父容器，作为"面板" */
    lv_obj_t * panel = lv_obj_create(lv_scr_act());
    lv_obj_set_size(panel, 200, 120);
    lv_obj_align(panel, LV_ALIGN_CENTER, 0, 0);

    /* 2. 在面板里放三个子对象（坐标原点在 panel 的左上角） */
    lv_obj_t * child1 = lv_obj_create(panel);
    lv_obj_set_pos(child1, 10, 10);
    lv_obj_set_size(child1, 60, 40);

    lv_obj_t * child2 = lv_obj_create(panel);
    lv_obj_set_pos(child2, 80, 10);
    lv_obj_set_size(child2, 60, 40);

    lv_obj_t * child3 = lv_obj_create(panel);
    lv_obj_set_pos(child3, 10, 60);
    lv_obj_set_size(child3, 130, 40);

    /* 3. 只移动父对象，三个子对象全部跟着走 */
    lv_obj_set_pos(panel, 30, 60);
}

/* 重点观察：子对象坐标没改，但画面整体位移了 —— 这就是"父动子随" */
```

## 代码示例 2：仪表盘雏形

把本课知识串起来：背景卡片 + 居中标题 + 对齐元素。这也是本课练习 2.2 的参考答案骨架：

```c
/* 仪表盘雏形：卡片 + 标题 + 数值区 */
void lvgl_demo_dashboard(void)
{
    /* 1. 屏幕背景（活动屏幕本身也是对象，可以设样式） */
    lv_obj_t * scr = lv_scr_act();
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x1a1a2e), LV_STATE_DEFAULT);

    /* 2. 背景卡片：居中放置，作为所有内容的大容器 */
    lv_obj_t * card = lv_obj_create(scr);
    lv_obj_set_size(card, 280, 200);
    lv_obj_align(card, LV_ALIGN_CENTER, 0, 0);
    lv_obj_set_style_bg_color(card, lv_color_hex(0x16213e), LV_STATE_DEFAULT);

    /* 3. 标题：卡片顶部居中 */
    lv_obj_t * title = lv_obj_create(card);
    lv_obj_set_size(title, 200, 30);
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 10);

    /* 4. 大数值：标题下方居中（占位，第 4 课会让它响应触摸） */
    lv_obj_t * value = lv_obj_create(card);
    lv_obj_set_size(value, 200, 60);
    lv_obj_align(value, LV_ALIGN_CENTER, 0, 10);

    /* 5. 底部状态条：对齐到卡片底边 */
    lv_obj_t * status = lv_obj_create(card);
    lv_obj_set_size(status, 240, 26);
    lv_obj_align(status, LV_ALIGN_BOTTOM_MID, 0, -10);
}
```

> 💡 观察示例 2 的对齐偏移量：`LV_ALIGN_BOTTOM_MID, 0, -10` 表示"底边居中对齐后，再往 y 轴负方向（向上）挪 10 像素"——对齐 + 偏移的组合，是摆控件的日常操作。

## 动手练习（约 30 分钟）

### 练习 2.1：父对象移动，子对象跟随

- 1️⃣ 新建一个函数 `lvgl_demo_container()`，参考代码示例 1：先造一个 200×120 的父面板，居中；再往里面放 3 个子对象，坐标分别是 (10,10)、(80,10)、(10,60)。
- 2️⃣ 烧录，先观察面板居中时三个小块的相对位置。
- 3️⃣ 把面板 `lv_obj_set_pos` 改成 (30, 60) 再烧录：子对象坐标一行都没改，画面整体位移了——验证"父动子随"。
- 4️⃣ 挑战：把一个子对象的坐标改成 (250, 80)——它完全超出面板了，观察它是否消失（越界不可见）。再把面板 `lv_obj_set_style_bg_opa(panel, LV_OPA_0, LV_STATE_DEFAULT)` 试试，还能看到越界的子对象吗？为什么？

### 练习 2.2：仪表盘雏形

- 1️⃣ 按代码示例 2 搭出"背景卡片 + 居中标题 + 数值区 + 底部状态条"。
- 2️⃣ 用 `lv_obj_align_to` 把数值区改成对齐标题的底边（`LV_ALIGN_OUT_BOTTOM_MID`），而不是对齐卡片中心——体会"相对某个对象对齐"。
- 3️⃣ 把标题、数值区、状态条分别放到 `lv_layer_top()` 上，再在屏幕上创建一个大对象盖住它们，观察图层效果；最后用 `lv_obj_move_foreground` 把被盖的控件救回来。
- 4️⃣ 观察：状态条对齐卡片底边时用了负偏移 `(0, -10)`，改成 `(0, 10)` 看看会发生什么？解释原因。

## 自测（答完再点答案）

### 随堂小测 1

Q1. 子对象设置坐标时，参考原点在哪里？
- A. 整个屏幕的左上角 (0,0)
- B. 父对象的左上角
- C. 父对象的中心点

<details>
<summary>查看答案</summary>

B。子对象坐标以父对象左上角为原点（PDF p.83）。屏幕左上角是父对象为屏幕时才成立的特例。
</details>

Q2. 想清空一个容器里的全部子对象，但保留容器本身，用哪个？
- A. lv_obj_del(container)
- B. lv_obj_clean(container)
- C. lv_obj_del_delayed(container, 0)

<details>
<summary>查看答案</summary>

B。lv_obj_clean 只删子对象；lv_obj_del 会把容器自己也删掉。
</details>

Q3. 想在屏幕最上层做一个"永远不被盖住"的遮罩，应该放哪？
- A. 活动屏幕层 lv_scr_act()
- B. 顶层 lv_layer_top()
- C. 系统层 lv_layer_sys()

<details>
<summary>查看答案</summary>

B。顶层在活动屏幕之上，适合菜单/弹窗；系统层是光标之类的系统元素。
</details>

Q4. lv_obj_set_size(obj, 100, 200) 设完后立刻读取宽度，会读到什么？
- A. 100，设置立即生效
- B. 旧值，布局要等刷新才更新
- C. 随机值，取决于内存状态

<details>
<summary>查看答案</summary>

B。设置后值不会立刻更新，可调用 lv_obj_update_layout 强制重算（PDF p.86）。
</details>

## 推荐阅读

- 📖 正点原子《LVGL 开发指南 V1.5》第 6.1~6.3 节（控制流程 (PDF p.81)、对象介绍 (PDF p.82)、布局 (PDF p.86)）——本课全部依据
- 🌐 [LVGL 官方文档：Base object（v8.3）](https://docs.lvgl.io/8.3/widgets/obj.html)——lv_obj 的完整属性与函数参考
- 🌐 [LVGL 官方文档：Align（v8.3）](https://docs.lvgl.io/8.3/layouts/align.html)——所有 LV_ALIGN 模式的图示，比 PDF 表格更直观

## 下一步

有任何不清楚的地方，直接问我（Agent 就是你的老师）。下一课预告：[第 3 课：样式系统](/my-blog/posts/lvgl/0003-styles/)——把灰扑扑的方块变成好看的界面，圆角、阴影、按下变色全在这一课。

| [← 上一课](/my-blog/posts/lvgl/0001-how-lvgl-runs/) | [课程目录](/my-blog/posts/lvgl/00-总览/) | [下一课 →](/my-blog/posts/lvgl/0003-styles/) |