---
title: qtflash 使用文档
published: 2026-08-12
description: IMX6ULL 开发板 Qt 快速部署工具使用说明（qtflash 手动 / qtflash_auto 全自动）。
tags: [嵌入式, Qt, IMX6ULL, 部署]
category: 嵌入式开发
draft: false
---

# qtflash 使用文档

IMX6ULL 开发板 Qt 快速部署工具使用说明。

## 1. 简介

项目中提供了两个命令，用于把 Qt 工程从 WSL 编译打包并部署到开发板运行：

| 命令 | 模式 | 定位 |
|---|---|---|
| `qtflash` | 手动 | 打包/编译 + **打印板子端命令**，你自己复制到串口或 ssh 执行 |
| `qtflash_auto` | 自动 | 打包/编译 + **通过 ssh 全自动**部署并重启，一条命令搞定 |

两者共用相同的打包、tftp、构建逻辑，`qtflash_auto` 额外依赖板子上的 ssh 服务。

## 2. 环境与前提

### 2.1 网络

- 网线直连板子与电脑有线网卡
- 板子静态 IP：`192.168.1.20`（开机由 `/etc/rc.local` 自动设置）
- 电脑/WSL IP：`192.168.1.101`（Windows 有线网卡手动配置，WSL2 mirrored 模式共享该 IP）

### 2.2 依赖服务

- **tftpd-hpa**（WSL 侧）：文件下载服务，根目录 = `qt_dev/`。命令会自动检查并启动。
  > 若板子下载超时，检查 Windows 防火墙是否放行入站 UDP 69。
- **dropbear**（板子侧）：ssh 服务，供 `qtflash_auto` 使用。root 密码即 `qtflash_auto.py` 里 `PASSWORD` 常量。

### 2.3 配置常量

两个脚本顶部有常量，换网段/换板子时修改：

| 常量 | 文件 | 默认值 | 含义 |
|---|---|---|---|
| `QT_DEV` | qtflash.py | `~/Linux_dev/imx6ull/qt_dev` | Qt 工程根目录（tftp 根目录） |
| `BOARD_IP` | qtflash.py | `192.168.1.20` | 板子 IP |
| `PC_IP` | qtflash.py | `192.168.1.101` | 电脑 IP |
| `TOUCH_DEV` | qtflash.py | `/dev/input/event1` | 触摸屏设备（goodix） |
| `PASSWORD` | qtflash_auto.py | `0314` | 板子 root ssh 密码 |

> `qtflash_auto.py` 通过 `import qtflash` 复用后者的 `QT_DEV/BOARD_IP/PC_IP/TOUCH_DEV`，只需额外改 `PASSWORD`。

## 3. `qtflash` —— 手动模式

只在本机执行，把需要你在板子上执行的命令**打印出来**。

### 3.1 `qtflash`（默认 deploy）

打包 `ui/` 为 `ui.tar.bz2` → 确认 tftpd 运行 → 打印板子端命令：

```bash
killall QDesktop systemui 2>/dev/null
tftp -g -r ui.tar.bz2 192.168.1.101
tar xjf ui.tar.bz2 -C /opt
chmod +x /opt/ui/systemui
source /etc/profile
export TSLIB_TSDEVICE=/dev/input/event1
nohup /opt/ui/systemui > /tmp/systemui.log 2>&1 &
sleep 3
tail -5 /tmp/systemui.log
```

把这段复制到板子串口执行即可。`source /etc/profile` 保证触摸（`QT_QPA_FB_TSLIB=1`）等出厂环境生效。

### 3.2 `qtflash build [工程]`

- 无参数：调用 `qt_dev/build.sh all` 编译全部 Qt 工程
- 带工程名：只编译指定工程，如 `qtflash build beep`

### 3.3 `qtflash app <名字>`

编译单个 app（如 `qtflash app beep`），把二进制放到 tftp 根目录 `app.bin`，并打印更新板子 `/opt/ui/src/apps/<名字>` 的命令。systemui 每次点击图标时才加载 app，更新后无需重启桌面。

### 3.4 `qtflash transfer <本地文件> [板子目标路径]`

把任意本地文件复制到 tftp 根目录 `transfer.bin`，打印推到板子的命令。目标路径默认 `/opt/<文件名>`。

### 3.5 `qtflash run [板子路径]`

打印带触摸环境运行程序的命令。默认运行 `/opt/ui/systemui`；传路径则运行指定程序（独立 Qt 工程用）。日志写到 `/tmp/systemui.log`（默认）或 `/tmp/app.log`（指定路径）。

### 3.6 其它子命令

| 命令 | 作用 |
|---|---|
| `qtflash pack` | 仅重新打包 `ui.tar.bz2` |
| `qtflash libqro` | 重新生成库修复包 `libqro.tar.gz`（从工具链 sysroot 取 ARM32 `libQt5RemoteObjects`） |
| `qtflash status` | 查看 tftpd 状态、板子 ping、部署包信息 |
| `qtflash staticip` | 打印板子静态 IP 配置说明 |

## 4. `qtflash_auto` —— 自动模式

通过 ssh 连接板子，自动完成传输、解压、重启、抓日志，日常开发主力。

### 4.1 `qtflash_auto`（默认 deploy）

