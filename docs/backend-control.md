# 后端设备与任务模型（JSON-RPC v3）

浏览器通过同源 HTTP 提交业务操作，通过 `/api/device/events` WebSocket 观察快照与增量。后端使用 limivia SDK 公开的 `AsyncLimivia`、`AsyncConnection` 和类型化事件，不转发设备线协议，不复制传输、seq、心跳或设备作业轮询。

## 连接与控制归属

服务生命周期管理一个设备连接，单进程、单 worker。Linux 对数据目录持有进程锁，避免同目录多个管理进程竞争。USB/BLE 扫描和连接互斥；WS/MQTT 显式提供 URL，MQTT 必填目标 MAC；证书路径属于服务主机。

同一个 AsyncLimivia 从服务启动持续到关闭。扫描和后续连接必须复用此实例，保留 SDK 默认 Backend 的最近扫描候选缓存；不能在扫描请求退出后销毁客户端，再用新的客户端连接刚选择的 USB/BLE 目标。每次连接仍建立新的连接上下文及代次，断开不销毁整个 SDK。

`POST /api/pages` 签发页面会话，前端保存在 sessionStorage；HTTP 使用 `X-Page-Session`，WebSocket 首条消息携带 `page_session`。连接管理器与页面生命周期分离，浏览器关闭、刷新和实时通道重连不会断开设备或重放动作。

页面初始为观察者。`control.acquire` 明确申请写权限；其他页面可观察，原控制页离线后通过 `takeover=true` 显式释放旧绑定并重新申请控制。在线控制页不能被其他页面接管。设备 token 不下发；页面会话仅用于本机页面协调，不是远程账户认证。

控制代次隔离停止前的旧完成。`outputs.stop` 有独立入口，绕过普通任务队列满的限制；立即撤销本服务控制归属，只有 SDK 原始停止 job 的清理、持久化与自启抑制确认后才显示完成。

## 操作关联与事件消费

每连接唯一 `async for event in connection` 消费者。公开 request ID 与连接代次组合映射至稳定的服务 operation ID；同时记录 device_id、boot_id、已知 job_id。提交前创建记录，快速事件通过最多 256 个请求的有界暂存重放，不丢弃其他请求事件。

- submitted：SDK 本地入队；accepted：设备作业已受理。
- completed/failed/cancelled：按直接 RPC 或原始 job 终态更新。
- unknown：超时、断线或可能存在外部副作用，不能自动重发。
- result_expired 单独保留，同时保存 SDK 提供的 job 状态；当前 SDK 以 `command.failed(reason=result_expired)` 交付这一情形。
- job_expired 表示历史句柄淘汰，与结果内容过期分开。

显式 job.get 是查询，不创建设备作业跟踪器；可核对同设备、同 boot 的历史未知任务。结果已过期仍保留 unknown；停止作业即使报告 completed，也必须满足清理、持久化和自启抑制条件。job.cancel 完成仅说明取消请求处理完成。job.finished/data.available 都不是业务完成或实际样本。

普通在途操作最多 64 个；每订阅者缓冲 128 条。慢订阅者溢出时改发完整重同步快照，不阻塞 SDK 消费者。SQLite 保存脱敏任务状态，默认保留 30 天、最多 10,000 条已结束任务，不淘汰未结束记录。进程重启将未确认任务标为 unknown，不自动重连。

## 状态、数据与恢复

使用 discover 聚合能力、state.snapshot 聚合一致分页；revision=0 参与一致性检查。身份、boot/build/profile/contract 变化后重新发现，旧任务仍作为历史展示，旧句柄不能跨 boot 使用。

资源 definition 是创建配置，不冒充实时状态。resource.call 的确认结果进入独立观测缓存。关闭失败后只读刷新快照，fault 保持占用；recover 重试关闭，不重新打开。

周期 ADC 由显式采样入口启动唯一的后端资源读取任务，每 500ms 最多一次；多个页面共享最多 120 条原始事件。控制失效或一次读取失败即停止消费；不会因通知自动启动读取。连续 ADC/RMT/I²S 保留各自二进制格式，不伪造单位或测量结论。

上传使用服务后台任务串行执行 begin→384 字节 chunk→commit。父任务单独显示字节与校验阶段，子操作保持完整关联；失败只清理本任务已知且仍有权限的上传。未知结果不重发。OTA commit 固定默认 reboot=false。下载分块读取，秘密文件由设备拒绝读回。

## 主要接口

|接口|行为|
|---|---|
|GET /api/device/discover?kind=ble或usb|扫描服务主机候选|
|POST /api/device/connect、/disconnect|显式连接或断开|
|GET /api/device|身份、发现、快照、观测值、采样与控制归属|
|POST /api/device/refresh|刷新完整能力和一致状态，不申请控制|
|POST /api/device/operations|`{op,args,takeover?,generation?,boot_id?}`；202 返回服务任务|
|POST /api/device/batches|操作数组；每项独立任务，不保证事务/顺序|
|POST /api/device/stop|独立全局停止|
|GET /api/operations、/{id}|任务分页与详情|
|POST /api/operations/{id}/abort|请求中止本代未进入 commit 的上传|
|WS /api/device/events|首帧完整快照，后续任务/通知/快照带服务 cursor|
|POST /api/device/resources/{id}/sampling?enabled=true或false|显式协调周期 ADC 队列消费|
|POST /api/device/files/upload、/ota/upload|multipart 文件；后端编排进度|
|GET /api/device/files/{name}/download|分块读取非秘密文件|
|POST /api/device/flows/validate|结构化流程本地校验；设备最终裁定|

前端提交携带当前 generation/boot_id；服务拒绝连接切换后的旧草稿。多步动作冻结同一作用域，上传在读取主机文件后再次检查连接与控制归属。直接脚本省略作用域时表示明确针对当前服务连接。

单项和批量动作参数中的 `data`/`will` 可使用 `{encoding:"text"或"hex"或"base64",value:"..."}`；服务显式转换成 bytes 再交给 SDK。普通 JSON 对象不作为二进制解释。未知字段、长度、范围与完整请求大小最终由 SDK 和设备校验。

日志、实时消息和历史记录过滤 session/control、密码、密钥、证书私钥路径及已知凭据文本。任务不保存原始提交参数。全部模拟设备、测试控制接口和历史能力向量只存在 tests 目录，不进入应用包。
