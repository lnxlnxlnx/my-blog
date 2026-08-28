---
title: Qt 开发：02 QML 核心与常用组件
published: 2026-08-12
description: QML 语法、布局、常用组件与 API、动画、Canvas、Loader。
tags: [Qt, QML, 组件]
category: Qt
draft: false
prevTitle: "Qt 开发：03 QML 与 C++ 混合编程"
prevSlug: "qt/03-qml与c++交互"
nextTitle: "Qt 开发：01 工程与系统框架"
nextSlug: "qt/01-工程与框架"
---

# 02 QML 核心与常用组件

QML 是一种**声明式**语言：你"描述"界面长什么样，Qt 负责画出来。语法类似 JSON + JavaScript。

## 1. 基础语法

```qml
import QtQuick 2.12                    // 导入模块(几乎每个文件都要)

Rectangle {                            // 类型名 { } = 创建一个对象
    width: 100                         // 属性: 值
    height: 100
    color: "red"
    radius: 10                         // 圆角
}
```

- **每个元素都有类型、id、属性**。`id` 用来在别处引用它。
- **属性可以绑定表达式**：`width: parent.width * 0.5`，当父宽度变化时自动跟随（这就是"绑定"，比命令式方便太多）。
- **信号处理**：`onClicked: { ... }` 对应 `clicked` 信号。

## 2. 布局与容器

| 组件 | 作用 | 例子 |
|------|------|------|
| `Item` | 最基础容器（透明，不绘制） | 组合多个元素 |
| `Rectangle` | 带颜色/圆角/边框的矩形 | 背景、按钮底 |
| `Image` | 显示图片 | 图标、照片 |
| `Row` | 水平排布子元素 | 一行按钮 |
| `Column` | 垂直排布子元素 | 菜单列表 |
| `Grid` | 网格排布 | 九宫格拼图 |
| `StackLayout` | 叠放，一次显示一个 | 页面切换 |
| `Flickable` | 可滑动区域 | 长列表 |
| `ListView` | 数据列表（配合 model） | 排行榜 |
| `GridView` | 数据网格 | 相册 |
| `Repeater` | 按 model 重复生成 | 卡片 |

**Row / Column 示例**（来自拼图游戏）：
```qml
Column {
    anchors.centerIn: parent
    spacing: 14                       // 子元素间距
    Text { text: "拼图"; font.pixelSize: 32; color: "#2e7d32" }
    Row {
        spacing: 20
        Button { text: "打乱" }
        Button { text: "返回" }
    }
}
```

**anchors（锚点）** 是最常用的定位方式：
```qml
Rectangle {
    anchors.fill: parent              // 填满父
    anchors.centerIn: parent          // 居中
    anchors.left: parent.left
    anchors.leftMargin: 16            // 左边距
    anchors.verticalCenter: parent.verticalCenter
}
```

## 3. 常用显示组件

### Text —— 文字
```qml
Text {
    text: "得分 " + score             // 可拼接, score 变化自动更新
    color: "#ffd54f"
    font.pixelSize: 24                // 像素字号(嵌入式常用)
    font.bold: true
    font.family: "Times"
    anchors.horizontalCenter: parent.horizontalCenter
}
```
> 嵌入式没有高 DPI 缩放，用 `font.pixelSize` 比 `pointSize` 更可控。

### Image —— 图片
```qml
Image {
    source: "qrc:/photo/mushroom1.png"   // 资源里的图
    width: 40; height: 40
    fillMode: Image.PreserveAspectFit    // 保持比例
}
// 从 C++ 提供动态图(摄像头预览): 用 ImageProvider
Image { source: "image://digitpreview/frame" }
```

### Button —— 按钮（QtQuick.Controls 2）
```qml
import QtQuick.Controls 2.12
Button {
    text: "开始"
    width: 240; height: 60
    font.pixelSize: 26
    onClicked: { ... }                // 点击
}
```

### 输入类
```qml
TextField { width: 220; height: 40; text: "玩家" }      // 单行文本(配虚拟键盘)
TextInput  { }                                           // 底层文本输入
Switch { checked: true }                                 // 开关
Slider { from: 0; to: 100; value: 50 }                   // 滑条(音量/亮度)
```

