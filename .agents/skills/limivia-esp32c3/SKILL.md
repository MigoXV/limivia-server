---
name: limivia-esp32c3
description: 在 LIMIVIA 工作台中接入合宙 CORE ESP32-C3 简约版（无串口芯片），处理 Web Serial/Web Bluetooth、板型识别、引脚能力与连接恢复。固件源码和开发工具由独立 limivia-esp32 仓库维护；不把本板映射套用到其他 ESP32-C3 开发板。
---

# LIMIVIA ESP32-C3 接入

本技能仅服务含 `src/limivia` 与 `src/web` 的 LIMIVIA 工作台仓库，不安装到全局。固件已独立至 `limivia-esp32`（本机为相邻目录），工作台不依赖其检出位置。

## 按任务读取

- 识别板型、接线或调整前端引脚能力：读 [板卡与芯片](references/board-and-chip.md)。区分芯片能力、板上接线和固件开放范围。
- USB/BLE 连接失败、浏览器不支持或复位恢复：读 [连接与恢复](references/connection.md)。串口编号与 MAC 是实机观察，不是固定配置。
- 修改命令或传输适配器：读本仓库协议真源 [protocol.md](../../../docs/protocol.md)，协同更新固件仓库中的协议快照、实现和测试。
- 编译、烧录或修改底层驱动：转到固件仓库，读取其 AGENTS.md 和 `limivia-esp32-firmware` skill；不在主仓库重建 ESP-IDF 工程。

## 工程边界

- 浏览器通过 Web Serial / Web Bluetooth 直接连接板卡，Python 后端不代理命令，不枚举串口。
- 本板无 USB-UART 桥，GPIO18/19 保留给原生 USB Serial/JTAG。仅确认过的外置 4MB Flash 板使用 D4/GPIO12 和 D5/GPIO13 高电平 LED 映射。
- 固件是引脚与资源校验的最终边界；保护 USB、Flash、绑带脚、GPIO11 和状态 LED，不写 eFuse。
- PWM 与本地任务在断线后继续，重启清空；重连查询状态，不回写浏览器旧值。握手必须检查协议版本。
- 命令成功、固件确认与物理测量分别报告；模拟 USB/BLE 测试不能作为浏览器实机验收。
