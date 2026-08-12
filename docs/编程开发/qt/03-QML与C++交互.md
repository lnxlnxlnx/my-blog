# 03 QML 与 C++ 混合编程

嵌入式 App 的规律：**界面用 QML 画，硬件/系统能力用 C++ 写，再把 C++ 暴露给 QML**。本章讲三种暴露方式 + 多线程。

## 1. 三种暴露方式

### 方式一：qmlRegisterType —— 注册一个类型（最常用）

C++ 头文件（以 led 的 `ledcontrol.h` 为例）：
```cpp
#include <QObject>
class LedControl : public QObject
{
    Q_OBJECT
    Q_PROPERTY(int ledState READ ledState WRITE setLedState NOTIFY ledStateChanged)
public:
    explicit LedControl(QObject *parent = nullptr);
    int ledState() const;
public slots:
    void setLedState(int state);
signals:
    void ledStateChanged(int state);
};
```

main.cpp 注册：
```cpp
qmlRegisterType<LedControl>("com.alientek.qmlcomponents", 1, 0, "LedControl");
```

QML 里使用：
```qml
import com.alientek.qmlcomponents 1.0
LedControl {
    id: led
    onLedStateChanged: console.log("灯状态", ledState)
}
Button { text: "开灯"; onClicked: led.setLedState(1) }   // 调 C++ 槽
```

### 方式二：setContextProperty —— 注册为全局单例

适合"整个 App 只有一个"的对象（如摄像头识别器）：
```cpp
DigitRecognizer digitRecognizer;
engine.rootContext()->setContextProperty("digitRecognizer", &digitRecognizer);
```
QML 里直接 `digitRecognizer.xxx`，任何文件都能用，不用 `id`。

### 方式三：ImageProvider —— 提供动态图片

把 C++ 算出的图像（如摄像头帧、识别结果）实时给 QML 的 Image 显示：
```cpp
engine.addImageProvider("digitpreview", new DigitPreviewProvider(&digitRecognizer));
```
QML：`Image { source: "image://digitpreview/frame" }`，每次 source 变化 Qt 回调 C++ 的 `requestImage` 返回 `QImage`。

## 2. Q_PROPERTY 与信号槽（C++ 类的核心三件套）

一个标准的"给 QML 用的 C++ 类"必须有：

```cpp
class Demo : public QObject {
    Q_OBJECT
    Q_PROPERTY(int value READ value WRITE setValue NOTIFY valueChanged)  // 属性
public:
    int value() const { return m_value; }
public slots:
    void setValue(int v) { if (v != m_value) { m_value = v; emit valueChanged(v); } }
signals:
    void valueChanged(int value);     // 变化信号(QML 用 onValueChanged 接收)
private:
    int m_value = 0;
};
```

| Q_PROPERTY 参数 | 含义 |
|----------------|------|
| `READ value` | QML 读 `obj.value` 时调 `value()` |
| `WRITE setValue` | QML 写 `obj.value = x` 时调 `setValue(x)` |
| `NOTIFY valueChanged` | 值变了发信号，QML 绑定会自动更新 |

> QML 里 `property int x` 是 QML 自己的属性；C++ 的 `Q_PROPERTY` 是给 QML 的属性。两者都能被绑定。

## 3. QML 调 C++ 函数

C++ 里用 `public slots:`（或 `Q_INVOKABLE`）声明的方法，QML 可直接调用：
```cpp
public slots:
    void setLedState(int state);
    QString getDeviceInfo();
```
QML：`led.setLedState(1)`、`sensor.getDeviceInfo()`。

## 4. C++ 调 QML（信号连接）

C++ 里拿到 QML 对象：
```cpp
QObject *root = engine.rootObjects().first();
QObject *winOverlay = root->findChild<QObject*>("winOverlay");  // QML 里 objectName 标记
```
或 QML 里连接 C++ 信号（推荐，更简单）：
```qml
LedControl {
    id: led
    onLedStateChanged: {              // C++ 的 signal -> QML 的 onXxx
        tipText.text = (ledState ? "已开" : "已关")
    }
}
```

