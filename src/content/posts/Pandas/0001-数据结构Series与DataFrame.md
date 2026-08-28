---
title: 数据结构Series与DataFrame
published: 2026-08-21
description: Pandas 第 1 课:掌握 Series 与 DataFrame 两大数据结构,理解标签索引、自动对齐、NaN 缺失值与数据体检四件套。
tags: [Pandas, Series, DataFrame, 索引, 缺失值]
category: Pandas
draft: false
prevTitle: 基础功能
prevSlug: "pandas/0002-基础功能"
nextTitle: ""
nextSlug: ""
---

# 数据结构 Series 与 DataFrame

pandas 的两大主角:**Series**(带标签的一维序列)与**DataFrame**(带标签的二维表)。你已会 numpy,这一课把三个关键心智装进脑子:**① 有索引 index/columns;② 标签对齐;③ 缺失值 NaN**。参考资料:[书 5.1](https://github.com/BrambleXu/pydata-notebook)、[hangsz 笔记 1](https://github.com/hangsz/pandas-tutorial)、[pandas 官方数据结构文档](https://pandas.pydata.org/docs/getting_started/intro_tutorials/01_table_oriented.html)。

## 知识点 1:Series——带索引的一维序列

从列表/字典造,自带 index(自动 0..n-1 或你指定):

```python
import pandas as pd
import numpy as np

# 从列表:自动整数索引
s = pd.Series([1, 3, -5, 7])
print(s.values)     # array([1, 3, -5, 7])
print(s.index)      # RangeIndex(0,1,2,3)

# 从字典:键变成索引
s2 = pd.Series({"a": 1, "b": 2, "c": 3})
print(s2["b"])      # 2

# 显式指定索引 + 名字
s3 = pd.Series([1, 3, -5], index=["x", "y", "z"], name="数据")
```

Series = numpy 数组 + 索引。取数据用索引不是下标:`s2["b"]`、`s[x]`。

## 知识点 2:标签对齐——字典对齐的核心魔法

两个 Series 相加时,**按索引自动对齐**,同名的才对上,对不上的得到 NaN:

```python
s_a = pd.Series({"apple": 5, "banana": 3, "cherry": 8})
s_b = pd.Series({"apple": 2, "banana": 4, "date": 10})
s_a + s_b
# apple 7.0, banana 7.0, cherry NaN, date NaN (缺失)
```

这是 pandas 与 numpy 最重要的差别:不用自己保证顺序,标签对齐自动处理。對不上的值是 `NaN`(缺失)。判断缺失用 `pd.isnull(x)/pd.notnull(x)`。

## 知识点 3:DataFrame——带行列标签的表格

DataFrame 由「字典: 列名→序列」或嵌套 dict 造出;自动对齐行索引,缺的填 NaN:

```python
data = {
    "state": ["Ohio", "Ohio", "Nevada", "Nevada"],
    "year":  [2000, 2001, 2001, 2002],
    "pop":   [1.5, 1.7, 2.4, 2.9],
}
frame = pd.DataFrame(data)        # 列=键,行=自动整数索引
print(frame.head(2))              # 看前2行
print(frame.columns)             # Index(['state','year','pop'])
print(frame["year"])             # 选一列(返回 Series)
print(frame.index)               # 行索引
```

DataFrame = 若干列的 Series 拼成表。可指定 columns 顺序、自定义行 index:

```python
frame2 = pd.DataFrame(data, columns=["year", "state", "notexist"])
print(frame2)                     # notexist 列全是 NaN;列按给的顺序
frame2["new"] = range(4)          # 加一列
del frame2["new"]                 # 删一列
```

要哪几列就直接传 columns 列表;没在 data 里的列自动补 NaN;取行转置用 `frame.T`。

## 知识点 4:Index 对象——不可变的钥匙

行/列标签都是 `Index` 对象,**不可变**(不能改元素),能容纳重复值;支持切片、成员判断、并集交集:

```python
obj = pd.Series(range(3), index=["a", "b", "c"])
idx = obj.index
print(idx)               # Index(['a','b','c'])
print(idx[:2])           # 切片
print("a" in idx)        # True
obj.index = ["x", "y", "z"]   # 想改:整个重新赋值(不是原位改)

# DataFrame 的行列也都是 Index
print(frame.columns.name, frame.index.name)
```

Index 就像"字典的键集合":不可变、可哈希、按标签取。[Index API](https://pandas.pydata.org/docs/reference/api/pandas.Index.html)。

## 知识点 5:快速看整体——info / head / shape / describe(hangsz 8)

拿到数据先"体检":

```python
url = "https://raw.githubusercontent.com/hangsz/pandas-tutorial/master/tips.csv"
tips = pd.read_csv(url)
print(type(tips), tips.shape)     # (244, 7) 行×列
tips.head()                        # 前5行
tips.tail(3)                       # 后3行
tips.info()                        # 各列类型、非空数量
print(tips.describe())             # 数值列统计(count/mean/std/min/max…)
```

`.info()` 看都有哪些列+类型+多少非空;`.describe()` 一次性给出数值统计;`.shape` 行×列。这三个是"第一眼看数据"标配。

## 练习

打开 `practice/pandas/0001_数据结构Series与DataFrame.ipynb`:

- **练习 A(书 5.1)**:从 dict 造 Series 并观察对齐;从嵌套 dict 造 DataFrame 并指定列序
- **练习 B(hangsz 1/8)**:用 tips.csv 做 info/head/tail/describe 体检;练习 Series 的四个属性
- **练习 C(补额外练习)**:造一个"合并两 Series 出现 NaN"的例子;给 DataFrame 加减列;试 Index 并集

## 测验

### 测验 1
Series 与 numpy 数组的差别?
- A. 没有差别
- B. 有标签索引(正确)
- C. 只能存数字
- D. 不可变

<details>
<summary>答案与解析</summary>

**答案：B**。Series = numpy数组 + 索引;对齐/取名/缺失值都靠标签。
</details>

### 测验 2
两个 Series 相加,索引对不上的?
- A. 报错
- B. 补 NaN(正确)
- C. 丢弃
- D. 取第一个

<details>
<summary>答案与解析</summary>

**答案：B**。按索引对齐,同名的相加,对不上的得到 NaN(缺失)。
</details>

### 测验 3
DataFrame 的行列标签是?
- A. 列表
- B. Index 对象(正确)
- C. 元组
- D. dict

<details>
<summary>答案与解析</summary>

**答案：B**。行用 index、列用 columns,都是不可变的 Index 对象。
</details>

### 测验 4
快速看各列类型与缺失,用?
- A. .shape
- B. .info()(正确)
- C. .head()
- D. .value

<details>
<summary>答案与解析</summary>

**答案：B**。.info() 列出每列类型/非空数量;.describe() 给数值统计。
</details>

## 推荐阅读

> pandas 官方 [Getting started](https://pandas.pydata.org/docs/getting_started/) 教程的「Data structures」部分;再翻 [书 5.1](https://github.com/BrambleXu/pydata-notebook) 与 [hangsz 笔记 1、8](https://github.com/hangsz/pandas-tutorial) 对应小节。

## 下一步

做完回来告诉我:标签对齐这个"魔法"你感受到了吗?下一课讲**基础功能:索引/选择/排序/统计**(书 5.2/5.3 + hangsz 2/9/10)。

**有任何不懂的,直接问我——我是你的老师。**

| — | [课程目录](/my-blog/posts/pandas/00-总览/) | [下一课 →](/my-blog/posts/pandas/0002-基础功能/) |