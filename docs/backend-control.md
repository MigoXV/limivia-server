# 后端设备控制通道

浏览器 → 同源 WebSocket → Python 后端 → AsyncLimivia SDK → BLE GATT / USB Serial/JTAG → 开发板。默认 BLE；设备与系统权限属于后端所在电脑。设备协议仍为 [v1](protocol.md)，SDK 保持命令顺序，不自动重试设备命令。固件线协议与网页外层消息格式不变。

## 搜索

`GET /api/device/discover?kind=ble`，`kind` 可取 `ble` / `usb`，省略时为 `ble`。返回：

```json
{"kind":"ble","devices":[{"id":"系统设备地址","name":"LIMIVIA-xxxx"}]}
```

空列表表示未发现匹配候选；503 表示系统适配器、权限或扫描错误；409 表示已有连接或扫描进行中。BLE 按服务 UUID 过滤，USB 按 VID=0x303a / PID=0x1001 过滤，最终仍需协议握手确认板型。后端只允许连接最近搜索结果中的候选。

## 连接与数据

`WS /api/device/connect?kind=ble&target=<搜索得到的 id>`，target 需 URL 编码。HTTPS 页面使用 WSS。服务检查 Origin 与当前 Host、协议同源，拒绝其他站点发起的控制连接。当前工作台只面向本机使用，没有用户鉴权。

服务端通过 SDK 打开串口或连接 GATT、订阅通知，并完成内部 hello 握手及板型/版本校验后发送：

```json
{"type":"connected"}
```

此时 SDK 会话已就绪。网页继续发送自己的 v1 `hello` 并读取状态，之后启用控制；内部握手结果不会作为网页的请求响应转发。

网页每条 WebSocket 文本消息携带一个完整 v1 JSON 请求及 LF，最大 1025 bytes（包含 LF）。后端使用 SDK 校验命令并取得内部请求 ID，在下一次事件循环调度前登记内部 ID 与浏览器 ID 的映射。SDK 串行写入硬件，BLE 每段最多 20 bytes，等待 write-with-response。SDK 流式重组设备数据并生成类型化事件，server 将事件序列化回 v1 协议行：

```json
{"type":"data","data":"设备返回的协议片段"}
```

当前适配层发送完整协议行；网页仍按 LF 重组，继续兼容半行或多行消息。固件拒绝映射为原有 v1 失败应答，保留浏览器请求 ID 和固件错误码；无效参数与未知操作在写入前返回失败应答。SDK 内部响应超时、协议错误、适配器、连接占用、断线或写入错误使用：

```json
{"type":"error","message":"可恢复的中文错误提示"}
```

随后关闭通道。网页拒绝在途与排队请求并标记旧数据失效。命令响应超时不意味着未执行，不能自动重发写操作；应重新连接并查询状态。

## 生命周期与并发

每个后端进程仅允许一个控制会话，运行单进程与单 Uvicorn worker。后来的页面收到占用错误，不接管已有会话。连接期间禁止扫描；关闭页面、WebSocket 断开、连接失败或设备掉线时取消收发任务并释放串口/GATT，之后可重新搜索或连接。关闭控制连接不会停止持续供电设备上的定时、PWM 与采集任务。

后端 API 和适配器测试覆盖控制通道与资源释放；浏览器测试通过测试专用模拟后端覆盖页面流程。两者均不能代替真实串口和蓝牙实机验证。

## SDK 事件适配

命令完成事件为 `<op>.completed`，固件拒绝为 `command.failed`，主动通知为 `state.changed` 与 `adc.sample`。SDK 负责一个在途命令、六秒命令超时和取消清理；server 只维护浏览器请求 ID 映射与消息格式。连接总超时二十秒，包含内部握手。

SDK 的内部事件字段不直接发送给固件或网页。退出 WebSocket 时，连接上下文等待硬件释放后清除占用标志；FastAPI lifespan 负责关闭 SDK 客户端。
