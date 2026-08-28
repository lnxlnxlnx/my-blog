---
title: dataclass 与类
published: 2026-08-15
description: Pythonic 系列第 6 课：用 @dataclass 三行搞定「数据袋子」类，少写 C++ 样板，掌握默认值/factory、类型提示与 @property 的用法。
tags: [Pythonic, dataclass, 类, property, 类型提示]
category: Pythonic
draft: false
prevTitle: 常用标准库
prevSlug: "pythonic/0007-常用标准库"
nextTitle: 字典惯用法
nextSlug: "pythonic/0005-字典惯用法"
---

# dataclass 与类

这是 Pythonic 系列课程笔记的第 6 课，预计 20 分钟。C++ 里定义一个「只是个数据袋子」的结构,你得写构造函数 + getter + setter + 一堆样板。Python 里你想表达「这是个带几个字段的东西」,**`@dataclass`** 三行搞定,还能顺便免费得到 `==`、打印、排序能力。本课还讲清 Python 的 `property` 为什么不需要 getter/setter。

## 知识点 1:普通类 vs dataclass——少写样板

C++ 思维(手写 __init__ 逐字段赋值):

```python
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y
    def __repr__(self):
        return f"Point({self.x}, {self.y})"
    def __eq__(self, other):
        return self.x == other.x and self.y == other.y
```

Pythonic——`@dataclass` 声明字段类型即可,自动生成 __init__/__repr__/__eq__:

```python
from dataclasses import dataclass

@dataclass
class Point:
    x: float
    y: float

p1 = Point(1.0, 2.0)
p2 = Point(1.0, 2.0)
print(p1)            # Point(x=1.0, y=2.0)  ← 自动 __repr__
p1 == p2             # True  ← 自动 __eq__(逐字段比)
```

要点:凡是「主要就是装几个字段」的类,用 `@dataclass`。**字段等于直接拼 setter/构造函数的样板**。

## 知识点 2:字段可以有默认值和类型提示

C 思维要给默认值得在构造里写一堆;dataclass 直接在字段上声明:

```python
from dataclasses import dataclass, field

@dataclass
class User:
    name: str
    age: int = 0               # 默认值
    tags: list = field(default_factory=list)  # 可变默认值要用 factory
```

注意:`tags: list = []` 会踩「共享可变默认值」的坑(所有实例共用一个 list),所以要用 `field(default_factory=list)`。`age: int = 0` 这种不可变默认值直接等号即可。

## 知识点 3:Type hints(类型提示)是给人和工具看的,不是强类型

C 程序员可能疑惑:`x: float` 会不会像 C 一样强制类型?**不会。**Python 类型提示默认不强制,运行时传什么都能过;它是给 IDE 补全、类型检查器(如 mypy)、读代码的同事看的「意图声明」。

```python
def add(a: int, b: int) -> int:
    return a + b

print(add("x", "y"))    # 运行时照常执行:'xy' —— 提示不强制
```

别把类型提示当成编译器约束。`@dataclass` 字段用类型提示只是为了「声明有哪些字段 + 默认值」,顺便让 IDE 补全。

## 知识点 4:什么时候根本不需要 getter/setter——用属性(property)

C++ 习惯「私有成员 + getX()/setX()」。Python 里字段通常直接公开访问(`obj.x`),只有当你需要「取值时做点计算/校验」才用 `@property`。而且从「普通字段」升级到 property**不用改调用方**:

```python
class Circle:
    def __init__(self, radius):
        self.radius = radius

    @property
    def area(self):                # 用起来像个字段,不用加括号
        return 3.14159 * self.radius ** 2

c = Circle(2)
print(c.area)                      # 12.56636,不是 c.area()
```

调用方 `c.radius` 和 `c.area` 长得一样,都是「字段样」;`area` 其实是方法,每次现算。这就是「属性让你以后想加逻辑时不必改接口」。

## 知识点 5:dataclass 还能排序、加 setter

加 `order=True` 自动生成比较("<", "<="...);配合 `frozen=True` 变成只读(像 const):

```python
from dataclasses import dataclass

@dataclass(order=True)
class Student:
    grade: int
    name: str

s = sorted([Student(80, "Ann"), Student(90, "Bob")])  # 按 grade 排
```

需要只读:`@dataclass(frozen=True)`,之后给字段赋值会报错——相当于 C 的 const 对象思路。

## 练习

打开 `practice/pythonic/0006_dataclass与类.ipynb`:

- **练习 A**:把手写 __init__ 的 Point 类改成 dataclass,再对答案
- **练习 B**:定义 User dataclass(带默认值 + 可变字段)、定义带 @property 面积计算的类
- **练习 C**:训练 repo 里某个手写构造/getter 的类 -> 改造成 dataclass / property

## 测验

### 测验 1
定义「装几个字段」的类,首选?
- A. 手写全套 __init__
- B. @dataclass(正确)
- C. 普通 dict
- D. property

<details>
<summary>答案与解析</summary>

**答案：B**。@dataclass 自动生成 __init__/__repr__/__eq__,省样板。
</details>

### 测验 2
可变默认值 tags: list 该怎么写?
- A. tags: list = []
- B. field(default_factory=list)(正确)
- C. tags: list = None
- D. 不用默认值

<details>
<summary>答案与解析</summary>

**答案：B**。可变默认值要用 default_factory,避免所有实例共享同一个 list。
</details>

### 测验 3
x: float 类型提示运行时会强制吗?
- A. 会强制
- B. 不强制(正确)
- C. 只有 debug 模式强制
- D. 只对类字段强制

<details>
<summary>答案与解析</summary>

**答案：B**。类型提示默认不强制,是给 IDE/检查器/人看的意图声明。
</details>

### 测验 4
想把「可选计算逻辑」加给字段,又不改调用方?
- A. 加 getter 方法
- B. @property(正确)
- C. 改回 dict
- D. 加倍 __init__ 参数

<details>
<summary>答案与解析</summary>

**答案：B**。@property 让它「用起来像字段、其实是方法」,后续加逻辑不必改调用代码。
</details>

## 推荐阅读

> **Python 官方文档「[dataclasses 模块](https://docs.python.org/zh-cn/3/library/dataclasses.html)」**和「[property 内置函数](https://docs.python.org/zh-cn/3/library/functions.html#property)」:dataclass 的完整参数与 property 的 getter/setter 用法,各 15 分钟。

## 下一步

做完回来告诉我:dataclass 有没有让你觉得「少写了几十行」?下一课讲**常用标准库**——itertools / pathlib / collections,那些 C 里得手写的东西。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/pythonic/0005-字典惯用法/) | [课程目录](/my-blog/posts/pythonic/00-总览/) | [下一课 →](/my-blog/posts/pythonic/0007-常用标准库/) |