## 5. 多线程：QThread 读取硬件（传感器案例）

硬件读取（I2C 传感器、串口）不能卡住 UI 线程，用 `QThread` 后台读。sensor 的 `Ap3216cThread`：

```cpp
class Ap3216cThread : public QThread {
    Q_OBJECT
    Q_PROPERTY(int interval READ interval WRITE setInterval NOTIFY intervalChanged)
    Q_PROPERTY(QString alsData READ alsData NOTIFY alsDataChanged)   // 暴露给 QML
protected:
    void run() override;    // 线程主体
};
```

```cpp
void Ap3216cThread::run() {
    // 打开 /dev/... 传感器设备, 循环读
    while (!isInterruptionRequested()) {
        QString v = readAlsData();        // 读光感
        setAlsData(v);                    // 更新属性 -> QML 收到 onAlsDataChanged
        msleep(200);
    }
}
```

QML 里：
```qml
Ap3216cThread { id: als; onAlsDataChanged: txt.text = als.alsData }
```

> 原则：**耗时 IO 放子线程**，线程里只更新 QObject 属性，UI 线程自动刷新。

## 6. 我们自己项目的手柄集成（QML + C++ + 外部进程）

mytest 的手柄是三层协作，很有代表性：

```
[手柄 USB] --usbfs--> [gamepadd 守护进程(C)] --Unix socket /tmp/gamepad.sock-->
[GamepadClient(C++)] --Q_PROPERTY--> [QML gamepad.btnA / gamepad.axisLX]
```

C++ `GamepadClient` 用 `QLocalSocket` 连 socket，读到一行行手柄状态：
```cpp
// 协议: lx,ly,rx,ry,lt,rt,A,B,X,Y,LB,RB,Start,Back,LS,RS,Up,Down,Left,Right
void GamepadClient::parseLine(const QByteArray &line) {
    const QList<QByteArray> f = line.split(',');
    m_a = f[6].toInt() != 0;
    ...
    emit changed();      // 触发 QML 的 onChanged, 20 个属性更新
}
```

main.cpp 注册为全局单例：
```cpp
GamepadClient gamepadClient;
engine.rootContext()->setContextProperty("gamepad", &gamepadClient);
```

QML 游戏里轮询：
```qml
Timer {
    interval: 16; repeat: true
    onTriggered: {
        if (gamepad.btnA) shoot()                 // 手柄 A 键开火
        if (gamepad.axisLX < -6000) moveLeft()    // 摇杆
    }
}
```

**完整链路**：硬件 → 守护进程(读 raw USB) → socket → C++ 解析 → Q_PROPERTY → QML。这是嵌入式里"C 驱动 + Qt 界面"的典型架构。

## 7. main.cpp 标准模板（带摄像头 + 识别器的完整版）

```cpp
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include "scorestorage.h"
#include "digitrecognizer.h"
#include "gamepadclient.h"

int main(int argc, char *argv[])
{
    QGuiApplication app(argc, argv);
    // 1. 注册类型
    qmlRegisterType<ScoreStorage>("com.alientek.qmlcomponents", 1, 0, "ScoreStorage");
    qmlRegisterType<Camera>("com.alientek.qmlcomponents", 1, 0, "Camera");
    // 2. 注册全局单例
    QQmlApplicationEngine engine;
    DigitRecognizer digitRecognizer;
    engine.rootContext()->setContextProperty("digitRecognizer", &digitRecognizer);
    GamepadClient gamepadClient;
    engine.rootContext()->setContextProperty("gamepad", &gamepadClient);
    gamepadClient.connectToServer();
    // 3. 注册图片提供器
    engine.addImageProvider("digitpreview", new DigitPreviewProvider(&digitRecognizer));
    // 4. 加载 QML
    engine.load(QUrl("qrc:/main.qml"));
    return app.exec();
}
```
