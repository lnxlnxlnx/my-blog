---
title: Qt 开发：07 App 实战全解析
published: 2026-08-12
description: 逐个 App 的组件清单、结构、关键代码逐行讲解。
tags: [Qt, App, 实战]
category: Qt
draft: false
prevTitle: ""
prevSlug: ""
nextTitle: "Qt 开发：06 图形效果与 3D、主题"
nextSlug: "qt/06-图形效果与3d"
---

# 07 App 实战全解析（逐个 App）

本章把 `qt_dev/` 里每个 App 都拆开看：**用了哪些组件、什么结构、怎么碰硬件、关键代码**。按功能分组。

---

## 框架类

### systemui —— 桌面系统
- **组件**：`Window` + `SwipeView`(左右滑桌面) + `BottomApp`(底部任务栏) + `PageIndicator`(页点) + `Image`/`Rectangle` + `Connections` + `Timer` + `SystemTime`
- **职责**：管理 App 列表（apk*.cfg）、点击图标 `QProcess` 启动 App、通过 remoteobjects 协调显示/隐藏、悬浮球返回
- **关键机制**：`apklistmodel.cpp` 读 cfg → `LaunchIntent::lauchApp(appName)` 启动二进制
```qml
SwipeView {          // 桌面可左右滑动
    Page1 {} ; Page2 {}
    PageIndicator { count: SwipeView.count; currentIndex: SwipeView.currentIndex }
}
```

### client / Client.qml —— App 公共框架
每个 App 的 main.qml 都 `Client { programmerName: "xxx" }`。它：
1. 内置 `SystemUICommonApiClient` 与桌面通信（Show/Hide/Quit）
2. 实例化 `AppMainBody`（App 入口）
3. 画**悬浮返回球**（可拖拽，点击回桌面）
```qml
Item {
    property string programmerName
    SystemUICommonApiClient {
        id: systemUICommonApiClient
        appName: programmerName
        onActionCommand: {
            if (cmd === SystemUICommonApiClient.Show) {
                systemUICommonApiClient.askSystemUItohideOrShow(SystemUICommonApiClient.Hide)
                window.show()
            }
            if (cmd === SystemUICommonApiClient.Quit) Qt.quit()
        }
    }
    AppMainBody { anchors.fill: parent; id: appMainBody; visible: true }
    RoundButton { /* 悬浮返回球 */ onClicked: { /* 隐藏自己, 显示桌面 */ } }
}
```

### template —— 空白模板
复制它就能开始新 App：`main.cpp`(空注册) + `main.qml`(Window+Client) + `AppMainBody.qml`(Loader 加载 `MainLayout.qml`)。照着加你的 QML 和 C++ 即可。

---

## 硬件控制类

### led —— LED 控制
- **结构**：`AppMainBody` → `LedLayout.qml` + C++ `LedControl`
- **组件**：`Image`(灯泡图) + `MouseArea` + `Text`
- **硬件**：写 `/sys/class/leds/sys-led/brightness`
- **关键代码**：
```qml
LedControl { id: ledControl }
Image { source: ledControl.ledState ? "qrc:/icons/led_on.png" : "qrc:/icons/led_off.png" }
MouseArea { anchors.fill: parent; onClicked: ledControl.setLedState(ledControl.ledState ? 0 : 1) }
```

### beep —— 蜂鸣器
同 LED，写 `/sys/class/leds/beep/brightness`。可做"按下滴答"反馈。

### key —— 按键检测
- **硬件**：读 `/dev/input/eventX` 的 `EV_KEY` 事件
- **组件**：`Image`(按键位图) + `MouseArea` + `Text`
- 用子线程轮询，避免卡 UI（参考 screenview 的 KeyInputEventThread）

### sensor —— 传感器（I2C）
- **结构**：`SensorLayout.qml` + `Ap3216cThread`(光感) + `Icm20608Thread`(陀螺仪)
- **组件**：`Text` 显示数值、`RowLayout`/`Column` 排版、图标 `Image`
- **硬件**：`QThread::run()` 里 open+read `/dev/ap3216c`、`/dev/icm20608`，`Q_PROPERTY NOTIFY` 刷新界面
```qml
Ap3216cThread { id: als; onAlsDataChanged: alsText.text = als.alsData }
Icm20608Thread { id: gyro; onIcmDataChanged: gyroText.text = gyro.icmData }
```

