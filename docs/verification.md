# 工作台验证记录

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
