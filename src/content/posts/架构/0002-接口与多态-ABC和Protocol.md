---
title: 接口与多态:ABC 和 Protocol
published: 2026-08-20
description: 架构与设计模式第 2 课:多态/接口/依赖抽象三件套、Python 鸭子类型、ABC 运行时强制契约、Protocol 结构型接口,以及 ABC vs Protocol 的选择表。
tags: [架构, Python, 多态, 接口, ABC, Protocol]
category: 架构
draft: false
prevTitle: 策略模式:消灭一堆 if/else
prevSlug: "架构/0003-策略模式-消灭一堆if-else"
nextTitle: 读懂复杂代码的三个尺度与四步读法
nextSlug: "架构/0001-读懂复杂代码的三个尺度与四步读法"
---

# 接口与多态:ABC 和 Protocol

上一课你在 `BaseTrainer` 里见过 `@abstractmethod`(抽象基类 ABC),但没细讲。这是所有设计模式的**地基**:一切「多个类可以替换着用」的魔法,都靠三样东西——**多态**(Polymorphism)、**接口**(Interface)、**依赖抽象**(Depend on Abstractions)。这节课把它们一次讲透。

## 知识点 1:多态 = 同一接口,不同行为

**多态(Polymorphism)**:调用方写一套代码,传入不同对象,得到不同结果——但调用方式完全不变。它让代码**可替换**:

- **接口 Interface**:「会做什么」的约定:有哪些方法、什么签名。是抽象。
- **实现 Implementation**:「怎么做」的具体代码。是血肉。
- **依赖抽象**:调用方只认接口,不认具体类 → 想换实现,不用改调用方。

你在上一课的 `make_trainer()` 已经体验过:调用方只认识 `BaseTrainer`,`SVMTrainer` / `LogisticRegressionTrainer` 随你换。这就是多态。

## 知识点 2:Python 的默认姿态——鸭子类型

Python 天生「不检查接口」,只要对象**恰好具备**你要的方法,就能用。这就是鸭子类型(Duck Typing):「看到一只鸟,走路像鸭子、叫声像鸭子,那就是鸭子。」

```python
def train_and_score(trainer, data):
    """调用方:根本不关心 trainer 是什么类,只认三个方法。"""
    x, y = trainer.preprocess(data)
    model = trainer.build()
    trainer.fit(model, x, y)
    return trainer.evaluate(model, x, y)


class SVMTrainer:          # 没有任何父类,照样能用
    def preprocess(self, data): return scale(data)
    def build(self):       return SVC()
    def fit(self, model, x, y): model.fit(x, y)
    def evaluate(self, model, x, y): return model.score(x, y)


class LogisticTrainer:     # 换一个,调用方代码一行不改
    def preprocess(self, data): return scale(data)
    def build(self):       return LogisticRegression()
    def fit(self, model, x, y): model.fit(x, y)
    def evaluate(self, model, x, y): return model.score(x, y)
```

好处:灵活。代价:接口只是**口头约定**——写错方法名,只有运行到那一行才爆炸:

```python
class WrongTrainer:                 # 忘了实现 fit
    def preprocess(self, data): return scale(data)
    def build(self):       return SVC()
    # fit 不见了


train_and_score(WrongTrainer(), data)
# AttributeError: 'WrongTrainer' object has no attribute 'fit'
# ← 一直跑到第 5 行才报错,调试窗口在「死得最晚」的地方
```

## 知识点 3:ABC = 运行时强制契约

**抽象基类 ABC(Abstract Base Class)**给接口装上「强制」:`@abstractmethod` 标记的方法,子类**必须实现**。不实现?**连对象都建不出来**,在创建的那一刻就拒绝,而不是在调用方法时。

```python
from abc import ABC, abstractmethod


class BaseTrainer(ABC):
    @abstractmethod
    def fit(self, model, x, y): ...   # 契约:子类必须实现


class WrongTrainer(BaseTrainer):      # 没实现 fit
    pass


WrongTrainer()
# TypeError: Can't instantiate abstract class WrongTrainer
# with abstract method fit      ← 创建即失败,错误提前
```

这比鸭子类型**更早暴露错误**,也是上一课 AI 代码用它的原因。ABC 还会「认亲」:

```python
class BaseTrainer(ABC): ...


t = SVMTrainer()                       # 继承 BaseTrainer 的类
print(isinstance(t, BaseTrainer))      # True —— 认子类

# 想把「没有继承关系」的类也认下来(虚拟子类):
BaseTrainer.register(第三方Trainer)
print(isinstance(第三方Trainer(), BaseTrainer))   # True
```

