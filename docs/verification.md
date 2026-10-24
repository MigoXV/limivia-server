# 工作台验证记录

## 2026-10-24：无头浏览器 USB 实机验证

分支：`test/headless-browser-real-device`。按用户要求只测有线，不扫描或连接蓝牙。使用正式应用入口、隔离的数据目录和 `127.0.0.1:18001`，无测试 Backend、接口拦截或模拟设备；浏览器为 headless Chromium，视口 1440×1000。

首次实际点击连接时发现扫描成功、连接立即失败。只读 SDK 诊断给出“设备不在最近搜索结果中”：服务为扫描和连接分别创建了 SDK，默认 Backend 中的扫描候选缓存被丢弃；原模拟 Backend 未要求此缓存，因此未暴露。现改为服务 lifespan 持有一个 AsyncLimivia，扫描与连接复用该实例，单次设备连接仍有独立上下文与代次。新增回归测试要求扫描缓存存在，并验证两次扫描/连接只创建一个 SDK。

### 实际身份

|字段|本次观察|
|---|---|
|USB|`/dev/ttyACM0`，扫描后明确选择；by-id 解析匹配|
|device_id|`e4:b0:63:ca:b4:78`，连接时填写预期 MAC 核对|
|board / profile|`luatos-esp32c3-usb` / `bus`|
|firmware / protocol|`0.3.0-dev` / `3`|
|jsonrpc / contract|`2.0` / `limivia-v3-jsonrpc2`|
|boot_id|`b5dffcbbb14a40df`|
|完整 ELF build_id|`e4949bbcbcca673b3b1729e6cbb61dc3a1f67a54c373e55a8c21d1d43e7b1de4`|

上述路径、身份和句柄仅为本次观察，不作为未来测试的默认目标。SDK 仍为下节记录的本地 0.3.0a1 wheel，未修改或重新构建 SDK/固件。

### 浏览器实际结果

最终运行的 11 项检查全部通过，共 56 条本轮服务任务，无 failed/unknown；页面异常、控制台错误和 HTTP 失败均为 0。主要动作由页面按钮触发，HTTP 查询用于核对任务终态及清理结果。

|场景|实际结果|
|---|---|
|首页与实时通道|正式构建的静态资源、页面会话和 WebSocket 正常|
|USB 扫描与连接|明确选择目标；握手、28 页能力发现及 6 页一致快照完成，初始仅观察|
|刷新与能力重读|浏览器刷新保持相同连接代次/boot，不隐式申请控制；显式重读成功|
|控制与多页面|用户按钮申请控制；第二页仅观察，不能接管在线控制页|
|板载 LED|GPIO13 资源创建，点亮/熄灭均有固件确认和独立状态读回，随后关闭并确认释放|
|PWM 呼吸|GPIO13 PWM 周期呼吸运行状态确认，关闭后资源为空|
|文件|唯一临时文件上传、SHA256 提交、列表、下载；UTF-8 内容逐字节比对一致|
|离线流程|无引脚资源、autostart=false，仅等待 500ms→结束；上传、加载、显式启动、查询 completed、停止及移除分别确认|
|文件/流程清理|删除本轮文件及流程定义，确认测试加载项已移除|
|全局停止|原始停止作业完成，`cleanup_faults=0`、`persist_error=0`、`autostart_inhibited=true`；恢复测试前的自启抑制状态并撤销控制|
|页面与收尾|六个工作页及操作记录可打开，无脚本异常；资源为空、控制释放、USB 断开|

原始报告、脚本、日志和截图保存在本机 Git 忽略目录 `artifacts/headless-real-v3/`：`report.json` 为最终运行，`before-fix/` 保留修复前失败证据，`core-report.json` 保留基础闭环结果。`all-operation-history.json` 和 SQLite 另保留多次运行历史；最终报告的任务统计仅包含本次运行开始后创建的任务。已查看 `led-on.png`、`flow-completed.png` 等实际截图。

修复后的软件回归：`poetry run pytest -q` **127 项通过**；Ruff、前端 lint、9 项前端单测、生产构建及 40 项 Playwright 均通过。测试结束后关闭临时后端并确认串口不再占用。

本次是单板 USB 与固件状态确认，没有物理电压、光学亮度或 PWM 波形测量；没有测试蓝牙、无线互通、外接器件、OTA 激活，也没有烧录设备。

## 2026-10-24：JSON-RPC v3 前后端完整适配（首次软件验证）

