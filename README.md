# LIMIVIA（莉米维娅）

LIMIVIA 是一套以软件为核心、连接数字世界与物理世界的通用硬件操作与开发框架。它通过软件抽象和可视化交互，让具备软件或 AI 背景、缺乏硬件经验的人逐步理解并操纵真实设备。

首版支持 **合宙 CORE ESP32-C3 简约版（无串口芯片，外置 4MB Flash）**。网页通过 **Web Serial / Web Bluetooth 直接连接设备**。FastAPI 统一托管前端，Poetry/Typer CLI 提供服务启动与环境检查。固件、构建、烧录及实机验证独立在 [limivia-esp32 仓库](../limivia-esp32/README.md)。

## 灵感来源与致谢

LIMIVIA 受到 [wave-del 同学的 esp32-audio-web 项目](https://github.com/wave-del/esp32-audio-web) 的启发。在本项目发起者的了解与交流范围内，wave-del 同学最早提出了类似思路，其项目为 LIMIVIA 的构思提供了最初的启发。感谢他对通过网页连接和操纵物理设备这一方向的探索。

## 首版能力

| 能力 | 支持内容 |
|---|---|
| USB / BLE | 浏览器授权连接、设备握手、状态同步、断线提示与重新连接 |
| 板载 LED | D4 连接状态，D5 开关、PWM 调光及呼吸演示 |
| GPIO | 输入、输出、上拉、下拉，真实电平读回与引脚占用 |
| PWM / LEDC | 最多 4 路独立频率，5–40000Hz，占空比、呼吸周期、停止 |
| ADC1 | GPIO0/1/3/4 单次或周期采集，原始值、校准电压、曲线与 CSV |
| 本地定时 | 最多 4 个周期闪烁或单次脉冲任务，断线继续，重启清空 |

首版不包含 SPI、I²C、I²S、Wi-Fi、复杂状态机或脚本 IDE。AI 通过统一命令与能力描述留出扩展点，目前不调用模型。

## 安装与启动

开发依赖：Python 3.10、Poetry、Node.js（建议本项目已验证的 24.x）和 pnpm。运行工作台无需 ESP-IDF、Python 串口库或固件仓库。

```bash
poetry env use python3.10
poetry install
pnpm --dir src/web install --frozen-lockfile
pnpm --dir src/web run build
poetry run limivia serve
```

打开 **http://127.0.0.1:8000**。标准运行只有一个后端服务，托管 `src/web/dist`；Vite dev 仅用于需要 HMR 的前端开发。前端未构建时服务会给出明确错误。

```bash
poetry run limivia doctor
poetry run python -m limivia.commands.app serve --port 8000
```

可用 `poetry run python --version` 核对实际解释器。若本机 Poetry 创建的环境版本不符，移除本项目的错误虚拟环境后，执行 `python3.10 -m venv .venv`、`poetry env use .venv/bin/python`、`poetry install`；本次已采用项目内 `.venv` 并确认 Python 3.10.20。

可通过 `LIMIVIA_HOST`、`LIMIVIA_PORT` 设置监听地址与端口。默认仅监听本机。VS Code 选择“LIMIVIA 后端”调试，会先执行 `web: build`；所有调试配置读取 `.env`，可从 `.env.example` 复制。终端 CLI 读取当前 shell 环境变量。

## 连接与第一次实验

1. 用支持数据传输的 USB 线连接开发板，确认已安装本工程专用固件。
2. 网页选择“USB 串口”并点击“连接设备”，授权 Espressif USB Serial/JTAG 端口。
3. 等待“设备已就绪”，进入“板载 LED”，点击“点亮 LED”或“熄灭”。
4. 点击“释放引脚”后可启动“呼吸演示”。不同功能互斥占用引脚，界面显示当前占用。
5. 完成实验后可点击“停止全部输出”。仅断开浏览器不会停止板上 PWM、ADC 或本地任务；持续供电时任务继续运行，重连可读取和停止。

USB 与 BLE 都在浏览器端实现，访问的是**运行浏览器的那台机器**上的 USB 端口与蓝牙适配器；远程访问或端口转发后端不会转发 USB 设备。Python 后端不读取或中转实验命令。每个页面一次使用一个通道，切换前先断开。

### BLE 与浏览器兼容性

选择“BLE 蓝牙”后，在浏览器设备选择器中选择 `LIMIVIA-xxxx`。板卡作为 BLE 外设，首版支持一个 BLE 客户端。

- Web Serial / Web Bluetooth 需要浏览器支持、安全上下文及用户点击授权。推荐支持对应能力的 Chromium 浏览器；页面会检测能力。
- 本机 localhost / 127.0.0.1 可用；远程 HTTP 局域网地址不满足同样条件。手机访问另需可访问且受信任的 HTTPS，本项目未配置远程托管。
- Linux Web Bluetooth 可能需要 `chrome://flags/#enable-experimental-web-platform-features`，且系统必须有可工作的 Bluetooth/BlueZ 控制器。
- 不支持对应 API、取消授权、端口占用或断线时，页面显示恢复方法。不会用模拟数据冒充设备连接。

官方说明：[Web Serial](https://developer.chrome.com/docs/capabilities/serial)、[Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth)。

## 固件仓库

ESP32 固件及配套工具已迁至独立仓库 **limivia-esp32**，本机目录为 `../limivia-esp32`。构建、烧录、串口枚举与实机验证请在该仓库执行，安装步骤见其 [README](../limivia-esp32/README.md)。工作台仍通过协议 v1 连接已安装专用固件的设备；没有网页烧录器或自动下载固件功能。

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
- UI 板图是功能示意，不是接线比例图；实际接线核对板上丝印与原理图。
- 固件只适配确认过的外置 Flash 板型；带内置 Flash 的变体不能照用 GPIO12/13 映射。

板卡和芯片资料沉淀在工程专用 [limivia-esp32c3 skill](.agents/skills/limivia-esp32c3/SKILL.md)，通过 [AGENTS.md](AGENTS.md) 引导使用，不安装到用户全局目录。

## 验证

```bash
pnpm --dir src/web run build
poetry run pytest -q
poetry run ruff check src/limivia tests
pnpm --dir src/web run lint
pnpm --dir src/web test
pnpm --dir src/web exec playwright install chromium
pnpm --dir src/web run test:e2e
```

实机验证工具与硬件测试记录已迁至固件仓库，使用方式见其 README。

本次真实执行结果与环境限制见 [验证记录](docs/verification.md)。浏览器 E2E 的设备适配测试使用隔离的模拟外设，模拟代码仅在测试目录中，不进入应用构建。

## 工程结构与扩展

```text
src/limivia/       FastAPI 托管、工作台 Typer CLI
src/web/          React 工作台、浏览器 USB/BLE 适配器、前端测试
.agents/skills/   仅本工程使用的板卡与芯片知识
```

协议真源见 [设备协议](docs/protocol.md)，页面状态与交互约定见 [界面契约](docs/ui-state.md)。未来新增硬件能力时，协调对应固件仓库的校验与能力描述，并更新本仓库前端控件和协议测试。白垣视觉 Token 来源于苍渊·白垣 v1.1，MANAS 负责工作台关系与交互。

## 开源协议

本仓库采用 **GNU Affero General Public License v3.0（AGPL-3.0-only）**，完整条款见 [LICENSE](LICENSE)。第三方依赖与另有许可声明的内容保留各自的许可证。
