# 工作台验证记录

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