分支：`feature/jsonrpc-v3-workbench`。本节记录首次交付的软件验证，后续 USB 实机及修复结果见上节；下方 v2/v1、实机及旧依赖记录仅属于历史版本。

### 基线与环境

- Python 3.12 项目内 `.venv`，服务依赖由 Poetry/清华源管理，前端使用 pnpm。按用户决定，从 TOML/锁文件移除 limivia，再通过本环境 pip 安装独立构建的 SDK wheel。
- 实际 SDK 为 `limivia 0.3.0a1`，源码 `dev` 提交 `5149d0ecb72c665730573568fadcea110b94b8da`；wheel SHA256：`94a6978483144d5897896077a14dae6f62e25e3626728617f3ebf67caf2f9279`。`doctor` 核对导入位置为本仓库 `.venv/lib/python3.12/site-packages/limivia`，公开身份模型契约为 `limivia-v3-jsonrpc2`，pip 安装来源包含该 wheel 与哈希。
- 冻结协议来源、固件检出和 SDK 实机修正保存在 [protocol.md](protocol.md)。本轮未修改 SDK 或固件仓库，服务不读取相邻检出。

### 自动检查结果

|命令|结果|
|---|---|
|`poetry run pytest -q`|126 项通过|
|`poetry run ruff check src/limivia_server tests`|通过|
|`pnpm --dir src/web run lint`|通过|
|`pnpm --dir src/web test`|9 项通过|
|`pnpm --dir src/web run build`|TypeScript 与生产构建通过|
|`pnpm --dir src/web run test:e2e`|40 项通过|
|`poetry check --lock`|通过|
|`poetry run python -m pip check`|通过|
|`poetry run limivia-server doctor`|通过，不访问硬件|

后端测试覆盖真实 SDK 的 JSON-RPC 解析、异步任务和事件桥接，包括观察连接、控制页接管、停止优先通道、控制请求竞争、旧代次拒绝、快速事件、乱序批量、二进制编码、原作业取消、未知结果与过期区分、一致分页及 revision=0、通知缺口、SDK 事件缓冲溢出、父子资源/fault/recover、周期 ADC 共享消费、上传/中止/下载/秘密文件、OTA 默认不重启、流程校验及运行清理、SQLite 保留上限与服务重启。上传读取主机文件后切换设备、发现未完成时快速重连也有回归覆盖。

USB/BLE/WS/MQTT 的服务参数与 SDK 门面使用测试 Backend；WS/MQTT 包括证书选项、MQTT 3.1.1/5.0 和凭据过滤。这些测试不连接真实网络端点。67 个面向业务的公开操作另有参数化网关分派测试，证明稳定任务关联与 SDK 调用路径；基础握手、心跳、订阅、能力及状态由连接管理器使用，停止单独验证。逐项入口及证据见 [76 操作 / 18 资源清单](capability-coverage.md)。

浏览器测试在 `127.0.0.1:18000` 启动隔离 FastAPI 服务，通过本次安装的真实 SDK 访问 tests 中的模拟传输；不是在浏览器拦截业务接口伪造成功。测试专用配置接口仅存在于测试入口。结束后测试后端和临时数据库自动清理。

40 项 E2E 包括 10 项业务闭环、18 类资源表单、双主题×四档宽度的 8 项布局检查、双主题工作页表单的 2 项可访问性检查、键盘跳转/200% 放大及物理板图各 1 项。布局检查覆盖 320、768、1280、1440px，工作台执行 axe WCAG A/AA 检查并检查流程页无全页溢出；另对外设、流程、文件、联网、维护页执行双主题 axe 检查。32 个实物引脚、正反面和 Escape 焦点返回保持可用。

依据 Figma 高保真上下文核对工作台、外设目录/PWM、离线流程和联网页面；保留 MANAS 关系及白垣/苍渊 Token。截图位于本机 Git 忽略目录 `artifacts/playwright/`，已检查工作台、流程、窄屏与 200% 放大截图。流程图来自定义数据，ADC 未取得采样时不展示示例测量曲线。

### 证据范围

- 能力夹具的引脚、配置及部分动作页取自 SDK 冻结捕获；缺失动作页与系统操作列表由测试模拟补齐。模拟驱动结果只验证服务软件闭环，不代表 18 类外设均通过硬件验收。
- 本轮没有连接真实开发板、访问实际 broker/外部通信节点、烧录、执行 OTA 激活或做仪器测量。
- 真实 USB/BLE、板上 WS/MQTT/TLS、ESP-NOW 第二节点、外部总线器件、音频/RMT 输入、物理时序/精度/功耗与 OTA 激活仍需独立条件验收。历史 SDK/固件或下方 v2/v1 的硬件记录不替代这些检查。

