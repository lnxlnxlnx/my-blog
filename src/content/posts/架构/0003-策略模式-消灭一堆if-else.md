---
title: 策略模式:消灭一堆 if/else
published: 2026-08-21
description: 架构与设计模式第 3 课:if/else 雪球问题、策略模式三角色、接口 + 实现重构、函数即策略、注册表组合,以及什么时候别用。
tags: [架构, Python, 设计模式, 策略模式, 开闭原则]
category: 架构
draft: false
prevTitle: 工厂模式:把创建和用分开
prevSlug: "架构/0004-工厂模式-把创建和用分开"
nextTitle: 接口与多态:ABC 和 Protocol
nextSlug: "架构/0002-接口与多态-abc和protocol"
---

# 策略模式:消灭一堆 if/else

上一课的接口与多态,是「招式」;从这一课开始,我们学「套路」。**策略模式(Strategy Pattern)**是设计模式里最简单、也最实用的一个:它专门解决代码里最常见的一种坏味道——**一堆 if/else 决定行为**。

## 知识点 1:问题的样子——if/else 雪球

先看一段「典型演化出来」的代码。假设你在写电商结算,会员等级越多,折扣逻辑就越长:

```python
def checkout(order, user):
    """按会员等级计算折扣。"""
    if user.level == "normal":          # 普通:不打折
        return order.total
    elif user.level == "gold":          # 黄金:95 折
        return order.total * 0.95
    elif user.level == "platinum":      # 铂金:9 折
        return order.total * 0.90
    elif user.level == "birthday":      # 生日:8 折
        return order.total * 0.80
    else:
        raise ValueError(f"未知等级: {user.level}")
```