一键部署：
1. 打包 `ui/` → `ui.tar.bz2`
2. 确认 tftpd 运行
3. ssh 校准板子时钟 → tftp 拉取 → 解压到 `/opt` → chmod +x
4. kill 旧进程 → `source /etc/profile` + `TSLIB_TSDEVICE` → nohup 重启 systemui
5. 抓取启动日志，自动判断是否有关键报错（缺库/ELF 错误/段错误等）

### 4.2 `qtflash_auto app <名字>`

只更新单个 app：编译 → 传输到 `/opt/ui/src/apps/<名字>` → chmod +x。点击图标即用新程序。

### 4.3 `qtflash_auto transfer <本地文件> [板子目标路径]`

任意文件推送到板子，自动 chmod +x。默认目标 `/opt/<文件名>`。

### 4.4 `qtflash_auto run [板子路径]`

- 无参数：重启 systemui（默认 `/opt/ui/systemui`）
- 带路径：kill 掉 QDesktop/systemui 后运行指定程序，如 `qtflash_auto run /opt/mytest`

### 4.5 其它子命令

| 命令 | 作用 |
|---|---|
| `qtflash_auto build [工程]` | 编译全部或指定工程（同 qtflash） |
| `qtflash_auto kill` | 关闭板子上的 QDesktop / systemui |
| `qtflash_auto log` | 查看板子 `systemui.log` 和 `app.log` 启动日志 |
| `qtflash_auto status` | 板子 ping / eth0 IP / dropbear 状态 |

## 5. 典型工作流

| 场景 | 命令 |
|---|---|
| 改完整体代码，重新部署桌面 | `qtflash_auto` |
| 只改某个 app（如 beep） | `qtflash_auto app beep` |
| 独立 Qt 工程上板运行 | `qtflash_auto transfer 我的程序 && qtflash_auto run /opt/我的程序` |
| 不想用 ssh，手动操作 | `qtflash` + 复制打印的命令到串口 |
| 查看启动报错 | `qtflash_auto log` |
| 重新编译全部 | `qtflash_auto build` |

## 6. 新增 App 指南

从模板新建一个 app（以 `mytest` 为例）：

1. **复制模板**：
   ```bash
   cp -r qt_dev/template qt_dev/mytest
   ```
2. **清理构建产物**并重命名工程文件（否则 qmake 仍按 `template` 生成）：
   ```bash
   cd qt_dev/mytest
   rm -f Makefile .qmake.stash template *.o moc_* qrc_* rep_*
   mv template.pro mytest.pro
   ```
3. **改身份**：编辑 `main.qml`，`programmerName: "template"` 改为 `"mytest"`（必须与 apk cfg 中的 app 名一致）。
4. **写界面**：在 `AppMainBody.qml` 里放你的测试 UI（Client 外壳自带标题栏和返回桌面按钮）。
5. **加图标**：复制一个现有图标，如 `cp qt_dev/ui/src/appicons/pcba.png qt_dev/ui/src/appicons/mytest.png`。
6. **注册到桌面**：在 `qt_dev/ui/src/ATK-IMX6U/apkN.cfg` 末尾加一行（格式：`图标 显示名 app名`）。应用页共 4 页，对应 `apk1.cfg`~`apk4.cfg`，底部快捷栏用 `apk5.cfg`；新应用通常加在 `apk4.cfg`：
   ```
   appicons/mytest.png 我的测试 mytest
   ```
7. **编译 + 部署**：
   ```bash
   qtflash_auto build mytest   # 编译，二进制自动进 ui/src/apps/mytest
   qtflash_auto deploy         # 整包部署 + 重启 systemui
   ```
8. 在屏幕上点击新图标验证。之后小改只需 `qtflash_auto app mytest`。

## 7. 常见问题排查

| 现象 | 原因 / 处理 |
|---|---|
| 板子 tftp 下载超时 | Windows 防火墙拦截 UDP 69。管理员 PowerShell 放行：`New-NetFirewallRule -DisplayName tftp69 -Direction Inbound -Protocol UDP -LocalPort 69 -Action Allow`，或临时关闭防火墙 |
| ssh 连接报 `no matching host key type` | 板子 dropbear 仅支持 `ssh-rsa`，脚本已带 `-o HostKeyAlgorithms=+ssh-rsa` 兼容；手动 ssh 时需加同样参数 |
| 界面显示了但点不动 | 触摸环境未生效：必须 `source /etc/profile` 且 `export TSLIB_TSDEVICE=/dev/input/event1`（goodix）。若仍无效可改用 `QT_QPA_EVDEV_TOUCHSCREEN_PARAMETERS=/dev/input/event1` |
| 解压时大量 `time stamp ... in the future` 告警 | 板子时钟不准。`qtflash_auto deploy` 会自动校准（`date -s` 设置系统时间并 `hwclock -w` 写入 RTC，重启后保持）；手动模式下板子执行 `date -s "YYYY-MM-DD HH:MM:SS" && hwclock -w` |
| `libQt5RemoteObjects.so.5: wrong ELF class` | 板子上该库是 64 位版本。用 `qtflash_auto transfer` 推送工具链里的 ARM32 库并替换，或 `qtflash libqro` 重新打包 |
| `error while loading shared libraries` | 板子缺库。用 `ldd` 在板子上看缺什么，从 `/opt/fsl-imx-x11/.../sysroots/cortexa7hf-neon-poky-linux-gnueabi/usr/lib/` 对应拷贝 |
| 想改板子 ssh 密码 | 板子 `passwd root` 修改，并同步更新 `qtflash_auto.py` 的 `PASSWORD` 常量 |
