# LIMIVIA 莉米维娅

连接数字世界与物理世界的本机硬件实验工作台。浏览器访问同源 Python 后端，后端通过 **limivia 0.3.0a1 / JSON-RPC 2.0 / 业务协议 v3** 连接合宙 CORE ESP32-C3 简约版，支持 USB、BLE、WebSocket 和 MQTT。界面沿用 MANAS 工作台关系与苍渊·白垣 Token，默认白垣。

设备契约必须为 `limivia-v3-jsonrpc2`；相同包版本或 protocol=3 本身不能证明兼容。旧 v1/v2、历史自定义 v3 不兼容。

## 安装与启动

开发环境使用 Python **3.12**、Poetry、项目内 `.venv`、Node.js 和 pnpm。

```bash
poetry env use python3.12
poetry install
pnpm --dir src/web install
pnpm --dir src/web run build
# SDK 暂未发布本轮版本，按项目约定由 pip 单独安装已核验的本地 wheel。
poetry run python -m pip install /实际路径/limivia-0.3.0a1-py3-none-any.whl
poetry run python -m pip check
poetry run limivia-server doctor
poetry run limivia-server serve --port 8000
```

默认监听 `0.0.0.0:8000`。本机打开 `http://127.0.0.1:8000`，其他机器使用服务主机的 IP 访问；可通过 `--host` 或 `LIMIVIA_HOST` 覆盖监听地址。后端统一托管 `src/web/dist`；不需要长期运行第二个前端服务。VS Code 后端调试仍会先执行前端构建。

**SDK 按用户要求不写入 TOML、不由 Poetry 锁定，也不随仓库归档。** 先执行 Poetry 安装，再用 pip 安装 SDK。后续执行 `poetry install` 或 `poetry sync` 可能调整 SDK 所需的传递依赖，需再次执行 SDK 安装、pip check 和 doctor。doctor 显示实际版本、导入位置、契约与 pip 安装来源，不访问硬件。其他服务依赖继续使用 Poetry 和清华源。

本次使用的 SDK 来自独立 limivia 仓库 `dev` 提交 `5149d0ecb72c665730573568fadcea110b94b8da`，已合入业务说明中的升级；wheel SHA256 为 `94a6978483144d5897896077a14dae6f62e25e3626728617f3ebf67caf2f9279`。这是本次验证来源记录，不是运行时相邻目录依赖。

## 从连接到实验

1. 点击“连接设备”。USB/BLE 先搜索并明确选择服务主机候选；WS 填写 `ws://板卡IP/v3`；MQTT 填写 mqtt/mqtts URL 和完整目标 MAC。可使用预期 MAC 核对身份。
2. 连接后读取完整能力与一致状态，保持观察模式。设备工作台显示 profile、固件、协议和实际可用能力，完整 build/boot 在“固件详情”中查看。
3. 在“设备工作台”找到已接线的物理位置，点击引脚并选择功能。单引脚自动带入；UART、I²C、SPI 等先选择当前引脚的角色，再通过板图或下拉框补齐整组接线。可命名接线组，记录备注与供电位置；这些是人工记录，不代表已检测到实物连接。
4. “保存方案”只保存服务器上的接线意图。主动取得设备控制后，依次“检查本组”“应用本组”；预检不预留资源，应用时仍会再次检查。父总线需先应用，随后才能应用子设备。已有运行配置不会因编辑方案而自动替换。
5. 等待设备确认后调试真实资源；结束时明确关闭并核实释放。fault 仍占用引脚和控制器；“重试关闭”不会重新打开资源，父总线级联关闭会明确提示影响整树。

首页与外设调试已合并为 V5 板卡工作台：中央展示完整实物板图，侧栏展示接线组与未归组配置，右侧展示选择对象的配置和调试。板图常规高 480px，小窗口高 388px，窄屏重排为 288×388px，保留 13px 标签和 24px 引脚命中区。桌面默认完整显示板图，右栏身份及诊断入口固定，仅配置内容滚动；窄屏和放大时进入详情后可返回板卡。上方工具栏提供正反面、放大、引脚列表和说明。未确认板型不会套用本板映射。

保护引脚的彩色焊盘带斜纹，板图下方统一显示电气类别和保护图例。仍可点击或用键盘选择，查看启动配置、Flash、系统灯或 USB 等具体保护原因；供电、接地、方案分配和普通资源占用不会因此显示保护纹理。正反面、放大图与两主题采用相同规则。

已确认本板及 GPIO13 数字能力时，首次进入默认展开板载 D5 控制；之后保留用户明确选择。也可点击 D5 或 GPIO13 进入，可开关、呼吸演示、只读查询和关闭资源；D4 系统灯只读。GPIO13 绿色焊盘内有 LED 矢量符号，入场轻微呼吸三次，尊重“减少动态效果”设置；它用于定位，不表示真实输出。默认展开不会申请控制或写入设备。沿用最近确认输出与固定反馈区，普通快照刷新不会让全局文字闪烁。进行中任务数量在操作记录弹窗内查看。侧栏及浏览器标签页使用用户指定 Figma Logo 页的原始标志路径，字体随应用提供。

