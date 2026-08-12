---
title: Fluid 组件库使用说明
published: 2026-08-12
description: Liri Fluid（Material Design）QML 组件库在 i.MX6ULL 上的自包含式 qrc 移植说明。
tags: [嵌入式, Qt, QML, Fluid]
category: 嵌入式开发
draft: false
---

# Fluid 组件库使用说明

Liri Fluid（MPL-2.0）是一套遵循 Material Design 规范的 QtQuick/QML 组件库。本文档基于本仓库 `qt_dev/fluid_demo/` 的实际移植（自包含式 qrc 集成，适配 i.MX6ULL 无 GPU 软件渲染）编写。

## 1. 简介

| 项目 | 说明 |
|---|---|
| 来源 | https://github.com/lirios/fluid （v1.3.0，MPL-2.0） |
| 移植方式 | 全部 QML/C++ 源码随工程打包进 qrc 资源，C++ 类型直接在 `main.cpp` 里注册，**不依赖**板子上安装额外的 QML 插件 `.so` |
| 演示程序 | `qt_dev/fluid_demo/`，桌面图标名 `Fluid组件演示`，可执行文件 `fluid_demo` |

组件分成 5 个子模块，对应 QML import：

| QML 模块 | import 版本 | 内容 |
|---|---|---|
| `Fluid.Core` | 1.0 | 基础工具（`Object`） |
| `Fluid.Templates` | 1.0 | 模板（`Card`） |
| `Fluid.Controls` | 1.0 / 1.1 | 常用控件（大部分组件在这里） |
| `Fluid.Layouts` | 1.0 | 布局（`AutomaticGrid`、`ColumnFlow`） |
| `Fluid.Effects` | 1.0 | 视觉效果（`Elevation`、`BoxShadow` 等） |

## 2. 工程结构

```
fluid_demo/
├── main.cpp                  # 注册 Fluid C++ 类型 + 图片提供器
├── main.qml                  # 主界面：AppBar + NavigationDrawer + StackView
├── fluid_demo.pro            # 工程配置
├── qml.qrc                   # 本程序自己的 qml/页面/图片
├── fluid.qrc                 # Fluid 模块(qmldir+qml) + Material 图标(svg)
├── fluid/
│   ├── core/                 # Fluid.Core（含 C++ 插件源码）
│   ├── templates/            # Fluid.Templates
│   ├── controls/             # Fluid.Controls（控件 + 图标 svg + C++ 插件源码）
│   ├── layouts/              # Fluid.Layouts
│   └── effects/              # Fluid.Effects
└── pages/                    # 演示页面（首页/按钮/列表/输入/对话框/底部面板/排版/卡片/图标）
```

### 2.1 fluid.qrc 的挂载原理

Fluid 的 QML 模块不是安装到板子的系统目录，而是把每个模块目录做成一个 qrc 资源前缀，资源里带上 `qmldir`，运行时靠 `engine.addImportPath("qrc:/")` 让 import 解析到：

```xml
<qresource prefix="/Fluid/Controls">
    <file alias="qmldir">fluid/controls/qmldir</file>
    <file alias="AppBar11.qml">fluid/controls/AppBar11.qml</file>
    ...
</qresource>
<qresource prefix="/liri.io/imports/Fluid/Controls">
    <file alias="icons/action/home.svg">fluid/controls/icons/action/home.svg</file>
    ...
</qresource>
```

`main.cpp` 里对应三件事（缺一不可）：

```cpp
engine.addImportPath(QStringLiteral("qrc:/"));                       // 1. import 路径
engine.addImageProvider(QStringLiteral("fluidicontheme"), ...);       // 2. 图标提供器
FluidControlsPlugin().registerTypes("Fluid.Controls");                // 3. C++ 类型
```

### 2.2 fluid_demo.pro 关键配置

```pro
QT += quick quickcontrols2 svg remoteobjects
DEFINES += FLUID_INSTALL_ICONS=0        # 图标从 qrc 加载（0=用 qrc，1=用本地文件）
INCLUDEPATH += fluid fluid/core fluid/templates fluid/controls
# SOURCES/HEADERS 里把 fluid/core、fluid/templates、fluid/controls 下的 .cpp/.h 全部加入
RESOURCES += qml.qrc fluid.qrc
include(../client/client.pri)            # 与 systemui 通信
unix: target.path = /opt/ui/src/apps     # 部署到桌面的 apps 目录
```

