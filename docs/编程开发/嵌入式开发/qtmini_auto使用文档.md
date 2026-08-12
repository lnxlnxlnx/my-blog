# qtmini_auto 使用文档

IMX6ULL 开发板 Qt 小例程一键交叉编译、依赖修补、部署、运行工具使用说明。

## 1. 简介

`qtmini_auto` 用于把 `ref_code/Qt_ref/Qt/` 下的 Qt 小例程（或任意目录下的 `.pro` 工程）快速放到开发板上运行。与 `qtflash` / `qtflash_auto`（桌面 app 打包部署）定位不同，它是针对**独立 Widgets 小工程**的：

| 命令 | 对象 | 特点 |
|---|---|---|
| `qtflash` / `qtflash_auto` | `qt_dev/` 桌面集成 app | 打包 ui.tar.bz2 + 重启桌面 systemui |
| `qtmini_auto` | `Qt_ref/` 及任意独立 Qt 工程 | 单工程交叉编译 + 杀掉桌面独立全屏运行 |

一条命令完成四件事：

1. **依赖修补**：扫描源码，缺哪个 Qt 模块（network/charts/serialport/sql…）自动补进 `.pro`；缺 `FORMS`/`RESOURCES`/`C++11` 也自动补
2. **交叉编译**：用工具链 qmake + make 编译，失败时从错误日志反推缺的模块再补再编（最多 3 轮）
3. **部署**：通过 tftp 把二进制推到板子用户家目录 `/home/root/`
4. **运行**：通过 ssh 杀掉桌面后带触摸环境启动程序并回显启动日志

## 2. 环境与前提

### 2.1 网络

- 网线直连板子与电脑有线网卡
- 板子静态 IP：`192.168.1.20`
- 电脑 IP：`192.168.1.101`
- 板子 root ssh 密码：`0314`

### 2.2 依赖服务

- **tftpd-hpa**（WSL 侧）：文件下载服务，根目录 = `qt_dev/`。命令会自动检查并启动，文件经根目录下 `.qtmini/` 暂存子目录传输（与 Qt 工程目录隔离）。
  > 若板子下载超时，检查 Windows 防火墙是否放行入站 UDP 69。
- **dropbear**（板子侧）：ssh 服务，供自动运行使用。

### 2.3 配置常量

脚本 `/home/lnx/Linux_dev/imx6ull/my_code/qtmini_auto.py` 顶部常量，换网段/换板子时修改：

| 常量 | 默认值 | 含义 |
|---|---|---|
| `QT_REF_ROOT` | `~/Linux_dev/imx6ull/ref_code/Qt_ref/Qt` | Qt 小例程根目录（`list` 与名字查找的搜索范围） |
| `TFTP_ROOT` | `~/Linux_dev/imx6ull/qt_dev` | tftp 根目录（`.qtmini/` 为暂存子目录） |
| `BOARD_IP` | `192.168.1.20` | 板子 IP |
| `PC_IP` | `192.168.1.101` | 电脑 IP |
| `BOARD_HOME` | `/home/root` | 板子家目录（程序安装位置） |
| `PASSWORD` | `0314` | 板子 root ssh 密码 |
| `ENV_SETUP` | `/opt/fsl-imx-x11/.../environment-setup-...` | 交叉编译环境脚本 |
| `MAX_FIX_ROUNDS` | `3` | 编译失败后自动补依赖的最大重试轮数 |

## 3. 一键用法（核心）

```bash
qtmini_auto <工程> [程序参数...]
```

`<工程>` 可以是：

- **Qt_ref 下的目录路径**：`qtmini_auto 04/01_smarthome`
- **名字**（自动在 `Qt_ref/Qt` 下递归查找）：`qtmini_auto 01_hello_world`
- **任意绝对/相对路径**：`qtmini_auto /home/lnx/.../qt_dev/mytest`（不限于 Qt_ref）
- 若目录下**没有 `.pro`**，会自动向下找子工程；有多个子工程时打印编号菜单让你选择（如 `04/05_video_surveillance` 下有 `video_client`、`video_server`）

