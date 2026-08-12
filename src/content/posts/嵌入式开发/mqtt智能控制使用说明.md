---
title: MQTT 智能控制 App 与时钟校准使用说明
published: 2026-08-12
description: 基于 paho.mqtt.c 的公网 MQTT 控制框架：远程查看开发板状态、控制 LED，联网自动校准时钟。
tags: [嵌入式, MQTT, IoT, 网络]
category: 嵌入式开发
draft: false
---

# MQTT 智能控制 App 与时钟校准使用说明

基于 **paho.mqtt.c** 的公网 MQTT 控制框架：手机通过 MQTT 查看开发板状态（CPU温度 / 六轴IMU / 光感）并远程控制板上 LED；开机联网后自动校准系统时钟。

## 1. 总览

| 项目 | 说明 |
|---|---|
| 工程 | `qt_dev/iot_control/`（可执行 `iot_control`，桌面第二页"智能控制"图标） |
| MQTT 库 | paho.mqtt.c v1.3.8（交叉编译，库与头文件在 `qt_dev/third_party/paho/`） |
| broker | 默认公网 `broker.emqx.io:1883`（无需注册） |
| 依赖 | 板子 `/usr/lib/libpaho-mqtt3c.so.1`（已部署） |
| 时钟校准 | `/etc/wifi_auto.sh` 联网后自动 `ntpdate` + `hwclock -w` 存 RTC |

## 2. 架构

```
手机(MQTT app)  <--TCP-->  broker.emqx.io:1883  <--TCP-->  开发板 iot_control
                                                                │
                                             订阅 cmd/# 控制，发布 status/# 状态
                                                                │
                                              ┌──────────────┬────────────────┐
                                              │  LED(sys-led) │ 传感器(IMU/光感) │ CPU温度
```

- 板端 `MqttControl`（paho 工作线程）：连接/订阅/周期发布/断线自动重连
- `DeviceControl`：读写 sysfs（LED、ICM20608 IMU、AP3216C 光感、CPU 温度）

## 3. 配置（都可修改，无需重编译）

配置文件：**`/etc/iot_control.conf`**（app 首次启动自动生成，按需修改后重启 app）

```
[broker]
address=broker.emqx.io        # broker 地址(仅主机名/域名)
port=1883                     # 端口
client_id=imx6ull_alpha       # 客户端ID(多个板子要不同)

[topic]
prefix=imx6ull/alpha          # 话题前缀(改这个即可区分多块板子)

[period]
cpu=3000                      # CPU温度上报周期(毫秒)
imu=1000                      # IMU上报周期
ap3216c=1000                  # 光感上报周期
```

> 手机 app 端订阅/发布时把前缀换成同样的值即可。

## 4. 话题协议

| 话题 | 方向 | 说明 |
|---|---|---|
| `前缀/status/online` | 板→云 | retained，"online"；连接断开时遗嘱发 "offline" |
| `前缀/status/led` | 板→云 | retained，"0"/"1"，LED 状态 |
| `前缀/status/cpu_temp` | 板→云 | 周期，如 "60.9" |
| `前缀/status/imu` | 板→云 | 周期，JSON `{"gx":..,"gy":..,"gz":..,"ax":..,"ay":..,"az":..,"temp":..}` |
| `前缀/status/ap3216c` | 板→云 | 周期，JSON `{"als":..,"ps":..,"ir":..}` |
| `前缀/cmd/led` | 云→板 | 下发 "0"/"1" 控制 LED |

默认前缀 `imx6ull/alpha`，手机订阅 `imx6ull/alpha/#` 看全部状态，发布到 `imx6ull/alpha/cmd/led` 控制。

## 5. 上位机连接指南（手机 / PC 查看与控制）

上位机用任意 MQTT 客户端连同一个公网 broker 即可查看板上信息、远程控制 LED，不需要和板子在同一个局域网。

### 5.1 连接配置（"名称"怎么选）

| 项 | 填什么 |
|---|---|
| 连接名称 | 任意，只是本地备注，如 `IMX6ULL` / `我的开发板` |
| 服务器地址 | `broker.emqx.io` |
| 端口 | `1883` |
| 用户名 / 密码 | 留空（公共 broker 免认证） |
| Client ID | 填个不重复的，如 `phone01`、`pc01`（**不能和板子的 `imx6ull_alpha` 相同**，否则会互踢） |

