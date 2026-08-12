# appflash 使用文档

IMX6ULL 开发板 Linux C 应用一键交叉编译、部署、运行工具使用说明。

## 1. 简介

`appflash` 用于把 `11、Linux C应用编程例程源码/` 下的 C 例程（或任意 `.c` 源文件）快速放到开发板上运行。一条命令完成三件事：

1. **交叉编译**：用工具链的 `$CC` 编译源文件，自动探测并链接所需库（tslib/jpeg/png/freetype/alsa 等）
2. **部署**：通过 tftp 把二进制推到板子的用户家目录 `/home/root/`
3. **运行**：通过 ssh 在板子上启动程序并回显启动日志

与 `pyflash`（裸机烧录）、`qtflash` / `qtflash_auto`（Qt 部署）互补：

| 命令 | 对象 | 方式 |
|---|---|---|
| `pyflash` | 裸机程序 `.bin` | make + uuu USB 烧录 |
| `qtflash` / `qtflash_auto` | Qt 工程 | 打包 ui.tar.bz2 + tftp 部署 |
| `appflash` | Linux C 应用 | 交叉编译 + tftp 到家目录 + ssh 运行 |

## 2. 环境与前提

### 2.1 网络

- 网线直连板子与电脑有线网卡
- 板子静态 IP：`192.168.1.20`
- 电脑 IP：`192.168.1.101`
- 板子 root ssh 密码：`0314`

### 2.2 依赖服务

- **tftpd-hpa**（WSL 侧）：文件下载服务，根目录 = `qt_dev/`。命令会自动检查并启动，文件经根目录下 `.appflash/` 暂存子目录传输（避免与 Qt 工程目录同名冲突）。
  > 若板子下载超时，检查 Windows 防火墙是否放行入站 UDP 69。
- **dropbear**（板子侧）：ssh 服务，供自动运行使用。

### 2.3 配置常量

脚本 `/home/lnx/Linux_dev/imx6ull/my_code/appflash.py` 顶部常量，换网段/换板子时修改：

| 常量 | 默认值 | 含义 |
|---|---|---|
| `SRC_ROOT` | `~/Linux_dev/imx6ull/ref_code/11、Linux C应用编程例程源码` | C 例程根目录 |
| `TFTP_ROOT` | `~/Linux_dev/imx6ull/qt_dev` | tftp 根目录（`.appflash/` 为暂存子目录） |
| `BOARD_IP` | `192.168.1.20` | 板子 IP |
| `PC_IP` | `192.168.1.101` | 电脑 IP |
| `BOARD_HOME` | `/home/root` | 板子家目录（程序安装位置） |
| `PASSWORD` | `0314` | 板子 root ssh 密码 |
| `ENV_SETUP` | `/opt/fsl-imx-x11/.../environment-setup-...` | 交叉编译环境脚本 |

## 3. 一键用法（核心）

```bash
appflash <目标> [程序参数...]
```

`<目标>` 可以是：

- 目录：`appflash 15_led`
- 目录 + 文件名：`appflash 17_input/read_key.c`
- 相对例程根目录的路径，或绝对路径

程序参数直接跟在目标后面即可，参数开头的 `--` 会被自动去掉：

```bash
appflash 15_led off          # 板子上执行: /home/root/led off
appflash 15_led/ --off       # 同样执行 led off(--off 自动转 off)
appflash 17_input/read_ts.c  # 直接运行
```

若程序需要真正以 `--` 开头的参数（如长选项），用独立的 `--` 分隔符原样透传：

```bash
appflash myprog -- --verbose --count 3
```

流程与输出：

```
[1/4] 编译 read_ts.c -> read_ts  库: -lts     # 自动探测库
[*] 生成 .../read_ts (10744 B)
[*] tftpd-hpa 运行中
[2/4] 传输 read_ts -> 板子 /home/root/
[3/4] 板子运行 /home/root/read_ts
----- 启动日志 -----
...
----- 运行状态 -----
  PID ?  00:00:01 read_ts
[4/4] 完成!程序已启动
```

### 多文件目录

目录下有多个 `.c` 文件（如 `16_gpio`、`17_input`、`28_alsa-lib`）时，会打印编号菜单让你选择要编译的源文件：

```
[?] .../18_tslib 下有多个 .c 文件,请选择要编译的:
    [1] ts_read.c
    [2] ts_read_mt.c
选择编号:
```

更省事的方式是直接指定文件名：`appflash 28_alsa-lib/pcm_playback.c`。

### 库自动探测

编译时扫描 `#include`，自动加上链接库，无需手动指定：