程序参数直接跟在工程后面，开头的 `--` 会被自动去掉；需要原样透传 `--` 开头参数时用独立的 `--` 分隔符：

```bash
qtmini_auto 09_tcpclient -- 127.0.0.1   # 板子上执行: /home/root/09_tcpclient 127.0.0.1
```

流程与输出：

```
[*] 已自动修补 09_tcpclient.pro: QT += network   # 缺依赖时才会出现
[1/4] 编译 09_tcpclient
[*] tftpd-hpa 运行中
[2/4] 传输 09_tcpclient -> 板子 /home/root/
[3/4] 板子运行 /home/root/09_tcpclient
----- 启动日志 -----
...
----- 运行状态 -----
  PID ?  00:00:01 09_tcpclient
[4/4] 完成!程序已启动
```

> **注意**：Qt 小例程是独立 Widgets 程序，运行时脚本会**杀掉桌面的 QDesktop / systemui**，全屏运行该程序。跑完想回桌面，用 `qtmini_auto run systemui` 或直接重启。

## 4. 依赖自动修补

这是 qtmini_auto 区别于手动 qmake 编译的核心能力，分两层：

### 4.1 编译前静态扫描

扫描工程内所有 `.cpp/.h/.ui`，根据"类名 → Qt 模块"映射表检查 `.pro` 是否声明：

| 用到的类 | 自动补的模块 |
|---|---|
| `QTcpSocket / QTcpServer / QUdpSocket / QHostInfo / QNetworkAccessManager` 等 | `network` |
| `QSerialPort / QSerialPortInfo` | `serialport` |
| `QCanBus / QCanBusDevice / QCanBusFrame` | `serialbus` |
| `QChart / QChartView / QLineSeries / QBarSeries` 等 | `charts` |
| `QMediaPlayer / QMediaRecorder / QAudioInput` 等 | `multimedia`（`QVideoWidget` 补 `multimediawidgets`） |
| `QSqlDatabase / QSqlQuery / QSqlTableModel` 等 | `sql` |
| `QBluetoothSocket / QBluetoothDeviceDiscoveryAgent` 等 | `bluetooth` |
| `QWebSocket / QWebSocketServer` | `websockets` |
| `QMqttClient / QMqttSubscription` 等 | `mqtt` |
| `QApplication / QMainWindow / QWidget / QDialog` | `widgets` |
| 目录有 `.ui` 但 `.pro` 没写 `FORMS` | 补 `FORMS +=` |
| 目录有 `.qrc` 但 `.pro` 没写 `RESOURCES` | 补 `RESOURCES +=` |
| `.pro` 缺 C++11 | 补 `CONFIG += c++11` |

**只改 `.pro`，绝不改源码**；修补前会把改动内容打印出来。系统里不存在的模块（如某些 04 组用到的 OpenCV）不会误补。

### 4.2 编译失败兜底

静态扫描覆盖不到的情况（例如通过 `.pri` 引用了兄弟目录的源码、或代码里用了映射表外的类）→ 编译失败时解析错误日志：

- `fatal error: QtNetwork/...: No such file` → 补 `network`
- `cannot find -lQt5Xxx` → 补对应模块
- `QTcpSocket: No such file` 之类的类名错误 → 补对应模块

补完 `.pro` 重新编译，最多 `MAX_FIX_ROUNDS` 轮。仍失败则打印完整错误日志退出。

## 5. 子命令

| 命令 | 作用 |
|---|---|
| `qtmini_auto build <工程>` | 只交叉编译（含依赖修补），不部署 |
| `qtmini_auto fix <工程>` | 只检查并修补 `.pro` 依赖，不编译 |
| `qtmini_auto transfer <本地文件> [板端路径]` | 任意文件推到板子并 chmod +x，默认 `/home/root/<文件名>` |
| `qtmini_auto run <名字> [参数...]` | 运行板子上 `/home/root/<名字>`（会先杀掉桌面和同名进程） |
| `qtmini_auto kill <名字>` | 关闭板子上 QDesktop / systemui / 同名进程 |
| `qtmini_auto log <名字>` | 查看板子上 `/tmp/<名字>.log` 启动日志 |
| `qtmini_auto status` | 查看 tftpd / 板子 ping / HOME / dropbear 状态 |
| `qtmini_auto list` | 按组列出 Qt_ref 下所有工程（方便查名字） |