### 5.2 订阅主题（"看信息"）

最省事：订阅 `imx6ull/alpha/#`（`#` 通配该前缀下所有话题）。或按需分开订阅：

| 主题 | 内容 | 更新频率 |
|---|---|---|
| `imx6ull/alpha/status/online` | `online`；断线自动变 `offline`（retained） | 连接变化时 |
| `imx6ull/alpha/status/led` | `0` / `1`（retained） | LED 变化时 |
| `imx6ull/alpha/status/cpu_temp` | 如 `60.9` | 每 3 秒 |
| `imx6ull/alpha/status/imu` | `{"gx":..,"gy":..,"gz":..,"ax":..,"ay":..,"az":..,"temp":..}` | 每 1 秒 |
| `imx6ull/alpha/status/ap3216c` | `{"als":..,"ps":..,"ir":..}` | 每 1 秒 |

### 5.3 发布主题（"控制"）

| 主题 | 内容 | 作用 |
|---|---|---|
| `imx6ull/alpha/cmd/led` | `1` | 开 LED |
| `imx6ull/alpha/cmd/led` | `0` | 关 LED |

板子收到后回传 `status/led` 确认。

### 5.4 不同上位机软件的具体填法

- **手机 MQTT Dashboard**：新建连接 → 名称随便填 → Address=`broker.emqx.io`、Port=`1883` → 添加订阅 `imx6ull/alpha/#`；要控制时在发布框里主题填 `imx6ull/alpha/cmd/led`、内容填 `1`/`0`
- **PC 端 MQTTX**（跨平台、界面友好）：新建连接 → 名称任意 → Host=`broker.emqx.io`、Port=`1883` → 订阅 `imx6ull/alpha/#` 实时查看；发布窗口向 `cmd/led` 发 `1`/`0` 控制
- **PC 端 MQTT Explorer**：填 Address=`broker.emqx.io`、Port=`1883` 建连接 → 直接添加订阅 `imx6ull/alpha/#`

> 若改过板子 `/etc/iot_control.conf` 的 `prefix`，把上面所有 `imx6ull/alpha` 换成新前缀即可；客户端 ID 每次都要和板子 `client_id` 不同。

## 6. 开机联网自动时钟校准

- 已写入 `/etc/wifi_auto.sh`：wifi 连上外网后自动执行 `ntpdate`（阿里/公网NTP 依次尝试）并把时间写入 RTC（`hwclock -w`），之后每约 50 分钟校时一次
- 验证：重启后板子上执行 `date` 看时间是否正确；`hwclock -r` 看 RTC
- 若想改 NTP 服务器：编辑 `/etc/wifi_auto.sh` 里的 `sync_time()` 函数

## 7. 编译与部署

```bash
cd ~/Linux_dev/imx6ull/my_code
./qtflash_auto.py build iot_control    # 编译(输出到 ui/src/apps)
./qtflash_auto.py app iot_control      # 编译 + 传输到板子
# 或整体部署桌面(会把 apk2.cfg/图标一起带上):
./qtflash_auto.py deploy
```

首次部署还需把 paho 库放到板子（已部署过可跳过）：

```bash
scp qt_dev/third_party/paho/lib/libpaho-mqtt3c.so.1.3.8 root@192.168.1.20:/usr/lib/
ssh root@192.168.1.20 "ln -sf libpaho-mqtt3c.so.1.3.8 /usr/lib/libpaho-mqtt3c.so.1; ldconfig"
```

## 8. 常见问题

| 现象 | 处理 |
|---|---|
| 手机连不上 broker | 确认手机能上网；地址填 `broker.emqx.io` 端口 `1883` |
| 板子 app 显示未连接 | 板子需已联网（wifi 连上 `lnx`）；`/etc/iot_control.conf` 检查地址；查看 app 内日志 |
| 多块板子冲突 | 每块板子改 `/etc/iot_control.conf` 的 `client_id` 和 `prefix` 为不同值 |
| LED 没反应 | 先看 `status/led` 是否回传；确认 `cmd/led` 发的是 `1`/`0` 文本 |
| 改配置后不生效 | 修改 `/etc/iot_control.conf` 后重启 app（退出再点图标打开） |
| 时间还是老的 | 检查 wifi 是否联网（`ping 8.8.8.8`）；`ntpdate -q ntp.aliyun.com` 手动测 |
