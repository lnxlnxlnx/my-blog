---
title: 字符串与 f-string
published: 2026-08-13
description: Pythonic 系列第 4 课：用 f-string 取代 sprintf 与 + 拼接，join 拼串、格式化对齐补零、split/strip/replace 链式处理字符串。
tags: [Pythonic, 字符串, f-string, join]
category: Pythonic
draft: false
prevTitle: 字典惯用法
prevSlug: "pythonic/0005-字典惯用法"
nextTitle: 真值与空判断
nextSlug: "pythonic/0003-真值与空判断"
---

# 字符串与 f-string

这是 Pythonic 系列课程笔记的第 4 课，预计 20 分钟。C 里拼字符串很痛苦(sprintf、strcat、%d %s 占位符)。而 Python 有一个优雅得多的方案:**f-string**——直接在字符串里写花括号塞变量。本课把「拼串」「格式化」「拆分」一次说清。

## 知识点 1:别用 + 拼字符串(不是不行,只是费劲)

C 思维(拼接、占位符):

```python
name = "Alice"
age = 25
s = "Name: " + name + ", age: " + str(age) + " years"
# 或用 C 风格：s = "Name: %s, age: %d years" % (name, age)
```

Pythonic——f-string,字符串前加 `f`,花括号 `{}` 里直接写变量或表达式:

```python
name = "Alice"
age = 25
s = f"Name: {name}, age: {age} years"
```

还能在花括号里做运算、调函数、取下标:

```python
price = 3.14159
print(f"{price:.2f}")          # 3.14:保留两位小数
print(f"upper: {name.upper()}")  # upper: ALICE
```

要点:能写 `f"..."` 的地方就别 `"..." + ...`,这是 Python 3.6+ 的标准答案。

## 知识点 2:拼一串列表——用 join,别用循环 append

C 程序员想把单词拼成逗号分隔的字符串,常写循环:

```python
words = ["apple", "banana", "cherry"]
s = ""
for i, w in enumerate(words):
    if i > 0:
        s += ", "
    s += w
```

Pythonic——用 `str.join`,一句话,还自动处理分隔符:

```python
words = ["apple", "banana", "cherry"]
s = ", ".join(words)            # 'apple, banana, cherry'
```

注意语法是 `分隔符.join(序列)`,别记反。注意序列里的得是字符串,数字先转:`", ".join(map(str, nums))`。

## 知识点 3:格式化对齐、补零——f-string 的格式符

f-string 花括号里 `:` 后面是格式说明,和 C 的 printf 很像但不那么吓人:

```python
print(f"{name:<10}")   # 左对齐,占 10 宽(<10)
print(f"{age:>5}")     # 右对齐,占 5 宽
print(f"{age:03d}")    # 补零:025
print(f"{x:08.2f}")    # 008.14:总宽 8,两位小数,补零
```

记法:`{值:</>宽度.精度f}`。用到再查,先记住「`:` 后面就是格式」这个位置。

## 知识点 4:split 拆字符串、strip 去空白、replace 替换

C 的 strtok 很啰嗦;Python 直接链式:

```python
line = "  apple, banana ,  cherry  "
parts = line.split(",")            # ['  apple', ' banana ', '  cherry  ']
cleaned = [p.strip() for p in parts]  # ['apple','banana','cherry']
text = "a.b.c.d"
text.replace(".", "-")             # 'a-b-c-d'
text.split(".", 2)                 # 只拆前 2 个:['a','b','c.d']
```

顺带一提:很多统计/去重不用纯循环。`split + strip + 推导式` 一条链就是一次完整解析。

## 练习

打开 `practice/pythonic/0004_字符串与f-string.ipynb`:

- **练习 A**:把用 + 拼接和 printf 风格的代码改成 f-string,再对答案
- **练习 B**:join 拼接成绩单、按分数右对齐补零格式化输出表格
- **练习 C**:解析一行 CSV(拆+去空格)、训练 repo 里一段字符串处理代码

## 测验

### 测验 1
插入变量 age 的现代写法?
- A. "%d" % age
- B. f"{age}"(正确)
- C. " + str(age)
- D. sprintf(age)

<details>
<summary>答案与解析</summary>

**答案：B**。Python 3.6+ 用 f-string:f"{age}",花括号里直接写变量。
</details>

### 测验 2
把 lst 拼成逗号分隔字符串?
- A. "".join(lst)
- B. ", ".join(lst)(正确)
- C. lst.join(",")
- D. 用循环 append

<details>
<summary>答案与解析</summary>

**答案：B**。语法是 分隔符.join(序列),在其中是 ", "。
</details>

### 测验 3
f"{x:08.2f}" 表示?
- A. 十六进制
- B. 补零两位小数(正确)
- C. 布尔值
- D. 科学计数

<details>
<summary>答案与解析</summary>

**答案：B**。08 = 占 8 宽不足补零,.2f = 保留两位小数。
</details>

### 测验 4
去掉字符串首尾空白用?
- A. split()
- B. strip()(正确)
- C. replace(" ","")
- D. trim()

<details>
<summary>答案与解析</summary>

**答案：B**。strip() 去首尾空白;split() 是拆分,别混。
</details>

## 推荐阅读

> **Python 官方教程「[格式化字符串字面量](https://docs.python.org/zh-cn/3/tutorial/inputoutput.html)」**一章:f-string 的全部格式说明符,半小时可刷完。

## 下一步

做完回来告诉我:拼字符串最困扰你的是什么场景?下一课讲**字典惯用法**——C 程序员的 struct/查找表怎么用 Python dict 用得漂亮。

**有任何不懂的,直接问我——我是你的老师。**

| [← 上一课](/my-blog/posts/pythonic/0003-真值与空判断/) | [课程目录](/my-blog/posts/pythonic/00-总览/) | [下一课 →](/my-blog/posts/pythonic/0005-字典惯用法/) |