### pcba / keil —— 测试工具
- **组件**：`Grid`/`GridLayout` 排按钮、`Button`、`Text`、`Rectangle`
- 主要调系统命令/GPIO 做板级自检。

### location —— 定位（GPS/传感器融合）
- 用 `Column`/`Text`/图标展示经纬度等定位信息，C++ 侧读定位设备。

---

## 多媒体类

### camera —— 摄像头
- **组件**：`Camera`(设备) + `VideoOutput`(画面) + `Row`/`Text`(提示) + `Image`(拍照预览)
- **C++**：`Camera` 类封装 `QCameraInfo::availableCameras()` 枚举 + 分辨率设置
- **关键 QML**：
```qml
Camera { id: camera; deviceId: cameraDevice }
VideoOutput { source: camera; anchors.fill: parent }
Button { text: "拍照"; onClicked: imageCapture.capture() }
```

### music —— 音乐播放
- **组件**：`Audio`(播放) + `Slider`(进度/音量) + `ListView`(歌曲列表) + `Button`(上一首/播放/下一首) + `Text`(歌名)
- **关键 QML**：
```qml
import QtMultimedia 5.0
Audio { id: player; source: listModel.get(currentIndex).url }
Button { text: player.playing ? "暂停" : "播放"; onClicked: player.playing ? player.pause() : player.play() }
Slider { from:0; to:100; value:60; onValueChanged: player.volume = value/100 }
```

### audio —— 音频分析（录音 + 波形）
- **硬件**：`QAudioInput`/`AudioRecorder` 采音，`QAudioProbe` 抓帧
- **组件**：`Canvas`(画波形)、`Text`(频率/音量)、`Button`(开始/停止)
- 帧率不够时用 Canvas 画动态波形是嵌入式最佳选择。

### player —— 视频播放
- **组件**：`MediaPlayer` + `VideoOutput`(画面) + `Slider`(进度) + `Button`(播放/暂停/全屏) + `ListView`(片源)
- **关键 QML**：
```qml
import QtMultimedia 5.0
MediaPlayer { id: mp; source: "file:///home/root/video.mp4" }
VideoOutput { source: mp; anchors.fill: parent }
Button { text: mp.playbackState === MediaPlayer.PlayingState ? "暂停" : "播放"
         onClicked: mp.playbackState === MediaPlayer.PlayingState ? mp.pause() : mp.play() }
```

### photoview —— 图片浏览器
- **组件**：`GridView`(缩略图墙) + `Image`(大图) + `ListView`(目录) + `FolderListModel`(读目录) + `Dialog`(对话框)
- **关键 QML**：
```qml
import Qt.labs.folderlistmodel 2.1
FolderListModel { id: folderModel; folder: "file:///home/root"; nameFilters: ["*.jpg","*.png"] }
GridView {
    model: folderModel
    cellWidth: 100; cellHeight: 100
    delegate: Image {
        source: filePath
        MouseArea { anchors.fill: parent; onClicked: bigImage.source = filePath }
    }
}
```

---

## 系统工具类

### notepad —— 记事本（虚拟键盘）
- **组件**：`TextArea`/`TextField` + `InputPanel`(虚拟键盘) + `Button`(保存/清空) + `Text`
- **硬件**：`QFile` 读写 `/home/root/note.txt`；屏幕键盘靠 `QT += virtualkeyboard`

### settings —— 系统设置
- **组件**：`SwipeView` + `ListView`(设置项) + `Switch`(开关) + `Slider`(亮度) + `TextField`(输入) + `InputPanel` + `Connman`(WiFi)
- **硬件**：调用 `wpa_supplicant`/`connman` 管 WiFi 蓝牙，`system()` 调系统命令
```qml
import Connman 0.2
Connman { id: connman }
ListView { model: connman.networks; delegate: Text { text: model.name } }
```