## 历史：协议 v2 / SDK 0.2.0a1 验证（2026-10-23）

- SDK 已从官方 PyPI 用 pip 安装进本项目 Python 3.12 .venv；安装版本 0.2.0a1。PyPI wheel SHA256：3e857439d105ad09b0bd9edf9f6eb0c00338be46e54fe5e45c79a8d703f3bba5，与 SDK 发布构建一致。
- 清华源尚未同步该版本，最初 Poetry lock 明确报不存在；随后仅为 limivia 指定官方 PyPI explicit 源并重新生成锁文件。Poetry 其余依赖继续使用清华源；pip check、Poetry lock 检查通过。
- 后端 pytest 23 项通过，Ruff 通过；前端 Vitest 10 项通过、ESLint 与构建通过；Playwright 30 项通过。浏览器测试覆盖控制者/观察者、停止优先通道、停止后重新 acquire、fault 与 partial_cleanup、输入 GPIO 不带 level、任务 instance，以及原有设备流程、320/768/1280 窄屏、键盘、Axe 与 200% 缩放。
- USB 完整实机链路：Chromium → 同源 WebSocket → 本后端 → 从 PyPI 安装的 SDK → ESP32-C3。指定 /dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_E4:B0:63:CA:B4:78-if00（解析为 /dev/ttyACM0），hello 身份 e4:b0:63:ca:b4:78，固件 0.2.0，boot_id 41e3de6b6a120e06。
- 浏览器成功扫描、连接、读取能力并取得控制权；GPIO13 点亮得到固件确认；全部停止后变为观察者且禁止输出；重新 acquire 后读取诊断成功。最后额外 stop + state 确认所有实验引脚 idle，关闭浏览器、释放串口并结束临时后端进程。
- 实机原始帧与截图：忽略目录 artifacts/server-usb-v2/transcript.json、led-confirmed.png、diagnostics.png。截图已检查。记录中 passed=true、cleaned=true；控制结果是固件确认，没有物理电压/波形测量。
- BLE v2 实机未验证：本机当前 BlueZ 没有可用控制器。Playwright 的 BLE 流程为模拟设备，不能替代实机；下方历史协议 v1 BLE 结果不作为当前 v2 的验收。

---

# 工作台验证记录

## 2026-10-22：LED 白垣设计更新