这段代码有三个问题([Switch 语句坏味道](https://refactoring.guru/zh/smells/switch-statements)):

- **加一个等级 = 改 checkout**:每次新增会员等级,都得打开这个函数,改动一处影响全局(违反开闭原则)
- **分支越滚越大**:等你有 10 个等级 + 满减 + 节日促销,这个函数会有 100 行 if/else
- **没法单独测**:想测「黄金会员」的折扣,得先造一个 user、再调 checkout,分支逻辑和调用逻辑混在一起

## 知识点 2:策略模式的三张牌

策略模式把「每个分支里的算法」抽出来,各自封装成独立的类/函数,让它们**可以互相替换**。三个角色([官方讲解](https://refactoringguru.cn/design-patterns/strategy)):

- **策略 Strategy**:「算法」的接口/约定。例:Discount(只有一个方法 apply)。
- **具体策略 ConcreteStrategy**:算法的每个版本。例:GoldDiscount、PlatinumDiscount。
- **上下文 Context**:持有策略、负责调用的调用方。例:checkout。

一句话: **上下文只认接口,具体策略随便换**。这正是上一课学的依赖抽象,第一次实战。

## 知识点 3:重构——先定接口,再填实现

```python
from abc import ABC, abstractmethod


class Discount(ABC):                  # ① 策略接口:约定「怎么打折」
    @abstractmethod
    def apply(self, total): ...


class NoDiscount(Discount):           # ② 具体策略 1:普通
    def apply(self, total):
        return total


class GoldDiscount(Discount):         # ② 具体策略 2:黄金
    def apply(self, total):
        return total * 0.95


class PlatinumDiscount(Discount):     # ② 具体策略 3:铂金
    def apply(self, total):
        return total * 0.90


def checkout(order, discount: Discount):   # ③ 上下文:只认接口
    return discount.apply(order.total)


checkout(order, GoldDiscount())       # 用法:传入哪个策略,就是哪种折扣
```

对比重构前,三个问题全解决:

- **加等级 = 新增一个类**,`checkout` 一行不改(开闭原则)
- 每个策略独立成类,**单独可测**:`GoldDiscount().apply(100)` 直接断言
- 分支逻辑不再嵌套,每段都是平铺的小类

## 知识点 4:Python 特色——函数就是策略

经典教材里策略都是类(因为 Java 没有一等函数)。Python 里,**一个函数/可调用对象就是一个现成的策略**,更轻:

```python
def checkout(order, discount):        # 上下文:传入任何「可调用对象」
    return discount(order.total)


def no_discount(total):
    return total


def gold_discount(total):
    return total * 0.95


def platinum_discount(total):
    return total * 0.90


checkout(order, gold_discount)        # 用法完全一样,少写了一堆类
```

再配合第一课学过的**注册表**,就形成了 AI 代码里最常见的组合:

```python
DISCOUNTS = {                         # 名字 → 函数 的注册表
    "normal": no_discount,
    "gold": gold_discount,
    "platinum": platinum_discount,
}


def make_discount(level: str):        # 工厂:按名字取策略
    if level not in DISCOUNTS:
        raise ValueError(f"未知等级: {level}")
    return DISCOUNTS[level]


checkout(order, make_discount("gold"))
```

如果你现在回头看第一课 `make_trainer()` 的代码,会发现它就是「注册表 + 工厂」——只不过第一课注册的是类,这里注册的是函数。套路是同一个。

## 知识点 5:策略模式其实无处不在

你早就用过策略模式,只是没意识到:

```python
# Python 内置的 sorted:key 参数就是「策略」
sorted(names, key=len)                # 按长度排:一个策略
sorted(names, key=str.lower)          # 按字典序排:换一个策略
sorted(names, key=lambda s: -len(s))  # 自定义策略,都不用改 sorted 源码

# 训练模型时传不同的模型对象,也是策略
trainer = make_trainer("svm")         # 换个名字,行为就换了
```

认出来的好处:以后看到「函数作为参数传进来」「对象里有可替换的方法」,你就能说出这是策略模式——**这就是能参与讨论的词汇量**。

## 知识点 6:什么时候别用

设计模式不是越多越好。策略模式只值得用在:

- 同一行为确实有**多个版本且会继续增加**(折扣、排序、压缩、加密、计价……)
- 分支逻辑**会变化**(加一个策略就要改一次调用方,才是真痛点)

如果就两三个分支、两年没变过,直接用 if/else 更简单——**过度设计比没有设计更糟**。判断标准一句话:分支在「变」,就用策略;分支在「死」,别折腾。

## 练习

打开 `practice/architecture/0003_策略模式.ipynb`:

- **练习 A**:找出 if/else 版折扣代码的问题,然后用「策略类」重构(先自己写再对答案)
- **练习 B**:把同一个需求用「函数策略 + 注册表」再写一遍,对比两种写法的取舍
- **练习 C**:判断 5 个场景该不该用策略模式(答案内联在文件里)

## 测验

### 测验 1
策略模式想解决什么?
- A. 消灭条件判断
- B. 隔离不同算法(正确)
- C. 简化所有代码
- D. 加速运行速度

<details>
<summary>答案与解析</summary>

**答案：B**。不是消灭 if/else 本身,而是把每个分支里的「算法」隔离成独立单元,各自可替换、可测试。
</details>

### 测验 2
调用策略的是哪个?
- A. 策略接口类
- B. 具体策略类
- C. 抽象算法类
- D. 上下文对象(正确)

<details>
<summary>答案与解析</summary>

**答案：D**。上下文(Context)持有策略并调用它;策略接口只是约定,具体策略是约定的一份实现。
</details>

### 测验 3
Python 里策略可以是?
- A. 私有内部类
- B. 全局常量值
- C. 普通函数对象(正确)
- D. 泛型数据结构

<details>
<summary>答案与解析</summary>

**答案：C**。函数/可调用对象本身就是策略;类策略适合「带状态」的策略,函数策略更轻。
</details>

## 推荐阅读

> **Refactoring Guru · 策略模式**([中文版](https://refactoringguru.cn/design-patterns/strategy)):读「问题-解决方案-结构」三段,对照本课的折扣例子,再看一眼「真实世界类比」——交通应用里的导航策略。

## 下一步

做完练习回来告诉我:练习 B 里函数策略和类策略你更喜欢哪个?为什么?下一课进入**工厂模式(Factory)**——你已经在第一课见过注册表工厂,下一课我们会把它和「为什么 AI 代码爱用工厂」讲透。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/架构/0002-接口与多态-abc和protocol/) | [课程目录](/my-blog/posts/架构/00-总览/) | [下一课 →](/my-blog/posts/架构/0004-工厂模式-把创建和用分开/) |