## 6. 典型工作流

| 场景 | 命令 |
|---|---|
| 编译并运行 hello world | `qtmini_auto 01_hello_world` |
| 编译并运行 TCP 客户端（带参数） | `qtmini_auto 09_tcpclient -- 192.168.1.20` |
| 只编译串口例程，不上板 | `qtmini_auto build 03_serialport` |
| 只检查某个工程缺什么依赖 | `qtmini_auto fix 02/04_qtchart` |
| 多个子工程选一个编译 | `qtmini_auto 04/05_video_surveillance`（提示选择 video_client / video_server） |
| 把 PC 上某个文件推上板子 | `qtmini_auto transfer ./a.png /opt/a.png` |
| 回桌面 / 看日志 / 停程序 | `qtmini_auto run systemui`、`qtmini_auto log 09_tcpclient`、`qtmini_auto kill 09_tcpclient` |

## 7. 综合例程的修复说明

`04` 组三个综合例程原本 `.pro` 用 `include(../webapi/webapi.pri)`、源码用 `#include "../webapi/webapi.h"`，把 `webapi/slidepage/appdemo/ocr` 当作**主工程的平级目录**，而实际它们是**子目录**，导致无法编译。已统一改为子目录引用（`.pri` 内部改用 `$$PWD/`）：

- `04/01_smarthome`（webapi）
- `04/03_appmainview`（slidepage、appdemo）
- `04/04_lpr_demo`（ocr）

修复后这三个工程可直接 `qtmini_auto 04/01_smarthome` 一键编译上板。

> 其余 `04` 组个别工程（如 `05_opencv_camera`）依赖外部库（OpenCV）或板子未装，编译失败属正常，脚本不会误补，按第 8 节排查。

## 8. 常见问题排查

| 现象 | 原因 / 处理 |
|---|---|
| 板子 tftp 下载超时 | Windows 防火墙拦截 UDP 69。管理员 PowerShell 放行：`New-NetFirewallRule -DisplayName tftp69 -Direction Inbound -Protocol UDP -LocalPort 69 -Action Allow`，或临时关闭防火墙 |
| ssh 连接报 `no matching host key type` | 板子 dropbear 仅支持 `ssh-rsa`，脚本已带 `-o HostKeyAlgorithms=+ssh-rsa` 兼容；手动 ssh 时需加同样参数 |
| 运行后屏幕黑屏 / 桌面没了 | 独立 Widgets 程序会杀掉 systemui 全屏运行，属正常。回桌面用 `qtmini_auto run systemui` |
| `cannot open shared object ...` | 板子缺运行库。先在板子上 `ldd /home/root/<程序>` 看缺什么，再从 `sysroots/cortexa7hf-neon-poky-linux-gnueabi/usr/lib/` 对应拷贝，或用 `qtmini_auto transfer` 推上去 |
| `wrong ELF class` | 二进制不是 ARM32（本机误用 `gcc` 编译）。脚本始终走工具链 qmake，确认输出为 `ELF 32-bit ARM` |
| 编译失败且脚本提示"无法自动修补" | 缺的不是常见 Qt 模块（如 OpenCV 的 `PKGCONFIG`）。手动 `source` 环境后 `qmake && make` 看完整错误定位 |
| 界面显示但点不动 | 触摸环境未生效。脚本运行时已 `source /etc/profile` 并 `export TSLIB_TSDEVICE=/dev/input/event1`；若设备号不同改脚本 `TOUCH_DEV` 常量 |
| 程序需要传参数 | 参数直接跟在工程后：`qtmini_auto 09_tcpclient -- 127.0.0.1`（`--` 后原样透传） |
| 想改板子 ssh 密码 | 板子 `passwd root` 修改，并同步更新 `qtmini_auto.py` 的 `PASSWORD` 常量 |
