# 板卡与芯片知识

资料核验日期：2026-10-21。对象为合宙 CORE ESP32-C3 简约版 / USB 直连版，而非 ESP32-C3 SuperMini、DevKitM 或带 CH343 的经典版。

## 事实与证据

| 项目 | 内容 | 依据 |
|---|---|---|
| 芯片 | 单核 32-bit RISC-V，最高 160MHz，支持 BLE；无 Bluetooth Classic | 乐鑫数据手册 |
| USB | 固定功能 USB Serial/JTAG，D− GPIO18，D+ GPIO19；并非可自由编程 USB OTG | 乐鑫 USB 文档 |
| 板载 LED | D4 → GPIO12，D5 → GPIO13，高电平有效 | 合宙板卡文档 |
| 按键 | BOOT 为 GPIO9，低电平参与下载模式；RST 为复位 | 合宙板卡文档 |
| Flash | 外置 Flash 板需 DIO，GPIO14–17 用于 Flash；内置 Flash 变体的 11/12/13 不可按本板使用 | 合宙板卡文档 |
| LEDC | 芯片具有 6 通道、4 定时器、最大 14-bit；不是合宙 LuatOS 文档里软件层的“4 PWM”硬件上限 | ESP-IDF 6.0.2 `soc/esp32c3/include/soc/soc_caps.h` |
| ADC | ADC1 GPIO0–4；本工程保护 GPIO2，只开放 0/1/3/4；ADC2 存在芯片限制，不启用 | 乐鑫 ADC 文档与固件策略 |

首次实机识别：ESP32-C3 QFN32 revision v0.4，40MHz 晶振，Flash manufacturer c8 / device 4016，容量 4MB，USB VID:PID 303a:1001，MAC e4:b0:63:ca:b4:78。上述是本次观察，不是其他板卡的默认身份。VID:PID 只能识别 Espressif 接口，不能单独证明板型。

## 当前固件引脚政策

- 可实验：GPIO0、1、3、4、5、6、7、10、13、20、21。
- GPIO12：系统连接状态 LED，USB 最近 5 秒有请求或 BLE 已连接时亮。
- GPIO13：D5 实验 LED，可用于 GPIO、PWM、定时；必须遵守互斥占用。
- GPIO2、8、9：启动绑带相关，首版不开放实验控制。
- GPIO11：Flash 电压相关；不烧写 `VDD_SPI_AS_GPIO` eFuse。
- GPIO14–17：Flash；GPIO18/19：USB；均禁止实验操作。

模式 `idle/input/output/pwm/adc/timer` 表示固件资源占用；同一脚仅一种用途。GPIO输入和输出可直接互换，其余用途通过 `pin.release` 先释放。

## 电气与时序边界

- GPIO 使用 3.3V 逻辑。5V 供电脚不是 5V 容忍 GPIO。外设需共地；电机、继电器等负载通过驱动电路连接。
- 本 UI 推荐 ADC 输入 0–2.5V。不要将 3.3V 供电直接作为 ADC 满量程测试源。
- ADC 原始范围 0–4095；校准成功才输出 mV，否则返回 null。浮空读数不能证明传感器或电压精度。
- 首版 PWM 开放 4 路独立定时器，5–40000Hz，自动选可行位宽，频率与分辨率不能任意组合。
- 最多 4 个本地定时任务，每个阶段至少 10ms。不将固件状态确认视为物理波形精度测量。
- 慢消费者可能丢失实时通知，状态查询是恢复真源。

## 官方来源

- [合宙 CORE ESP32-C3 开发板说明](https://wiki-zh.luatos.org/chips/esp32c3/board.html)
- [合宙硬件资料及无串口芯片版原理图入口](https://wiki-zh.luatos.org/chips/esp32c3/hardware.html)
- [ESP32-C3 数据手册](https://documentation.espressif.com/esp32-c3_datasheet_en.html)
- [USB Serial/JTAG 控制台](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32c3/api-guides/usb-serial-jtag-console.html)
- [ADC oneshot 驱动](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32c3/api-reference/peripherals/adc/adc_oneshot.html)
- [LEDC 驱动](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32c3/api-reference/peripherals/ledc.html)

合宙文档混合描述了经典版、简约版和 LuatOS 限制。冲突时先辨认板型，再对照原理图、芯片手册、所用 IDF 版本与实机，不从第三方同名板教程推断接线。

底层驱动、时钟、队列和构建策略维护在独立 `limivia-esp32` 仓库的专用 skill；本资料保留工作台接入所需的板型、能力和电气边界。


## 实物排针与设备视图

合宙简约版有左右各 16 个引脚，共 32 个。下面按**元件正面朝向观察者、天线上、USB 下**逐行排列；背面交换左右，不倒转上下。左列 L1–L16、右列 R1–R16 是前端物理位置 ID，不冒充原理图连接器编号。

| 行 | 左侧 | 右侧 |
|---|---|---|
| 1 | GND | GND |
| 2 | IO00 | 3.3V |
| 3 | IO01 | IO02 |
| 4 | IO12 | IO03 |
| 5 | IO18 | IO10 |
| 6 | IO19 | IO06 |
| 7 | GND | IO07 |
| 8 | RX0 / GPIO20 | IO11 |
| 9 | TX0 / GPIO21 | GND |
| 10 | IO13 | 3.3V |
| 11 | NC | IO05 |
| 12 | EN / RESET | IO04 |
| 13 | 3.3V | IO08 |
| 14 | GND | IO09 / BOOT |
| 15 | PWB | 5V |
| 16 | 5V | GND |

正面 USB 左侧 D5 / GPIO13，右侧 D4 / GPIO12；RST 左、BOOT 右。
核对依据：[厂家实拍及引脚图](https://wiki-zh.luatos.org/_images/20221023.png)与[无串口芯片 A12 原理图](https://cdn.openluat-luatcommunity.openluat.com/attachment/20220609213416069_CORE-ESP32-A12.pdf)。厂家的实拍图含经典版元件，不能据此给简约版添加 CH343；排针定义与 A12 核对。

物理引脚数据维护在 `src/web/src/board.ts`，不可用固件可实验引脚列表替代。重复电源脚各有独立物理位置。按用户接线需求，板图专用 Token 为 5V 红、GND 黑、3.3V 黄、GPIO0–5 蓝、其余 GPIO 绿，特殊脚中性灰。颜色只表达芯片能力，保护状态单独标识：GPIO2 受保护；GPIO5 为 ADC2，固件未开放模拟采集但可数字操作。ESP32-C3 无 DAC，PWM 不标作 DAC 模拟输出。图形检查只读，不触发设备操作。