## 3. 集成到自己的新工程

以把 Fluid 用进一个新 App（例如 `myapp`）为例：

1. 把 `fluid_demo/fluid/` 整个目录拷贝到工程下（或直接用 `fluid_demo` 的 pro 当模板）。
2. `.pro` 增加 `QT += svg`、`DEFINES += FLUID_INSTALL_ICONS=0`、`INCLUDEPATH`、`fluid` 相关 `SOURCES/HEADERS`、`RESOURCES += fluid.qrc`。
3. `main.cpp` 注册（参考 `fluid_demo/main.cpp`）：

   ```cpp
   #include "core/coreplugin.h"
   #include "templates/templatesplugin.h"
   #include "controls/controlsplugin.h"
   #include "controls/iconthemeimageprovider.h"
   // ...
   QQuickStyle::setStyle(QStringLiteral("Material"));   // 推荐，配合 Material 主题
   qputenv("QT_QUICK_CONTROLS_MOBILE", "1");            // 小屏触摸设备行为
   FluidCorePlugin().registerTypes("Fluid.Core");
   FluidTemplatesPlugin().registerTypes("Fluid.Templates");
   FluidControlsPlugin().registerTypes("Fluid.Controls");
   engine.addImportPath(QStringLiteral("qrc:/"));
   engine.addImageProvider(QStringLiteral("fluidicontheme"), new IconThemeImageProvider());
   ```

4. QML 里按命名空间 import（避免与 QtQuick.Controls 的同名类型冲突）：

   ```qml
   import QtQuick 2.10
   import QtQuick.Controls 2.3
   import QtQuick.Controls.Material 2.3
   import Fluid.Controls 1.1 as FluidControls
   ```

> 用 `as FluidControls` 别名是惯例：`FluidControls.AppBar`、`FluidControls.ListItem`、`FluidControls.Utils.iconUrl(...)`。

## 4. 常用组件

### 4.1 页面骨架：AppBar + NavigationDrawer + StackView

`main.qml` 里的经典组合（本 demo 的布局）：

```qml
ApplicationWindow {
    // 顶部工具栏
    FluidControls.AppBar {
        title: window.currentPageTitle
        leftAction: FluidControls.Action {           // 左侧菜单按钮
            icon.source: FluidControls.Utils.iconUrl("navigation/menu")
            onTriggered: navDrawer.open()
        }
        actions: [                                    // 右侧动作
            FluidControls.Action {
                icon.source: FluidControls.Utils.iconUrl("action/search")
                onTriggered: searchBar.open()
            }
        ]
    }

    // 左侧抽屉导航
    FluidControls.NavigationDrawer {
        id: navDrawer
        topContent: Item { /* 顶部用户区 */ }
        ListView {
            delegate: FluidControls.ListItem {
                icon.source: FluidControls.Utils.iconUrl(model.icon)
                text: model.title
                onClicked: { stackView.replace(model.source); navDrawer.close() }
            }
        }
    }

    // 页面堆栈
    StackView {
        anchors.top: appBar.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        initialItem: Qt.resolvedUrl("qrc:/pages/HomePage.qml")
    }
}
```

### 4.2 文本排版

Material Design 字体层级，直接设 `text` 即可：

| 组件 | 用途 |
|---|---|
| `FluidControls.DisplayLabel` | 大标题（`level` 1~4） |
| `FluidControls.HeadlineLabel` | 页头标题 |
| `FluidControls.TitleLabel` | 标题 |
| `FluidControls.SubheadingLabel` | 副标题 |
| `FluidControls.BodyLabel` | 正文（`level` 1/2） |
| `FluidControls.CaptionLabel` | 说明文字 |
| `FluidControls.DialogLabel` | 对话框文本 |

### 4.3 按钮

- 普通按钮直接用 `Button`（Material 风格）：`highlighted`、`flat`、`enabled`。
- 图标按钮 `FluidControls.ToolButton`：

  ```qml
  FluidControls.ToolButton {
      icon.source: FluidControls.Utils.iconUrl("action/favorite")
      onClicked: window.openSnackBar("收藏")
  }
  ```

