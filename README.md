# LIMIVIA Server（莉米维娅工作台）

LIMIVIA 是一套以软件为核心、连接数字世界与物理世界的通用硬件操作与开发框架。它通过软件抽象和可视化交互，让具备软件或 AI 背景、缺乏硬件经验的人逐步理解并操纵真实设备。

本仓库的发布名和启动命令为 **limivia-server**，Python 包名为 **limivia_server**。硬件控制、协议模型和事件流由独立的 [limivia Python SDK](../limivia/README.md) 提供，依赖方向为 `server → SDK → USB/BLE`。

首版支持 **合宙 CORE ESP32-C3 简约版（无串口芯片，外置 4MB Flash）**。网页通过同源 WebSocket 访问 **Python 后端管理的 BLE / USB 设备**，默认使用蓝牙。FastAPI 统一托管前端与设备通道，Poetry/Typer CLI 提供服务启动与环境检查。固件、构建、烧录及实机验证独立在 [limivia-esp32 仓库](../limivia-esp32/README.md)。

## 灵感来源与致谢

LIMIVIA 受到 [wave-del 同学的 esp32-audio-web 项目](https://github.com/wave-del/esp32-audio-web) 的启发。在本项目发起者的了解与交流范围内，wave-del 同学最早提出了类似思路，其项目为 LIMIVIA 的构思提供了最初的启发。感谢他对通过网页连接和操纵物理设备这一方向的探索。

## 首版能力

| 能力 | 支持内容 |
|---|---|
| USB / BLE | 后端扫描与连接、设备握手、状态同步、断线提示与重新连接 |
| 板载 LED | D4 连接状态，D5 开关、PWM 调光及呼吸演示 |
| GPIO | 输入、输出、上拉、下拉，真实电平读回与引脚占用 |
| PWM / LEDC | 最多 4 路独立频率，5–40000Hz，占空比、呼吸周期、停止 |
| ADC1 | GPIO0/1/3/4 单次或周期采集，原始值、校准电压、曲线与 CSV |
| 本地定时 | 最多 4 个周期闪烁或单次脉冲任务，断线继续，重启清空 |

首版不包含 SPI、I²C、I²S、Wi-Fi、复杂状态机或脚本 IDE。AI 通过统一命令与能力描述留出扩展点，目前不调用模型。

工作台界面同步自 [Figma 当前 UI 快照（2026-10-21）](https://www.figma.com/design/9WbAWG0bfGyDgJPDugJMTh/?node-id=33-2887)，包含五类实验、连接、引脚资源、帮助和命令日志。桌面采用侧栏，窄屏采用横向导航；实际读数、资源占用和任务状态由设备返回。图标与板卡功能示意存于本地，来源见 [资源说明](src/web/src/assets/figma/README.md)。

## 安装与启动

开发依赖：Python 3.12、Poetry、Node.js（建议本项目已验证的 24.x）和 pnpm。运行工作台无需 ESP-IDF 或固件仓库。SDK 仍在开发阶段，暂不在本项目依赖中声明；运行前必须通过 pip 将 SDK 的 WHL 手动安装到本项目的 Poetry 虚拟环境，Bleak 和 pySerial 随 SDK 安装。

先在 SDK 仓库执行 `poetry build -f wheel`，再回到本仓库安装。下面以 SDK 位于 `../limivia`、版本为 `0.1.0` 为例；可替换成实际 WHL 路径，无需固定同级目录。

```bash
poetry env use python3.12
poetry install
poetry run python -m pip install ../limivia/dist/limivia-0.1.0-py3-none-any.whl
pnpm --dir src/web install --frozen-lockfile
pnpm --dir src/web run build
poetry run limivia-server serve
```

SDK 同版本重新构建后，先执行 `poetry run python -m pip install --force-reinstall --no-deps ../limivia/dist/limivia-0.1.0-py3-none-any.whl` 替换旧包，再执行上面的普通安装命令补齐依赖。执行 `poetry sync` 会清理手动安装的 SDK 及其独有依赖，之后需要重新安装 WHL。

打开 **http://127.0.0.1:8000**。标准运行只有一个后端服务，托管 `src/web/dist`；Vite dev 仅用于需要 HMR 的前端开发。前端未构建时服务会给出明确错误。

```bash
poetry run limivia-server doctor
poetry run python -m limivia_server.commands.app serve --port 8000
```

两个项目各使用自己的 Python 3.12 `.venv`，可通过 `poetry run python --version` 和 `poetry env info --path` 核对。原项目的 Python 3.10 缓存环境已在目录迁移前移除，避免旧安装路径指向新的 SDK；本次实际解释器为 Python 3.12.3。

可通过 `LIMIVIA_HOST`、`LIMIVIA_PORT` 设置监听地址与端口。默认仅监听本机。VS Code 选择“LIMIVIA 后端”调试，`web: build` 会先通过 `web: install` 执行 `pnpm install --frozen-lockfile` 准备前端依赖，再构建前端；安装或构建失败时不会启动后端。首次安装依赖需要访问包源，锁文件与依赖声明不一致时需先手动更新并检查锁文件。所有调试配置读取 `.env`，可从 `.env.example` 复制。终端 CLI 读取当前 shell 环境变量。

## 连接与第一次实验

1. 确认开发板已安装本工程专用固件并供电；蓝牙连接需在后端电脑附近，USB 连接需将数据线插入后端电脑。
2. 点击右上角“连接设备”，默认选择“BLE 蓝牙”。点击“搜索设备”，选择目标后点击“连接所选设备”；使用 USB 时先切换“USB”再搜索。搜索只找到一个设备时会自动选中，仍需手动连接。
3. 等待顶栏显示“已连接”，在“板载 LED”页点击“点亮 LED”或“熄灭 LED”。按钮等待设备确认后才更新输出状态；“读取状态”不会改变输出。
4. 若要从开关输出切换到呼吸，先在“板卡与引脚”中“释放引脚”并确认，再选择“呼吸演示”、点击“开始呼吸”。呼吸运行时切回“开关控制”会先请求确认停止。其他实验也会显示引脚占用，不静默终止已有任务。
5. 完成实验后，在“板卡与引脚”中点击“停止全部输出…”并确认；主动断开位于右上角“连接详情”。仅关闭网页或断开连接不会停止板上 PWM、ADC 或本地任务；持续供电时任务继续运行，重连可读取和停止。

参数可在未连接时预设，启动或应用才向设备提交。PWM 页并列显示正在编辑的值和设备已确认配置；ADC 的“单次采样与间隔设置”提供单次读取与间隔更新，停止采样后仍可导出当前引脚的 CSV，重连会清空上一连接的采样。底部“命令与事件”打开最近 200 条日志。

USB 与 BLE 都由 **运行 Python 后端的那台电脑**管理。浏览器通过同源 WebSocket 转发协议帧与设备事件，无需浏览器蓝牙、串口 API 或实验特性。浏览器所在电脑的 USB 与蓝牙不会被使用。网页关闭、网络中断或主动断开会释放后端连接；持续供电的板上任务仍会继续，重新连接会读取当前状态。

后端同一时刻只允许一个页面占用设备连接，切换连接方式前先断开；其他页面会收到占用提示。设备扫描只展示匹配 BLE 服务或 Espressif USB VID/PID 的候选，最终以 `hello` 握手确认板型和协议。命令超时或执行结果未知时，界面保留最后已知信息并暂停输出操作；先读取状态或重新连接，确认成功后再操作，不自动重发命令。运行工作台时保持单个后端进程、单个 Uvicorn worker，避免多个进程竞争设备。

### 后端蓝牙与串口环境

- BLE 使用 [Bleak](https://bleak.readthedocs.io/en/latest/)，后端电脑必须有可用且已开启的蓝牙适配器；Linux 需要 BlueZ 与可访问的系统 D-Bus。Windows/macOS 需允许运行 Python 的终端或应用访问蓝牙。
- USB 使用 [pySerial](https://pyserial.readthedocs.io/en/stable/pyserial_api.html)，Linux 后端用户需要串口权限（通常为 `dialout` 或发行版对应组）；关闭占用串口的监视器或烧录程序。
- 若后端运行在 WSL、容器、虚拟机或远程主机中，USB 和蓝牙必须对该运行环境可见；仅转发网页端口不会转发硬件。搜索失败时页面会给出后端环境提示，空列表则检查供电、距离与连接。
- 默认使用本机 `http://127.0.0.1:8000`。WebSocket 校验同源 Origin。当前没有远程用户鉴权，不应将设备控制服务直接暴露到公共网络。

## 固件仓库

ESP32 固件及配套工具已迁至独立仓库 **limivia-esp32**，本机目录为 `../limivia-esp32`。构建、烧录与固件实机验证请在该仓库执行，安装步骤见其 [README](../limivia-esp32/README.md)。工作台仍通过协议 v1 连接已安装专用固件的设备；没有网页烧录器或自动下载固件功能。

原 CLI 命令已迁移：

| 原命令（已移除） | 在固件仓库运行 |
|---|---|
| `limivia firmware build` | `poetry run limivia-esp32 build` |
| `limivia firmware flash --port …` | `poetry run limivia-esp32 flash --port …` |
| `limivia firmware verify --port …` | `poetry run limivia-esp32 verify --port …` |

两仓库可以分别检出，运行或构建均不要求互相存在。协议真源在本仓库 `docs/protocol.md`，固件仓库保留注明来源提交的协议快照。更改协议时需协调两端；连接时用 `hello.protocol` 检查兼容性，固件版本独立演进。

## 引脚与接线

- 实验引脚：GPIO0、1、3、4、5、6、7、10、13、20、21。
- D4 / GPIO12 为系统状态 LED；D5 / GPIO13 为实验 LED，高电平有效。
- GPIO18/19 是原生 USB；GPIO14–17 为 Flash；GPIO2/8/9 为启动绑带相关；GPIO11 涉及 Flash 电压配置。上述保留脚不能用于首版实验，不写 eFuse。
- GPIO 使用 **3.3V 逻辑**；ADC 测量输入使用 **0–2.5V**，不能把 5V 供电脚接入 GPIO/ADC。外部设备需共地，电机等负载应使用相应驱动电路。
- 从“板卡与引脚”打开“实物接线图 · 32 引脚”。接线图对应简约版实物的 32 个引脚（左右各 16 个），默认元件正面、天线上、USB 下。切换背面仅交换左右；放大接线图支持窄屏滚动和 Escape 关闭。资源弹窗中的板卡功能示意不用于确定物理脚位。
- 接线配色：5V 红、GND 黑、3.3V 黄、ADC 能力脚 GPIO0–5 蓝、其余数字信号绿；NC、EN、PWB 为中性灰。颜色表示硬件能力，不表示当前固件已开放：GPIO2 受保护，GPIO5 的 ADC2 当前未启用；PWM 不是真正的 DAC 模拟输出。
- 点击引脚只查看功能及限制，不发送命令；实线外框与下划线标出当前实验目标。图中引脚位置一一对应，元件轮廓经过简化，接线时按所选正反面核对丝印。
- 固件只适配确认过的外置 Flash 板型；带内置 Flash 的变体不能照用 GPIO12/13 映射。

板卡和芯片资料沉淀在工程专用 [limivia-esp32c3 skill](.agents/skills/limivia-esp32c3/SKILL.md)，通过 [AGENTS.md](AGENTS.md) 引导使用，不安装到用户全局目录。

## 验证

```bash
pnpm --dir src/web run build
poetry run pytest -q
poetry run ruff check src/limivia_server tests
pnpm --dir src/web run lint
pnpm --dir src/web test
pnpm --dir src/web exec playwright install chromium
pnpm --dir src/web run test:e2e
```

实机验证工具与硬件测试记录已迁至固件仓库，使用方式见其 README。

本次真实执行结果与环境限制见 [验证记录](docs/verification.md)。浏览器 E2E 的设备控制测试使用隔离的后端响应模拟；后端适配器测试使用可控的模拟传输，模拟代码仅在测试目录中，不进入应用构建。

## 工程结构与扩展

```text
src/limivia_server/  FastAPI 托管、SDK 事件与网页协议适配、工作台 Typer CLI
src/web/            React 工作台、WebSocket 客户端、前端测试
.agents/skills/     仅本工程使用的板卡与芯片知识
../limivia/         独立 Python SDK：USB/BLE、命令、强类型事件
```

Server 使用 `AsyncLimivia`，每个浏览器连接对应一个 SDK 会话。SDK 自动握手、排队命令、关联请求并产生类型化事件；适配层保留网页已有 HTTP/WebSocket 格式，并独立映射浏览器请求 ID。

协议真源见 [设备协议](docs/protocol.md)，页面状态与交互约定见 [界面契约](docs/ui-state.md)。未来新增硬件能力时，协调对应固件仓库的校验与能力描述，并更新本仓库前端控件和协议测试。白垣视觉 Token 来源于苍渊·白垣 v1.1，MANAS 负责工作台关系与交互。

## 开源协议

本仓库采用 **GNU Affero General Public License v3.0（AGPL-3.0-only）**，完整条款见 [LICENSE](LICENSE)。第三方依赖与另有许可声明的内容保留各自的许可证。