### fileview —— 文件浏览器
- **组件**：`ListView` + `FolderListModel` + `Button`(返回/复制) + `Text`
- 纯文件 IO，无硬件。

### clock —— 时钟
- **组件**：`Rectangle`(表盘) + `Canvas`(画指针) + `Timer`(每秒刷新) + `Text`(日期)
- **关键 QML**：
```qml
Timer { interval: 1000; repeat: true; onTriggered: canvas.requestPaint() }
Canvas { onPaint: { /* 按当前时间画时针/分针/秒针 */ } }
```

### background —— 壁纸
- 把选中的图片设为桌面壁纸（写配置/调 systemui 接口），组件用 `GridView` + `Image`。

---

## 网络类

### iot_control —— MQTT 智能控制
- **组件**：`MqttControl`(C++) + `Switch`(灯) + `Text`(状态) + `TextField`(服务器/主题)
- **硬件**：MQTT 协议 → 手机指令控制 GPIO
```qml
MqttControl { id: mqtt; topicPrefix: "atk/led"
  onMessageReceived: if (payload==="on") led.setLedState(1) }
Switch { onToggled: mqtt.publish(mqtt.topicPrefix+"/cmd", checked?"on":"off", false) }
```

### screenview —— 投屏（QWidget 版）
- **技术**：`QTcpServer`+`QTcpSocket` 收 MJPEG，`QPainter::drawImage` 画帧
- **结构**：QWidget（`paintEvent`）而非 QML，是 qt_dev 里少有的 Widgets 应用
- 还接了 `KeyInputEventThread`（按键退出）和 `SystemUICommonApiClient`（进桌面框架）

### fluid_demo —— Fluid 组件库演示
- **组件**：`FluidControls.AppBar`/`Card`/`NavigationBar` + `Material` 主题
- 学习用，展示开源组件库接入方式

---

## 游戏类（mytest）

mytest 是 qt_dev 里最丰富的 App，融合了**摄像头识别 + 纯 QML 游戏 + 手柄**：

| 页面 | 技术 |
|------|------|
| 拼图 | `Grid` + `ListModel` + `MouseArea` |
| 扫雷 | `Repeater`/`GridView` + `ListModel` + 排行榜(`ScoreStorage` C++) |
| 手写数字识别 | `Camera`+`VideoOutput` 抓帧 → C++ 神经网络 → `ImageProvider` 回显 |
| 太空射击/贪吃蛇/俄罗斯方块 | `Canvas` 单画布 + `Timer` 游戏循环 + 手柄(`gamepad` 全局对象) |

**手柄游戏循环**（一个通用模板）：
```qml
// 全局: main.cpp 里 contextProperty 注册 gamepad
Timer {
    interval: 16; repeat: true; running: true
    onTriggered: {
        // 读手柄
        var dir = (gamepad.axisLX < -6000) ? -1 : (gamepad.axisLX > 6000 ? 1 : 0)
        playerX += dir * 8
        if (gamepad.btnA) fire()              // 跳跃/开火
        // 更新逻辑 + 重绘
        canvas.requestPaint()
    }
}
```
完整链路见《03-QML与C++交互.md》第 6 节。

---

## QWidget 与 QML 的取舍（openhome / screenview）

qt_dev 里 95% 是 QML，只有 openhome、screenview 是纯 Widgets：

| 对比 | QML (Qt Quick) | QWidget |
|------|---------------|---------|
| 开发界面速度 | 快(声明式/绑定) | 慢(命令式) |
| 动画/效果 | 丰富(内建动画/特效) | 需手动 QPainter |
| 触摸/嵌入式 | 更友好 | 也能用 |
| 适用 | 大多数 App | 传统桌面工具、绘图/网络流 |

> 新 App 建议直接 QML。需要底层快速绘图（如投屏逐帧解码绘制）时可考虑 Widgets 的 `paintEvent`。
| — | [课程目录](/my-blog/posts/qt/00-总览/) | [下一课 →](/my-blog/posts/qt/06-图形效果与3d/) |