- 浮动按钮 `FluidControls.FloatingActionButton`（`highlighted`、`mini` 属性）。
- 芯片 `FluidControls.Chip`：

  ```qml
  FluidControls.Chip { text: "可删除"; deletable: true; onDeleted: ... }
  FluidControls.Chip { text: "可选中"; checkable: true; checked: true }
  ```

### 4.4 列表

`FluidControls.ListItem` 是 Material 列表项，支持 `text` / `subText` / `valueText` / `icon.source` / `leftItem` / `rightItem` / `secondaryItem`：

```qml
FluidControls.ListItem {
    icon.source: FluidControls.Utils.iconUrl("action/event")
    text: "带图标的列表项"
    subText: "副标题"
    valueText: "值"
    onClicked: { ... }
}

// 右侧放控件
FluidControls.ListItem {
    text: "带开关的列表项"
    rightItem: Switch { anchors.centerIn: parent }
}
```

配套 `FluidControls.Subheader`（分组标题）、`FluidControls.ThinDivider`（分隔线）、`FluidControls.NavigationListView`（导航列表）。

### 4.5 输入控件

文本/开关/复选/单选/滑块/进度条/忙碌指示器直接用 QtQuick.Controls 原生控件（Material 风格已全局生效）：

```qml
TextField { placeholderText: "请输入文本" }
Switch { text: "开关"; checked: true }
CheckBox { text: "复选" }
RadioButton { text: "单选" }
Slider { from: 0; to: 100; value: 60 }
ProgressBar { from: 0; to: 100; value: slider.value }
BusyIndicator { running: true }
```

### 4.6 对话框与提示

- 确认/消息框 `FluidControls.AlertDialog`（`text` + `standardButtons` + `onAccepted`）。
- 输入框 `FluidControls.InputDialog`（`textField.text` 取输入内容）。
- 底部提示条 `FluidControls.SnackBar`：

  ```qml
  FluidControls.SnackBar { id: snackBar }
  // 调用
  snackBar.open("这是一条提示消息", "撤销")
  ```

- 空状态占位 `FluidControls.Placeholder`：

  ```qml
  FluidControls.Placeholder {
      icon.source: FluidControls.Utils.iconUrl("social/notifications_none")
      text: "暂无通知"
      subText: "当前没有任何新的通知消息"
  }
  ```

### 4.7 底部面板

`FluidControls.BottomSheetList`（列表式）和 `FluidControls.BottomSheetGrid`（网格式）：

```qml
FluidControls.BottomSheetList {
    id: listBottomSheet
    title: "保存到…"
    actions: [
        FluidControls.Action {
            text: "文件夹"
            icon.source: FluidControls.Utils.iconUrl("file/folder")
        },
        FluidControls.Action {
            text: "上传 (禁用)"
            icon.source: FluidControls.Utils.iconUrl("file/file_upload")
            enabled: false
        }
    ]
}
// 调用 listBottomSheet.open()
```

### 4.8 卡片与图片

- `FluidControls.Card`：圆角卡片容器，里面放任意内容。
- `FluidControls.CircleImage`：圆形图片，`source` + `Layout.preferredWidth/Height`。

### 4.9 图标系统

图标通过 `FluidControls.Utils.iconUrl("<分类>/<名字>")` 得到，返回 `qrc:/liri.io/imports/Fluid/Controls/icons/<分类>/<名字>.svg`（`FLUID_INSTALL_ICONS=0` 时）。配合 `FluidControls.Icon` 或控件的 `icon.source` 使用：

```qml
FluidControls.Icon {
    source: FluidControls.Utils.iconUrl("action/home")
    size: 40
    color: Material.accent
}
```

**当前 qrc 里打包了 38 个 Material 图标**（`fluid_demo/fluid.qrc` 为准）：

| 分类 | 图标 |
|---|---|
| action | alarm, check_circle, delete, event, favorite, home, info, info_outline, list, print, search, settings |
| content | add, create, inbox |
| device | airplanemode_active |
| editor | format_align_left |
| file | attachment, cloud, create_new_folder, file_download, file_upload, folder, folder_shared |
| image | audiotrack, collections, color_lens, palette, tune |
| navigation | arrow_back, cancel, check, close, menu, more_vert |
| social | notifications_none, share |
| toggle | star |