- 同步 [新设计的 LED 已熄灭页](https://www.figma.com/design/AzGxH7vvqqpSfxBXUBRYbf/limivia?node-id=33-2888)，使用 Figma 高保真上下文和原尺寸截图核对。主任务区铺满可用宽度，控制与设备确认并列，状态区为 384×168px；模式说明与引脚资源按相同列对齐。标题、模式、按钮、反馈、状态字号和导航文案与设计同步。
- 六个导航 SVG 重新下载后与现有资源逐字节一致，继续本地导入；检查 16×16px 固有尺寸与浏览器实际渲染尺寸，覆盖底部“板卡与引脚”图标。
- 22 项 pytest、后端 Ruff、前端 lint、8 项 Vitest、生产构建及独立后端下的 26 项 Playwright 全部通过。等待确认和确认点亮时，动作按钮、状态区与说明区的外框均保持不变。
- 人工对照 1440×900 设计截图与应用已熄灭状态，检查 320px 已连接布局；浏览器用例覆盖 320、768、1280px、键盘、200% 缩放、axe 无障碍和模拟 USB/BLE 控制。截图保存在本机 `artifacts/figma-sync/`，原设计截图在其中的 `source/`；均为 Git 忽略产物。
- 保留未连接、待确认、失效、拒绝与重连语义。本次未执行真实 USB/BLE 连接、物理输出或测量，未修改协议及固件。

## 2026-10-22：端到端测试服务隔离

- 默认测试曾复用 `8000` 端口的旧版服务，首页返回 404，导致页面断言失败；旧服务 `/api/info` 仍报告 `web-serial` / `web-bluetooth`。
- Playwright 改为在 `18000` 端口启动本次检出的后端，并禁止复用已有服务。26 项 E2E 通过；测试结束后自动关闭测试后端。

## 2026-10-22：Poetry 管理已发布 SDK

- 清华源已有 `limivia 0.1.0`；将其声明为项目依赖并绑定 `tuna` 源，锁定 SDK、Bleak、pySerial 及平台依赖。安装不再要求本地 SDK 仓库或手动安装 WHL。
- `poetry check --lock`、`poetry install`、22 项 pytest 与后端 Ruff 检查通过。
- SDK 对应真实硬件的 USB/BLE 连接未在本次验证中执行。

## 2026-10-22：Figma 工作台同步

- 同步 [Figma 主设计页](https://www.figma.com/design/9WbAWG0bfGyDgJPDugJMTh/?node-id=33-2887) 的五类实验、连接、引脚资源、帮助与命令日志。复用白垣 Token，本地保存导航 SVG 与板卡功能示意；既有 32 物理引脚映射未改动。
- `poetry run pytest`：22 项通过；`poetry run ruff check src/limivia_server tests` 通过。
- 前端 lint、8 项 Vitest、生产构建与 26 项 Playwright E2E 通过；最终在减少动态效果模式下复跑 4 项界面同步用例通过，重拍三种尺寸截图。
- 覆盖 USB/BLE 模拟握手、输出确认、重复提交保护、应答丢失与手动状态恢复、固件拒绝与未知结果区分、GPIO 输入/输出双向草稿切换与延迟确认、PWM 草稿与已确认值、占用冲突、ADC 引脚隔离/CSV/重连清空、停止确认及断线任务状态。GPIO 草稿不提前改变设备读数语义；无效 ADC 间隔草稿不会阻断停止采样。
- 320、768、1280px 检查五类实验及弹窗布局、全页溢出和 axe WCAG A/AA；保留键盘操作、200% 缩放、实物接线图逐层关闭与焦点恢复检查。导航图标为本地 16×16 SVG，板卡功能示意为 250×313，测试同时检查资源加载和实际尺寸。
- 独立完工复核发现的 GPIO 草稿与已确认读数语义问题已修复，并由回归测试覆盖；复核结论为可交付。
- 对照截图位于本机 `artifacts/figma-reference/`，应用截图位于 `artifacts/figma-sync/`，均为 Git 忽略产物。截图中的设备数据由测试模拟，生产构建不包含模拟设备。
- 本次未执行真实 USB/BLE 实机验证，未修改协议、SDK、硬件映射或固件，未烧录开发板。

## 2026-10-22：Server / SDK 拆分

现有仓库改名为 limivia-server，Python 包改为 limivia_server；新建独立 limivia SDK，拆分时 server 使用 editable path dependency 接入。两项目均使用独立 Python 3.12.3 .venv，旧项目 Python 3.10 缓存环境已移除。以下为拆分当时的验证结果；随后开发依赖改为手动安装 SDK WHL，当前安装步骤见 [README](../README.md#安装与启动)。

- SDK：59 项 Python 测试、Ruff、mypy 类型检查、CLI 和示例帮助验证通过。
- Server：22 项 Python 测试、Ruff、doctor 验证通过。
- 前端：lint、8 项单元测试、生产构建、15 项 Playwright E2E 全部通过。
- 两项目：Poetry 锁文件检查、wheel 和 sdist 构建通过。SDK wheel 可独立导入，环境不包含 FastAPI；server wheel 使用正常版本依赖，不含本机路径。
- 协议 v1 和网页消息格式保持兼容。自动握手、请求 ID 映射、事件转发、命令失败、关闭／取消的资源释放已通过模拟传输测试。
- 本次未执行真实 USB/BLE 实机验证，未修改或烧录固件。详细覆盖见 [SDK 验证记录](../../limivia/docs/verification.md)。

以下保留历史验证结果；其中 Python 3.10 属于迁移前环境。

## 首版记录

日期：2026-10-21，来源：提交 `a6a88af`。

- Poetry Python 3.10.20；依赖安装、前端 pnpm 安装和生产构建通过。
- FastAPI 首页、静态资源、SPA 深层路由、API/OpenAPI、未知 API 的 JSON/HTML Accept 404 与缺少前端产物的错误提示通过。原后端测试 8 项中，1 项烧录目标校验现已迁至固件仓库，其余 7 项保留。
- 前端协议测试 6 项通过：拆包粘包、过长帧恢复、串行请求、错误返回、超时不自动重试、断开取消在途与排队请求。
- 浏览器 E2E 8 项通过：320/768/1280px 无全页溢出、取消设备选择、API 不支持、键盘 skip link、五个功能页的 axe WCAG A/AA 检查、200% 缩放；USB/BLE 适配器通过隔离模拟外设覆盖握手、LED、PWM、定时、ADC、断线失效显示。

固件构建、烧录、原生串口实机记录和验证工具已迁至 [limivia-esp32 验证记录](../../limivia-esp32/docs/verification.md)。真实浏览器 USB 与 BLE 尚未完成实机验收：当时无头 Chromium 没有枚举到目标串口，Linux BlueZ 未提供可用控制器。模拟适配器测试不代表实机连接成功。

## 仓库拆分验证

日期：2026-10-21。

- `poetry sync` 后实际确认主仓库环境不含 `serial` 模块；`limivia doctor` 和 7 项 pytest 均通过，Ruff 通过。
- 前端 lint、6 项 Vitest、生产构建和 8 项 Playwright 均通过。
- `src/esp32` 与 Python 固件工具已移除；10 个固件源文件和实机验证脚本在新仓库逐字节保持一致，协议正文一致。
- 两仓库专用 skill 均通过 `quick_validate.py`；README、AGENTS、协议和 skill 的本地 Markdown 链接检查通过。
- 固件仓库的 5 项 CLI 测试与新路径编译结果见其验证记录。本次迁移没有重新烧录设备。

## 本地产物

本机 `artifacts/`（Git 忽略）保留工作台截图；前端产物位于 `src/web/dist`。原生串口验证 JSON 和旧固件构建产物随固件迁移。本机路径、设备读数或截图不作为未来运行的固定状态。

## 后端接管 USB / BLE

日期：2026-10-21。分支：`feature/backend-device-control`。

- Python 3.10.20，通过 Poetry 安装 Bleak 3.0.2 与 pySerial 3.5；`poetry run pytest -q` 共 28 项通过，Ruff 通过。新增覆盖扫描候选过滤、默认 BLE、独占占用、同源检查、非法目标与帧拒绝、UTF-8 跨片段、USB 参数、BLE 20-byte 分片、掉线、连接失败、连接中关闭页面与资源释放。
- 前端 lint、6 项 Vitest 与生产构建通过；移除 Web Serial / Web Bluetooth 类型依赖。
- Playwright 11 项通过，覆盖 USB/BLE 后端通道、默认蓝牙、无浏览器硬件 API 时连接与重连、搜索失败与空结果、多个候选手选、切换通道清除候选、连接占用提示、320/768/1280px 布局与 axe 无障碍检查。
- 本机 USB 实际扫描为空列表，未验证真实 USB 设备连接；USB 适配器仅完成模拟读写与关闭验证。
- 本机 BLE 实际扫描发现 `LIMIVIA-B47A`，后端 Bleak 成功连接并订阅通知；`hello` 返回协议 1、板型 `luatos-esp32c3-usb`、固件 0.1.0，`state` 返回 11 个实验引脚及 `ble_connected=true`，随后释放连接。
- 额外启动临时后端 `127.0.0.1:18000`，用真实 Chromium 页面（无模拟后端）完成默认 BLE → 搜索 → 选择 → 后端 WebSocket 连接 → 握手 → 显示“设备已就绪” → 主动断开。截图 `artifacts/backend-ble-real-1280.png`，测试结束后已关闭临时后端。仅发送 `hello` / `state`，未切换 LED、PWM 或其他物理输出。
- 设备 v1 帧、操作与 UUID 保持不变，固件无需修改或重新烧录。协议文档仅更新宿主传输位置；本机未检出相邻 `limivia-esp32` 仓库，未同步该仓库的宿主说明文案快照。
- 补充取消时序回归：硬件释放阶段使用取消屏蔽，保证 ASGI 请求取消时仍能完成串口/GATT 清理与占用释放。断开、占用释放和请求取消用例连续 10 轮通过。
- 项目专用 skill 通过 `quick_validate.py`，README、工程约定、交互契约及连接排查说明已更新为后端控制。

## 实物接线图（2026-10-21）

- 依据厂家引脚图及无串口芯片 A12 原理图，设备视图完整展示左右各 16 个物理脚；元件正面默认天线上、USB 下，背面仅交换左右。
- 单元测试覆盖逐行丝印顺序、重复电源脚身份、RX0/TX0 GPIO 映射、ADC 类别与保护限制。
- Playwright 覆盖 320、768、1280px 的放大查看、正反面切换、键盘查看与 Escape 关闭、焦点恢复及无障碍检查。
- 通过模拟后端已收到的命令记录，先验证握手确实发生，再验证查看引脚不新增设备命令；同时检查五类实际渲染颜色。
- 截图：`artifacts/board-expanded-{320,768,1280}.png`。对照官方图核验排针顺序；元件轮廓为简化表达，不作为尺寸加工图。本次未执行实物接线或电气测量。