每台设备一份共享接线方案，保存在服务器 `wiring.sqlite3`。多个页面可编辑方案，旧版本保存会提示冲突并保留本地修改，可载入服务器版本或导出本地副本。保存方案和刷新页面不会应用配置；资源关联仍需本次启动与实例匹配。接口见 [共享方案说明](docs/wiring-plan.md)，设计与验证见 [同步记录](docs/figma-ui-audit.md)。

2026-10-24 的紧凑板图、合并图例和右侧功能家族已从 Figma 同步到应用，旧设计保留在历史归档。可用能力按电平与采样、通信、波形与定时分组；I²C、SPI、RMT 等多模式功能就地展开，每次只展开一个家族。内容来自当前设备实际能力；不可用功能及一致快照集中在诊断中按需查看。

- **离线流程**：编辑执行图、资源声明、变量及十类步骤，校验后导出或上传 `.flow.json`，再加载和启动。暂停不清输出，流程完成仍可能占用资源；停止清理、移除加载项、删除文件是不同动作。默认手动启动。
- **联网通信**：板上 Wi-Fi、MQTT、ESP-NOW 与服务主机控制传输分开配置。凭据仅写入，不回显或写入操作记录；MQTT queued 和 ESP-NOW MAC ACK 都不是远端应用确认。
- **设备维护**：诊断、系统状态、低功耗、缓存、组操作、OTA 和明确确认的持久数据清理。OTA 上传到非活动槽，commit 默认不重启；上传成功不代表新固件已运行。需要重启时由用户显式执行，之后重新核对身份。

连续 ADC、RMT、I²S 等结果保留长度、格式、序号及丢弃信息，可下载原始字节。没有真实数据时不绘制示例测量，不把连续 ADC 当 PCM，也不声称自动识别外接器件。

## 多页面、停止与恢复

后端一次管理一台设备，多个页面共享观察。控制页在线时其他页面不能写入；原页离线后，其他页需显式接管并重新确认控制权。页面刷新、关闭或实时通道恢复不会自动重放命令、停止实验或断开设备。

“已提交”仅代表 SDK 本地入队，“设备已受理”代表设备创建作业；操作记录独立展示每项终态、驱动错误、未知结果及过期信息。取消请求完成不等于原作业已取消。超时、断线和 response_capacity 不自动重试写操作。

“停止所有实验”影响所有来源并持久抑制自启，走独立通道。只有设备清理和持久化确认后才显示完成；失败保留错误与占用。仅“断开设备连接”不停止板上实验。

任务保存在 SQLite，默认目录为 `$XDG_DATA_HOME/limivia-server`，未设置时使用 `~/.local/share/limivia-server`，保留最近 30 天、最多 10,000 条已结束记录。服务重启将未确认任务标记为未知，不自动连接或申请控制；已知 job 可在同设备同 boot 下显式查询，新 boot 的旧句柄不可复用。

```bash
poetry run limivia-server serve --data-dir ./data-bin/workbench --job-timeout 300
```

对应环境变量为 `LIMIVIA_HOST`、`LIMIVIA_PORT`、`LIMIVIA_DATA_DIR`、`LIMIVIA_JOB_TIMEOUT`。作业跟踪超时不是设备取消。设备管理使用单进程、单 worker；本机数据目录通过进程锁协调。当前没有远程账户系统，按本机工作台部署。

## 板卡与工程边界

板卡使用 3.3V 逻辑，外设共地。GPIO13 接板载 D5 LED；原生 USB、Flash 和保护脚以本次能力发现及设备预检为准。GPIO0/1/3/4 的数字与 ADC 互斥不等于永久禁用数字用途。

“引脚与占用”保留 32 个实物排针、正反面和键盘放大查看；点击板图只观察，不发送设备命令。供电脚不能作为 GPIO 电压容限依据。

SDK、ESP-IDF 固件及烧录工具各自独立维护。服务运行不依赖其检出位置。本轮没有修改、构建、烧录固件，也没有执行 OTA 激活。当前集成协议及冻结来源见 [协议](docs/protocol.md)，SDK 桥接和接口见 [后端模型](docs/backend-control.md)，旧客户端迁移见 [迁移说明](docs/migration-v3.md)。

## 验证

```bash
poetry run pytest
poetry run ruff check src/limivia_server tests
pnpm --dir src/web run lint
pnpm --dir src/web test
pnpm --dir src/web run build
pnpm --dir src/web exec playwright install chromium
pnpm --dir src/web run test:e2e
```

E2E 在 `127.0.0.1:18000` 启动隔离测试服务，真实 server 和 SDK 连接 tests 中的模拟设备，结束后关闭服务并删除临时任务数据库。测试专用接口不会出现在正常应用中。实机、无线互通及仪器测量不由模拟结果替代，证据范围见 [验证记录](docs/verification.md)。

2026-10-24 已补充无头 Chromium → 正式后端 → SDK → USB 实机验证，当前 bus 镜像通过连接、LED/PWM、文件读回、短流程及全局停止闭环。实测发现并修复了扫描与连接使用不同 SDK 实例、丢失扫描候选缓存的问题；BLE 本轮不测试。

源码目录：`src/limivia_server` 为 FastAPI、设备管理、任务与 Typer CLI；`src/web` 为 React/TypeScript/Vite 前端；`.agents/skills` 为本工程板卡资料。开源协议为 [AGPL-3.0-only](LICENSE)。