> 注意：demo 的 `IconsPage` 里列出了 `action/history`、`social/person`、`device/storage` 等图标，这些 **svg 没有打进 fluid.qrc**，显示为空白。需要用时把对应 svg 拷进 `fluid/controls/icons/<分类>/` 并在 `fluid.qrc` 的 `/liri.io/imports/Fluid/Controls` 前缀下加一行 `<file>`。

## 5. i.MX6ULL 无 GPU 软渲染注意事项

i.MX6ULL 无 GPU，Qt 走软件渲染（fbdev / linuxfb），移植 Fluid 时踩过并已修复的坑：

1. **Material 阴影（elevation）会失效甚至白屏**：软件渲染下 `ElevationEffect` 图层不可用。demo 里对 `AlertDialog`、`InputDialog` 都设了 `Material.elevation: 0`。自己写对话框/弹出层时同样处理。
2. **`Drawer` 底部面板会触发无限重排导致 `std::bad_alloc` 崩溃**：Fluid 原版 `BottomSheet` 用 `Drawer { edge: Qt.BottomEdge }`，在软渲染下会崩溃。移植版已改成 `Popup` 实现（见 `fluid/controls/BottomSheet.qml` 头注释），并把高度改成固定比例 `window.height * 0.6`，内容不可滚动时不触发隐式尺寸递归。
3. **`ListItem` 的 `childrenRect` 绑定会内存耗尽**：原版用 `childrenRect` 计算图标/右栏尺寸，软渲染下部分环境触发绑定循环。移植版改为按子项隐式尺寸计算（见 `ListItem.qml`）。
4. **必须设置移动端行为**：`main.cpp` 里 `qputenv("QT_QUICK_CONTROLS_MOBILE", "1")`，否则 `NavigationDrawer` 会按桌面端行为常驻侧栏，无法点击弹出。
5. **主题**：`QQuickStyle::setStyle(QStringLiteral("Material"))` 全局 Material 主题；主色 `Material.primary: Material.DeepOrange`、强调色 `Material.accent: Material.Teal` 可整体换肤。
6. **图标**：图标全部打进 qrc，不依赖板子安装图标主题；缺图标按 4.9 节补充即可。

## 6. 与 systemui 集成与部署

### 6.1 接入桌面

- `.pro` 里 `include(../client/client.pri)`（自带与 systemui 的 RemoteObject 通信 + 自动拷贝到 `ui/src/apps/`）。
- 主 QML 里加一段 `SystemUICommonApiClient`（`appName` 填可执行文件名，`onActionCommand` 里处理 Show/Quit）。
- 在桌面的应用配置 `ui/src/ATK-IMX6U/apk1.cfg` 加一行：

  ```
  appicons/fluid.png Fluid组件演示 fluid_demo
  ```

  并把 `fluid.png` 放到 `ui/src/appicons/`、可执行文件放到 `ui/src/apps/`。

### 6.2 编译与部署

```bash
cd ~/Linux_dev/imx6ull/my_code
./qtflash_auto.py build fluid_demo   # 或 ./qtflash_auto.py app fluid_demo 直接编译并传到板子
./qtflash_auto.py deploy             # 打包 ui/ 并整体部署重启桌面
./qtflash_auto.py app fluid_demo     # 只更新单个 app（点击图标即生效）
```

编译产物经 `QMAKE_POST_LINK` 自动 `strip` 并拷贝到 `qt_dev/ui/src/apps/fluid_demo`。

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| 点图标没反应 / 桌面返回 | `qtflash_auto.py log` 看板子日志；确认 `ui/src/apps/fluid_demo` 已部署且 `apk1.cfg` 程序名一致 |
| 对话框白屏 / 背景消失 | 给对话框加 `Material.elevation: 0`（见第 5 节） |
| 底部面板点击卡死 / std::bad_alloc | 确认用的是本仓库改过的 `BottomSheet`（Popup 版），别用上游 Drawer 版 |
| 某个图标显示空白 | 该 svg 没进 `fluid.qrc`，按 4.9 节补充 |
| 新建工程 import 报 `module Fluid.* is not installed` | `main.cpp` 少了 `engine.addImportPath("qrc:/")` 或 `.pro` 少了 `fluid.qrc` |