## 4. 鼠标/触摸交互

```qml
MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    onClicked: root.tryMove(index)        // 点击
    onPressed: root.touchFire = 1         // 按下
    onReleased: root.touchFire = 0        // 松开
    onPositionChanged: { ... }            // 拖动
}
```
> 触摸屏底层由 tslib 转成鼠标事件，所以 QML 里 `MouseArea` 同时处理触摸和鼠标。

## 5. 动态加载 Loader 与页面切换

`Loader` 按需加载 QML 文件，是"多页面 App"的骨架。mytest 的小游戏切换：

```qml
property string page: "menu"
Loader {
    id: loader
    anchors.fill: parent
    source: p === "puzzle" ? "PuzzleGame.qml"
          : p === "mine"   ? "MinesweeperGame.qml"
          : ""
    onLoaded: {                          // 加载完成
        if (item && item.backToMenu)     // 连接子页面的返回信号
            item.backToMenu.connect(function() { root.showPage("menu") })
    }
}
function showPage(p) { root.page = p; loader.source = ... }
```
子页面（如 PuzzleGame.qml）：
```qml
Item {
    signal backToMenu()                  // 声明返回信号
    Button { text: "返回"; onClicked: root.backToMenu() }
}
```
**这就是 App 内多页面的标准做法**：Loader + 信号。

## 6. 状态 State 与动画

```qml
Rectangle {
    id: box
    states: State {
        name: "big"
        PropertyChanges { target: box; width: 200; height: 200 }
    }
    transitions: Transition {            // 状态切换动画
        NumberAnimation { properties: "width,height"; duration: 200 }
    }
}
// 触发: box.state = "big"
```

**数字动画**（逐帧驱动游戏/进度）：
```qml
NumberAnimation { target: obj; property: "x"; to: 300; duration: 1000 }
```

**Timer 定时器**（游戏循环的核心）：
```qml
Timer {
    interval: 16                         // 16ms ≈ 60fps
    repeat: true
    running: true
    onTriggered: { /* 每帧更新逻辑 */ }
}
```

**SequentialAnimation + Behavior**：
```qml
Behavior on scale { NumberAnimation { duration: 90 } }   // 属性变化时平滑过渡
SequentialAnimation on height { loops: Animation.Infinite  // 循环动画
    NumberAnimation { to: 8; duration: 120 }
    NumberAnimation { to: 16; duration: 120 }
}
```

## 7. Canvas —— 2D 绘制

Qt Quick 自带 Canvas（类似 HTML5 Canvas），用来画游戏场景、图表（性能好，嵌入式可跑到 30fps）：

```qml
Canvas {
    width: 300; height: 300
    onPaint: {
        var ctx = getContext("2d")
        ctx.clearRect(0, 0, width, height)
        ctx.fillStyle = "#43a047"
        ctx.fillRect(10, 10, 50, 50)          // 画方块
        ctx.beginPath()
        ctx.arc(150, 150, 40, 0, Math.PI*2)   // 画圆
        ctx.fill()
    }
}
```
更新画面：改数据后调 `canvas.requestPaint()`。

> 案例：mytest 的贪吃蛇/俄罗斯方块/太空射击全部用 Canvas 画棋盘和精灵，比堆 Rectangle 高效得多（单核 A7 上关键）。

## 8. 屏幕适配

板子屏幕 800x480，但设计稿常用 1024 宽度基准：
```qml
property real scaleFactor: window.width / 1024   // 换算系数
// 用到尺寸的地方: width: 300 * scaleFactor
```
或用 `anchors.fill` + 百分比（`parent.width * 0.5`）自适应。

## 9. 模块化：组件 component / 独立 QML 文件

**独立文件即组件**（同目录自动可见）：如 `mytest/TouchBtn.qml` 定义了按钮，别处直接 `TouchBtn { text: "A" }`。

> ⚠️ Qt 5.12 不支持 `component Xxx:` 内联组件语法（那是 5.15 才有）。要复用组件就**写成独立 .qml 文件**。
| [← 上一课](/my-blog/posts/qt/03-qml与c++交互/) | [课程目录](/my-blog/posts/qt/00-总览/) | [下一课 →](/my-blog/posts/qt/01-工程与框架/) |
