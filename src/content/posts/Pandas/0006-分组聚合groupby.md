---
title: 分组聚合groupby
published: 2026-08-26
description: Pandas 第 6 课:groupby 的 split-apply-combine 三层结构,agg/transform/filter 三大用法,多列分组与 pivot_table(补书第 10 章)。
tags: [Pandas, groupby, 聚合, transform, filter]
category: Pandas
draft: false
prevTitle: 时间序列与类别数据
prevSlug: "pandas/0007-时间序列与类别数据"
nextTitle: 合并与重塑
nextSlug: "pandas/0005-合并与重塑"
---

# 分组聚合 groupby

数据里最有价值的操作之一:**groupby** = 分组(SQL 的 GROUP BY)。aggregation(汇总)、transform(变换)、filter(过滤)三大用法。这章仓库缺,我给你补全。官方 [groupby tutorial](https://pandas.pydata.org/docs/user_guide/groupby.html)。

## 知识点 1:groupby 三层结构——split-apply-combine

思路:按某列**split**(分成小组)→ 对每组的列**apply**(聚合函数)→ 把结果**combine**(拼回表)。一行:

```python
import pandas as pd
df = pd.DataFrame({
    "dept": ["tech", "fin", "tech", "fin", "hr"],
    "salary": [100, 90, 120, 110, 80],
})
df.groupby("dept")["salary"].mean()
# dept
# fin    100.0
# hr      80.0
# tech   110.0
```

读法:`df.groupby("dept")` 分组 → `["salary"]` 选列 → `.mean()` 每组的均值 = `分组 → 聚合 → 拼回`。

## 知识点 2:aggregate——一次多个统计(agg)

想同时要 count/mean/std/min/max,用 `.agg`:

```python
df.groupby("dept")["salary"].agg(["count", "mean", "std", "min", "max"])
#          count  mean        std  min  max
# dept
# fin         2   100.0  14.142136   90  110
# hr          1    80.0        NaN   80   80
# tech        2   110.0  14.142136  100  120
df.groupby("dept")["salary"].describe()   # 或 describe 全给
```

`.agg` 传函数名/列表/字典;一次看全比多次调用省事。

## 知识点 3:多列分组 + 多列聚合

```python
df["bonus"] = [10, 20, 30, 40, 5]
g = df.groupby("dept")
g.sum()                       # 所有数值列都按组求和
g[["salary", "bonus"]].mean()  # 只对这两列
df.groupby(["dept", "year"])["salary"].mean()   # 两列分组 → MultiIndex
# 每列不同聚合:
g.agg({"salary": ["mean", "std"], "bonus": "sum"})
```

groupby(["a","b"]) 得到 MultiIndex 分组结果;agg(dict) 可给每列不同算法。

## 知识点 4:transform 与 filter——按组变换/过滤

transform:每个元素减去**本组**的均值(保持原形状,用于"去组内均值");filter:只留符合条件的组:

```python
df.groupby("dept")["salary"].transform(lambda x: x - x.mean())  # 去组均值
# 0  -10.0   1 -10.0 ...
df.groupby("dept")["salary"].transform("mean")   # 每人填本组均值

# filter:只保留组内样本数≥2 的组
df.groupby("dept").filter(lambda g: len(g) >= 2)
```

区别:agg 把一组压成一个值;transform 保持行数(每行对应自己的组值);filter 选组。三者理解后 groupby 就全通了。

## 知识点 5:应用到真实数据(tips)

把上面的技巧用在真实数据上:

```python
url = "https://raw.githubusercontent.com/hangsz/pandas-tutorial/master/tips.csv"
tips = pd.read_csv(url)
tips.groupby("smoker")["total_bill"].mean()      # 抽烟 vs 不抽烟小费均值
tips.groupby(["sex", "day"])["tip"].agg(["count", "mean"])
tips.groupby("day").size()                        # 每组行数(等价 value_counts)
piv = tips.pivot_table(index="day", columns="smoker", values="tip", aggfunc="mean")
```

`groupby + pivot_table` 是数据分析最常用组合:pivot_table 本质就是"分组后透视"。真实项目里 80% 的分析都在 groupby 上。

## 练习

打开 `practice/pandas/0006_分组聚合groupby.ipynb`:

- **练习 A**:tips 按 smoker/day 做 mean、agg 多统计、size()
- **练习 B**:transform 去组均值;filter 选小组;多列分组 MultiIndex
- **练习 C(扩展)**:groupby + pivot_table 组合出一张"按天×抽烟/不抽烟 的平均小费"表

## 测验

### 测验 1
groupby 三步是?
- A. merge-apply-drop
- B. split-apply-combine(正确)
- C. sort-cut-filter
- D. read-reshape-write

<details>
<summary>答案与解析</summary>

**答案：B**。分组→对不同组应用函数→拼合并。这是 groupby 的心智模型。
</details>

### 测验 2
一组想同时要 mean 和 std?
- A. 过一遍 for
- B. .agg(["mean","std"])(正确)
- C. .transform
- D. .filter

<details>
<summary>答案与解析</summary>

**答案：B**。agg 一次多个聚合;transform 是保持行数变换;filter 是选组。
</details>

### 测验 3
每行减去"本组"均值,用?
- A. .mean()
- B. .transform(正确)
- C. .agg
- D. .filter

<details>
<summary>答案与解析</summary>

**答案：B**。transform 保持原形状按组变换;agg 压成组级一个值。
</details>

### 测验 4
只保留样本数≥2 的组?
- A. .agg
- B. .filter(lambda g: len(g)>=2)(正确)
- C. .transform
- D. .pivot

<details>
<summary>答案与解析</summary>

**答案：B**。filter 对整组判断后选组,是 groupby 三招里负责"过滤"的。
</details>

## 推荐阅读

> 书(Wes)《Python for Data Analysis》第 10 章(本仓库缺,官方 [GroupBy](https://pandas.pydata.org/docs/user_guide/groupby.html) 教程可看);做 tips 时注意 [agg/transform/filter 三区分](https://pandas.pydata.org/docs/user_guide/groupby.html#applying-functions-to-groups)。

## 下一步

做完回来告诉我:agg/transform/filter 分清了没?下一课讲**时间序列与类别数据**(书 11/12 章 + hangsz 12/13)。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/pandas/0005-合并与重塑/) | [课程目录](/my-blog/posts/pandas/00-总览/) | [下一课 →](/my-blog/posts/pandas/0007-时间序列与类别数据/) |