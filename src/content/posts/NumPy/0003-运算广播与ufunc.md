---
title: 运算广播与ufunc
published: 2026-08-25
description: numpy 的"发动机"ufunc 与广播：逐元素 vs 矩乘、广播对齐规则、axis 聚合、dtype，以及 NaN/浮点精度等奇怪现象（题 18、23、26~34、36~42）。
tags: [NumPy, ufunc, 广播, dtype]
category: NumPy
draft: false
prevTitle: 排序统计与随机
prevSlug: "numpy/0004-排序统计与随机"
nextTitle: 索引切片与形状
nextSlug: "numpy/0002-索引切片与形状"
---

# 运算、广播与通用函数 ufunc

这是 NumPy 专题课程的第 3 课，预计 25 分钟，配套 numpy-100 的题 18、23、26~34、36~42，前置是第 2 课「索引、切片与形状」。

numpy 的"发动机"是**ufunc(通用函数)**:对数组逐元素做运算的快速函数(`+,-,*,/,<` 还有 `np.sqrt/np.exp/...`)。本课讲 `*  vs  @`、**广播 broadcast**(不同形状怎么自动对齐)、dtype、以及习题 26~34、36~42 需要的技巧。

## 知识点 1:逐元素运算 vs 矩乘——再强调一次

```python
import numpy as np
A = np.arange(6).reshape(2, 3)
A * 2            # 逐元素乘 2(标量广播)
A * A            # 逐元素乘(同形状同位置)
A @ A.T          # 矩阵乘:(2,3)@(3,2)→(2,2)
np.sin(A), np.exp(A), np.sqrt(np.abs(A))   # ufunc 逐元素
```

`*` 逐元素; `@` 矩乘; `np.sin/exp/sqrt/... `是 ufunc。

## 知识点 2:广播——形状不同时自动对齐

两个数组运算时,numpy 会从最后(= 轴尾部)开始对齐维度,小的被"拉伸"(不复制数据)

尾部对轴，缺轴前面补 1；轴长为 1 可逻辑拉伸，不复制内存；轴长都不为 1 且不等直接报错:

```python
a = np.arange(3)          # shape (3,)
b = np.ones((4, 3))       # shape (4,3)
b + a                     # 广播:(4,3) + (3,) → 每行加 a ✔

x = np.ones((5, 1))       # (5,1)
y = np.arange(5)          # (5,)
x + y                     # 广播:(5,1)+(5,) → (5,5) ✔

np.ones((3, 2)) + np.zeros((2,))   # (3,2)+(2,) →(3,2) ✔
# 若维度从尾部对齐不回:如 (3,)+(4,) 会报错
```

题37:造 5x5,每行都是 0~4:`Z = np.zeros((5,5)); Z += np.arange(5)`(广播把长度5的向量加到每行)。题62:从 (1,3) 和 (3,1) 求逐元素和 → 广播成 (3,3)。

## 知识点 3:聚合运算——sum/min/max/mean + axis

对整个/某一轴做汇总,`axis` 控制"沿着哪个轴":

```python
Z = np.arange(12).reshape(3, 4)
Z.sum()            # 66:全部求和
Z.sum(axis=0)      # 每列和 → shape(4,):沿第0轴(逐列)
Z.sum(axis=1)      # 每行和 → shape(3,)
Z.min(), Z.max(), Z.mean()    # 全局最值/均值
Z.mean(axis=1)     # 每行均值
```

题13/14用 `Z.min()/Z.max()/Z.mean()`;题58是 `X - X.mean(axis=1, keepdims=True)`。记口诀:`axis=0 竖向(跨行),axis=1 横向(跨列)`。

## 知识点 4:dtype——元素的类型(题 18、23、26~28、36、53)

数组所有元素同类型 `dtype`:int32/int64/float32/float64/bool/str,还有自定义复合 dtype:

```python
np.arange(5, dtype=np.float64)     # 指定浮点
np.arange(5).astype(np.int32)      # 转换类型
np.asarray([1,2,3], dtype=float)   # from list 指定类型
```

题18:把值 1,2,3,4 放在主对角线下一条,用 `np.diagflat` 或手动:`Z = np.diag([1,2,3,4], k=-1)`(k=-1 是主对角线下一行)。题23:自定义 dtype(颜色四通道)用结构化 dtype:`dt = [('r','u1'),('g','u1'),('b','u1'),('a','u1')]`(下一课细讲结构化数组)。

## 知识点 5:一些奇怪但也常用的 ufunc 现象(题 26~32、36)

这些题最容易懵,提前给结论:

```python
0 * np.nan          # nan:0 × NaN = NaN
np.nan == np.nan    # False:NaN 不等任何值(包括自己)
np.inf > np.nan     # False
np.nan - np.nan     # nan
0.3 == 3*0.1        # False:浮点精度问题

np.sqrt(-1)                     # nan + 警告
np.emath.sqrt(-1)               # 1j:复杂域根(题32难住很多人)

# 题29:round away from zero(朝远离0取整)
Z = np.random.uniform(-10,10,10)
np.copysign(np.ceil(np.abs(Z)), Z)     # 先|取整再还原符号
```

题36:提取正数小数的整数部分,4种方法:`Z - Z%1`、`np.floor(Z)`、`np.trunc(Z)`、`Z.astype(int)`(后者会截断)。

## 练习

打开 `practice/numpy/0003_运算广播与ufunc.ipynb`:

- **题 18、23、26~34、36~42**:numpy-100 原题
- **额外**:手写三遍广播规则;测 0.3==3*0.1 和 sqrt(-1)

## 测验

### 测验 1
A*B 与 A@B 的区别?
- A. 都是矩乘
- B. *逐元素 @ 矩乘(正确)
- C. *矩乘 @ 逐元素
- D. 结果相同

<details>
<summary>答案与解析</summary>

**答案：B**。* 是逐元素乘;B @ 是矩阵乘(内积)。两者完全不同。
</details>

### 测验 2
np.ones((5,1)) + np.arange(5) 结果形状?
- A. (5,1)
- B. (5,5)(正确)
- C. (1,5)
- D. 报错

<details>
<summary>答案与解析</summary>

**答案：B**。广播:(5,1)+(5,) → (5,5)。维度从尾部对齐并拉伸。
</details>

### 测验 3
Z.sum(axis=1) 求的是?
- A. 每列和
- B. 每行和(正确)
- C. 全局和
- D. 对角线

<details>
<summary>答案与解析</summary>

**答案：B**。axis=1 沿行方向跨列 = 每行和(结果 shape 保留该维长度)。
</details>

### 测验 4
np.nan == np.nan 的结果?
- A. True
- B. False(正确)
- C. nan
- D. 报错

<details>
<summary>答案与解析</summary>

**答案：B**。NaN 不等于任何值包括自身。题26/28核心。
</details>

## 下一步

做完回来告诉我:广播和 ufunc 顺手吗,哪个题最难?下一课讲**排序、统计与随机**(题 43~56、58、60)。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/numpy/0002-索引切片与形状/) | [课程目录](/my-blog/posts/numpy/00-总览/) | [下一课 →](/my-blog/posts/numpy/0004-排序统计与随机/) |