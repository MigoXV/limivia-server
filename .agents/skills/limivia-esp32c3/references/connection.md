# 设备连接与恢复

本资料仅覆盖 LIMIVIA 工作台的设备接入。固件构建、烧录、驱动调试及实机验证工具由独立的 `limivia-esp32` 仓库维护，本仓库不依赖该目录存在。

## 浏览器能力

- Web Serial 用于 USB；Web Bluetooth 用于 BLE GATT。需要安全上下文和用户操作触发设备选择；本机使用 `http://localhost:8000` 或 `http://127.0.0.1:8000`。
- HTTP 局域网 IP 不等同于 localhost。手机要访问本工作台需另行提供可访问且受信任的 HTTPS；首版不配置远程部署。
- Chromium 的 Linux Web Bluetooth 支持可能需要实验特性，而且依赖实际可工作的系统 Bluetooth/BlueZ 控制器。
- 浏览器不存在对应 API 时显示不可用，不伪造连接、不自动改用后端通道。
- BLE 服务名 `LIMIVIA-xxxx`，具体服务与特征 UUID 以工程协议文档为准。

## USB 排查

- 本板没有 USB-UART 桥，使用 ESP32-C3 原生 USB Serial/JTAG。先确认数据线、供电、浏览器能力和串口权限；串口被监视器占用时先关闭监视器。
- Linux 常见端口为 `/dev/ttyACM*`，优先通过 `/dev/serial/by-id/` 识别；编号及 VID:PID 不能单独证明板型。
- 正常复位仍无法连接时，按住 BOOT，再按下并松开 RST，最后松开 BOOT，重新枚举端口。下载模式不提供工作台协议；烧录恢复须切换到固件仓库执行。
- GPIO18/19 必须保留给 USB，不建议用 eFuse 写入恢复连接。
- 连接成功后读取 `hello` 和 `state`；仅断开连接不会停止输出，恢复时不把页面旧值写回板卡。

来源与核验日期沿用迁移前资料：2026-10-21。[Chrome Web Serial](https://developer.chrome.com/docs/capabilities/serial)、[Chrome Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth)、[乐鑫串口连接](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32c3/get-started/establish-serial-connection.html)。