## 知识点 4:Protocol = 结构型接口(最 Pythonic)

ABC 要求**子类关系**(你得继承我)。但很多时候,我们只是想要「形状对」——**Protocol**(PEP 544,Python 3.8+)描述形状,不要求继承:

```python
from typing import Protocol, runtime_checkable


@runtime_checkable
class TrainerProtocol(Protocol):       # 只声明「形状」,谁都不用继承
    def preprocess(self, data): ...
    def build(self): ...
    def fit(self, model, x, y): ...
    def evaluate(self, model, x, y): ...


class SVMTrainer:                      # 没关系,形状对就行
    def preprocess(self, data): return scale(data)
    def build(self):       return SVC()
    def fit(self, model, x, y): model.fit(x, y)
    def evaluate(self, model, x, y): return model.score(x, y)


print(isinstance(SVMTrainer(), TrainerProtocol))   # True,纯看形状


CVCLikeReader = ...       # 例如:凡是「有 .read() 方法」的对象都能当文件用
```

关键区别:**Protocol 是鸭子类型的「正式化」**——不强制任何继承关系,只检查你有没有对的方法;还配合 mypy/pyright 做静态检查(写代码时就提示)。

## 知识点 5:ABC 还是 Protocol?一张表选明白

- **选 ABC**:接口是你**自己控制**的、子类必须实现全部钩子、还想要共享的默认行为(像 `BaseTrainer.run` 骨架)。
- **选 Protocol**:接口**不属于你**,要接受「任何形状相似的对象」(第三方类、文件、迭代器);或主要想给 IDE/静态检查用。

经验法则:你和接口「天天要强约束」→ ABC;「只想约定形状、对象来自各处」→ Protocol。AI 生成的代码里最常见的是 ABC——现在你完全能读懂它了。

## 练习

打开 `practice/architecture/0002_接口与多态.ipynb`,练习要求:

- **练习 A**:用 ABC 定义 `Shape` 接口(area / perimeter),实现 `Circle` 和 `Square`,并确认「漏实现 = 建不出来」
- **练习 B**:用 `Protocol` 定义同一个 `Shape`,验证「形状对就行」——甚至让一个毫无关系的类通过 isinstance
- **练习 C**:判断题:5 个场景选 ABC 还是 Protocol(答案内联在文件里)

## 测验

### 测验 1
ABC 缺方法,何时会报错?
- A. 创建对象时候(正确)
- B. 调用方法时候
- C. 定义类的时候
- D. 永远不会报错

<details>
<summary>答案与解析</summary>

**答案：A**。创建即失败(TypeError)——这就是 ABC 的价值:把错误从「运行很深」提前到「创建那一下」。
</details>

### 测验 2
哪个最贴近鸭子类型?
- A. 抽象基类 ABC
- B. 协议 Protocol(正确)
- C. 普通继承类
- D. 全局单例类

<details>
<summary>答案与解析</summary>

**答案：B**。Protocol 只检查方法形状、不要求继承关系,正是「走路像鸭子」的正式化版本。
</details>

### 测验 3
结构检查需要加什么?
- A. 继承父类
- B. runtime_check(正确)
- C. 导入扩展库
- D. 声明接口表

<details>
<summary>答案与解析</summary>

**答案：B**。用 @runtime_checkable 装饰 Protocol,isinstance() 才会真正检查;注意:它只查「方法存在」,不查签名。
</details>

## 推荐阅读

> **PEP 544**([Protocol 权威定义](https://peps.python.org/pep-0544/)):读「Introduction」和「Protocols vs concrete classes」两节,理解 Python 为什么需要它。
>
> **Python 官方 abc 文档**([abc 模块](https://docs.python.org/3/library/abc.html)):扫一遍 `abstractmethod` 和 `register` 的说明。

## 下一步

作业做完回来告诉我:练习 B 里 Protocol 认下了哪个「毫无关系」的类?下一课进入第一个真正的设计模式:**策略模式(Strategy)**——你会发现它就是用接口 + 多态解决「一堆 if/else」的问题。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/架构/0001-读懂复杂代码的三个尺度与四步读法/) | [课程目录](/my-blog/posts/架构/00-总览/) | [下一课 →](/my-blog/posts/架构/0003-策略模式-消灭一堆if-else/) |