| 头文件 | 链接参数 |
|---|---|
| `tslib.h` | `-lts` |
| `jpeglib.h` | `-ljpeg` |
| `png.h` | `-lpng` |
| `ft2build.h` | `-lfreetype -I<sysroot>/usr/include/freetype2`（有 `math.h` 时自动加 `-lm`） |
| `asoundlib.h` / `alsa/` | `-lasound` |

## 4. 子命令

| 命令 | 作用 |
|---|---|
| `appflash build <目标>` | 只交叉编译，二进制输出到源码目录（不加 `-l` 也能看到探测到的库） |
| `appflash transfer <本地文件> [板端路径]` | 任意文件推到板子并 chmod +x，默认 `/home/root/<文件名>` |
| `appflash run <名字> [参数...]` | 运行板子上 `/home/root/<名字>`（会先 kill 旧进程，参数规则同第 3 节） |
| `appflash kill <名字>` | 关闭板子上同名进程 |
| `appflash log <名字>` | 查看板子上 `/tmp/<名字>.log` 启动日志 |
| `appflash status` | 查看 tftpd / 板子 ping / HOME / dropbear 状态 |
| `appflash list` | 列出所有例程及每个目录下的源文件 |

## 5. 典型工作流

| 场景 | 命令 |
|---|---|
| 编译并运行 LED 例程（点亮） | `appflash 15_led -- on` |
| 运行 socket 服务器（长驻进程） | `appflash 30_socket/socket_server.c`，日志用 `appflash log socket_server` 查看 |
| 只编译不部署 | `appflash build 20_libjpeg/show_jpeg_image.c` |
| 把 PC 上的某个文件推上板子 | `appflash transfer ./app /home/root/mytest` |
| 重新运行已部署的程序 | `appflash run ts_read`（`run` 只接受板子家目录里的文件名） |
| 停掉后台程序 | `appflash kill socket_server` |

## 6. 交互式 / 流式程序怎么用

`read_ts`、`socket_server`、`pcm_playback` 这类程序是**后台常驻**的：输出进板子的 `/tmp/<名字>.log`，**不会**回显到电脑终端。所以"看不出效果"多半是：程序要参数没给、或效果要靠 log 看。三步套路：

1. **run**：编译、传输、后台启动（常需要带设备/端口参数）
   ```bash
   appflash 17_input/read_ts.c /dev/input/event1   # 触摸屏参数自己传(板上 goodix 触摸 = event1)
   ```
   刚启动时 `----- 启动日志 -----` 是空的，**正常**——还没产生任何事件。
2. **交互**：去开发板上操作（点/划屏幕、连端口、放音乐……）
3. **log / kill**：看输出、完事停掉
   ```bash
   appflash log read_ts   # 显示 按下(x,y) / 移动(x,y) / 松开
   appflash kill read_ts  # 停止常驻程序
   ```

> 常驻程序占着设备（如触摸屏），若后面要跑 Qt 桌面或另一个用同一设备的程序，记得先 `appflash kill <名字>`。

## 7. 常见问题排查

| 现象 | 原因 / 处理 |
|---|---|
| 板子 tftp 下载超时 | Windows 防火墙拦截 UDP 69。管理员 PowerShell 放行：`New-NetFirewallRule -DisplayName tftp69 -Direction Inbound -Protocol UDP -LocalPort 69 -Action Allow`，或临时关闭防火墙 |
| ssh 连接报 `no matching host key type` | 板子 dropbear 仅支持 `ssh-rsa`，脚本已带 `-o HostKeyAlgorithms=+ssh-rsa` 兼容；手动 ssh 时需加同样参数 |
| `cannot open shared object ...` | 板子缺运行库。先在板子上 `ldd /home/root/<程序>` 看缺什么，再到板子 `/usr/lib` 确认，或从 `sysroots/cortexa7hf-neon-poky-linux-gnueabi/usr/lib/` 对应拷贝 |
| `wrong ELF class` | 二进制是 x86_64（本机误用 `gcc` 编译）或 64 位 ARM。确认输出为 `ELF 32-bit ARM`；脚本始终走交叉编译 `$CC` |
| 编译报找不到 paho/MQTT 头文件 | `33_mqtt` 例程依赖 paho.mqtt.c 库，本机与板子均未安装，脚本会明确报错提示。需要先交叉编译安装 paho 到工具链 sysroot |
| 触摸例程（tslib）点了没反应 | 脚本运行时会自动 `export TSLIB_TSDEVICE=/dev/input/event1`；若设备号不同，改脚本里 `TOUCH_DEV` 常量 |
| 程序需要传参数 | 参数直接跟在目标后：`appflash 15_led --off`（开头 `--` 自动去掉）。需要原样保留 `--` 前缀的长选项时用 `--` 分隔：`appflash myprog -- --verbose` |
| 想改板子 ssh 密码 | 板子 `passwd root` 修改，并同步更新 `appflash.py` 的 `PASSWORD` 常量 |
