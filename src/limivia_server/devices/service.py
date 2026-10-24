from __future__ import annotations

import asyncio
import base64
import os
import secrets
import time
import uuid
from collections import OrderedDict, deque
from contextlib import AsyncExitStack
from pathlib import Path

from fastapi import HTTPException
from limivia import AsyncLimivia, Backend, InvalidCommandError
from limivia.types import MQTTOptions, WebSocketOptions

from .catalog import DESTRUCTIVE, INTERNAL, OBSERVE, OPERATIONS, catalog
from .store import TERMINAL, OperationStore

PRIVATE = {
    "session",
    "control",
    "password",
    "pmk",
    "key",
    "private_key",
    "private_key_file",
    "certificate_file",
    "ca_pem",
    "username",
}


def public(value):
    if isinstance(value, dict):
        return {key: public(item) for key, item in value.items() if key.lower() not in PRIVATE}
    if isinstance(value, list):
        return [public(item) for item in value]
    return value


class DeviceService:
    def __init__(self, backend: Backend | None, data_dir: Path, job_timeout: float = 300):
        self.backend = backend
        self.data_dir = data_dir
        self.job_timeout = job_timeout
        self.sdk_context = AsyncExitStack()
        self.sdk = None
        self.store: OperationStore | None = None
        self.connection = None
        self.runner = None
        self.tasks = OrderedDict()
        self.request_map = {}
        self.early = OrderedDict()
        self.waiters = {}
        self.subscribers = {}
        self.pages = {}
        self.credentials = deque(maxlen=64)
        self.cursor = 0
        self.generation = 0
        self.control_epoch = 0
        self.owner = None
        self.controlled = False
        self.state = {
            "status": "disconnected",
            "identity": None,
            "discovery": None,
            "snapshot": None,
            "stale": True,
            "error": None,
            "kind": "ble",
        }
        self.lock = asyncio.Lock()
        self.scanning = False
        self.background = set()
        self.resource_owners = {}
        self.handles = {"buffer": {}, "upload": {}, "flow": {}}
        self.last_identity = None
        self.refreshing = None
        self.initializing = None
        self.samples = {}
        self.samplers = {}
        self.resource_values = {}

    async def start(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.lock_file = (self.data_dir / "device.lock").open("a+")
        if os.name == "posix":
            import fcntl

            try:
                fcntl.flock(self.lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                self.lock_file.close()
                raise RuntimeError(
                    "工作台数据目录已被使用；设备管理服务只允许单进程、单 worker。"
                ) from exc
        self.store = OperationStore(self.data_dir / "operations.sqlite3")
        for task in self.store.interrupted():
            task.update(
                status="unknown",
                updated=time.time(),
                error={
                    "reason": "server_restarted",
                    "message": "服务重启，执行结果待核实。",
                    "may_have_executed": True,
                },
            )
            self.store.save(task)
        self.sdk = await self.sdk_context.enter_async_context(
            AsyncLimivia(backend=self.backend, job_timeout=self.job_timeout)
        )

    async def close(self):
        await self.disconnect()
        for task in list(self.background):
            task.cancel()
        await asyncio.gather(*self.background, return_exceptions=True)
        await self.sdk_context.aclose()
        if self.store:
            self.store.close()
        self.lock_file.close()

    def spawn(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.background.add(task)
        task.add_done_callback(self.background.discard)
        return task

    def clean(self, value):
        value = public(value)
        if isinstance(value, str):
            for credential in self.credentials:
                value = value.replace(credential, "[已隐藏]")
        elif isinstance(value, dict):
            value = {key: self.clean(item) for key, item in value.items()}
        elif isinstance(value, list):
            value = [self.clean(item) for item in value]
        return value

    def remember_secrets(self, args):
        if isinstance(args, dict):
            for key, value in args.items():
                if key.lower() in PRIVATE and isinstance(value, str) and value:
                    self.credentials.append(value)
                elif isinstance(value, (dict, list)):
                    self.remember_secrets(value)
        elif isinstance(args, list):
            for value in args:
                self.remember_secrets(value)

    def page(self, token: str) -> str:
        if token not in self.pages:
            raise HTTPException(401, "页面会话已失效，请刷新工作台。")
        return token

    def new_page(self):
        if len(self.pages) >= 1024:
            # 仅淘汰离线且不持有控制权的页面，不影响活动页面或设备。
            for token in list(self.pages):
                if not self.pages[token] and token != self.owner:
                    del self.pages[token]
                    break
            else:
                raise HTTPException(429, "页面会话数量已满。")
        token = secrets.token_urlsafe(32)
        self.pages[token] = 0
        return {"page_session": token}

    def view(self, page: str | None = None):
        return {
            **self.state,
            "generation": self.generation,
            "cursor": self.cursor,
            "control": {
                "held": self.controlled,
                "mine": self.owner == page,
                "owner_online": bool(self.pages.get(self.owner, 0)),
            },
            "handles": self.clean(self.handles),
            "resource_values": self.resource_values,
            "samples": self.samples,
            "sampling": [resource for resource, task in self.samplers.items() if not task.done()],
            "resource_owners": {
                str(key): value == page for key, value in self.resource_owners.items()
            },
        }

    def emit(self, kind: str, value=None):
        self.cursor += 1
        for queue in self.subscribers.values():
            if queue.full():
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait({"type": "resync", "cursor": self.cursor})
            else:
                queue.put_nowait({"type": kind, "cursor": self.cursor, "data": self.clean(value)})

    def changed(self):
        self.emit("device")

    def save(self, task):
        task["updated"] = time.time()
        assert self.store
        self.store.save(task)
        self.emit("operation", task)
        while len(self.tasks) > 1024:
            removable = next(
                (key for key, item in self.tasks.items() if item["status"] in TERMINAL), None
            )
            if removable is None:
                break
            self.tasks.pop(removable)

    def new_task(self, op, page=None, parent=None):
        identity = self.state["identity"] or {}
        task = {
            "id": uuid.uuid4().hex,
            "op": op,
            "status": "created",
            "created": time.time(),
            "updated": time.time(),
            "generation": self.generation,
            "device_id": identity.get("device_id"),
            "boot_id": identity.get("boot_id"),
            "request_id": None,
            "job_id": None,
            "result": None,
            "error": None,
            "result_expired": False,
            "external_effect_possible": False,
            "parent": parent,
            "page": None,
            "progress": None,
        }
        # page_session 是能力凭据，不写入持久记录。
        self.tasks[task["id"]] = task
        self.save(task)
        return task

    async def scan(self, kind):
        if self.scanning or self.runner:
            raise HTTPException(409, "请先断开设备或等待当前扫描结束。")
        self.scanning = True
        try:
            devices = await self.sdk.devices.list(kind=kind)
            return {"kind": kind, "devices": [device.to_dict() for device in devices]}
        except Exception as exc:
            raise HTTPException(503, "服务主机扫描失败，请检查适配器、权限和设备供电。") from exc
        finally:
            self.scanning = False

    async def connect(self, config):
        async with self.lock:
            if self.runner or self.scanning:
                raise HTTPException(409, "已有活动连接或正在扫描，请先断开。")
            self.generation += 1
            for refresh in (self.initializing, self.refreshing):
                if refresh:
                    refresh.cancel()
            self.initializing = self.refreshing = None
            self.owner, self.controlled = None, False
            self.request_map.clear()
            self.early.clear()
            self.resource_owners.clear()
            self.samples.clear()
            self.resource_values.clear()
            for sampler in self.samplers.values():
                sampler.cancel()
            self.samplers.clear()
            self.handles = {"buffer": {}, "upload": {}, "flow": {}}
            self.state.update(
                status="connecting",
                kind=config.kind,
                stale=True,
                identity=None,
                discovery=None,
                snapshot=None,
                error=None,
            )
            self.remember_secrets(config.options)
            self.runner = asyncio.create_task(self._run(config, self.generation))
            self.changed()

    async def _run(self, config, generation):
        try:
            options = None
            if config.kind == "mqtt":
                options = MQTTOptions.model_validate(config.options)
            elif config.kind == "ws":
                options = WebSocketOptions.model_validate(config.options)
            async with self.sdk.devices.connect(
                kind=config.kind,
                target=config.target,
                options=options,
                expected_device_id=config.expected_device_id,
            ) as connection:
                self.connection = connection
                identity = connection.identity.to_dict()
                if self.last_identity and self.last_identity != identity:
                    self.emit(
                        "identity.changed", {"previous": self.last_identity, "current": identity}
                    )
                self.last_identity = identity
                self.state.update(identity=identity, status="discovering")
                self.changed()
                self.refresh_capabilities()
                async for event in connection:
                    await self.reduce(event, generation)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — 生命周期边界记录失败，不泄露设备原始凭据。
            self.state["error"] = (
                "连接或身份验证失败，请检查目标、协议契约、传输配置和服务主机权限。"
            )
        finally:
            if generation == self.generation:
                self.connection = None
                self.runner = None
                self.controlled = False
                self.owner = None
                self.state.update(status="disconnected", stale=True)
                for task in list(self.tasks.values()):
                    if task["generation"] == generation and task["status"] not in TERMINAL:
                        task.update(
                            status="unknown",
                            error={
                                "reason": "connection_closed",
                                "message": "设备连接断开，操作可能已执行，请显式查询核实。",
                                "may_have_executed": task["request_id"] is not None,
                            },
                        )
                        self.save(task)
                        self._wake(task)
                self.changed()

    def refresh_capabilities(self, *, refresh=False):
        if self.initializing and not self.initializing.done():
            return
        self.initializing = self.spawn(self._initialise(self.generation, refresh=refresh))

    async def _initialise(self, generation, *, refresh=False):
        try:
            if generation != self.generation or not self.connection:
                return
            await self.execute("discover", {"refresh": refresh}, internal=True)
            if generation != self.generation or not self.connection:
                return
            await self.execute("state.snapshot", {}, internal=True)
            if generation != self.generation or not self.connection:
                return
            await self.execute(
                "event.subscribe",
                {"topics": ["job", "resource", "flow", "data"], "interval_ms": 100},
                internal=True,
            )
            if generation == self.generation:
                self.state.update(status="ready", stale=False)
                self.changed()
        except Exception:  # noqa: BLE001 — 生命周期边界记录失败，不泄露设备原始凭据。
            if generation == self.generation and self.connection:
                self.state.update(
                    status="discovery_failed",
                    stale=True,
                    error="能力或状态读取失败；可重新读取，不会申请控制权。",
                )
                self.changed()

    async def disconnect(self):
        if self.runner:
            runner = self.runner
            runner.cancel()
            await asyncio.gather(runner, return_exceptions=True)

    def authorize(self, op, page, internal=False, *, args=None):
        if not self.connection:
            raise HTTPException(409, "设备尚未连接。")
        if internal:
            return
        self.page(page)
        if op in INTERNAL:
            raise HTTPException(422, "此基础操作由连接管理器统一协调，请使用刷新入口。")
        readonly_status = (
            op == "resource.call"
            and isinstance(args, dict)
            and args.get("action") == "status"
            and args.get("args", {}) == {}
            and any(
                resource["id"] == args.get("resource") and resource["kind"] in {"gpio", "pwm"}
                for resource in (self.state["snapshot"] or {}).get("resources", [])
            )
        )
        if (
            not readonly_status
            and op not in OBSERVE | {"control.acquire", "outputs.stop"}
            and (self.owner != page or not self.controlled)
        ):
            raise HTTPException(403, "当前页面处于观察模式，请先取得或接管控制权。")

    async def submit(self, op, args, page=None, *, internal=False, parent=None, takeover=False):
        if op not in (*OPERATIONS, "discover", "state.snapshot"):
            raise HTTPException(422, "未知操作。")
        self.authorize(op, page, internal, args=args)
        if not internal and op in {"discover", "state.snapshot"}:
            raise HTTPException(422, "请使用刷新入口。")
        if op in DESTRUCTIVE and args.get("confirm") != DESTRUCTIVE[op]:
            raise HTTPException(422, "请输入准确的破坏性操作确认文字。")
        if (
            sum(task["status"] not in TERMINAL for task in self.tasks.values()) >= 64
            and op != "outputs.stop"
        ):
            raise HTTPException(429, "普通任务队列已满，请等待已有任务结束。")
        if op == "control.acquire":
            if any(
                t["op"] in {"control.acquire", "control.release"}
                and t["status"] not in TERMINAL
                and t["generation"] == self.generation
                for t in self.tasks.values()
            ):
                raise HTTPException(409, "控制权申请或释放尚未确认，请等待当前操作结束。")
            if self.owner and self.owner != page:
                if self.pages.get(self.owner, 0) or not takeover:
                    raise HTTPException(409, "另一页面持有控制权；该页离线后可显式接管。")
                generation, epoch = self.generation, self.control_epoch
                await self.execute("control.release", {}, internal=True)
                if generation != self.generation or self.control_epoch != epoch + 1:
                    raise HTTPException(409, "接管期间连接或停止状态已改变，请重新确认控制权。")
            self.owner = page
        if op in {"outputs.stop", "control.release"}:
            self.control_epoch += 1
            self.owner, self.controlled = None, False
            self.changed()
        self.remember_secrets(args)
        args = binary_inputs(args)
        task = self.new_task(op, page, parent)
        epoch = self.control_epoch
        try:
            connection = self.connection
            if op == "discover":
                rid = await connection.discover(refresh=args.get("refresh", False))
            elif op == "state.snapshot":
                rid = await connection.state.snapshot()
            else:
                rid = await connection.send({"type": op, "params": args})
        except Exception as exc:
            task.update(
                status="failed",
                error={
                    "reason": "local_validation",
                    "source": "sdk",
                    "message": "参数校验失败或提交队列不可用，未提交设备。",
                    "may_have_executed": False,
                },
            )
            self.save(task)
            if op == "control.acquire" and self.owner == page:
                self.owner = None
            raise HTTPException(
                422 if isinstance(exc, (ValueError, InvalidCommandError)) else 503,
                task["error"]["message"],
            ) from exc
        task.update(request_id=rid, status="submitted")
        self.request_map[(self.generation, rid)] = (task["id"], page, epoch, args)
        self.save(task)
        for event in self.early.pop(rid, []):
            await self.reduce(event, self.generation)
        return task

    async def execute(self, op, args, page=None, *, internal=False, parent=None):
        task = await self.submit(op, args, page, internal=internal, parent=parent)
        return await self.wait(task["id"])

    async def batch(self, commands, page):
        maximum = (self.state["identity"] or {}).get("batch_max", 8)
        if not 1 <= len(commands) <= maximum:
            raise HTTPException(422, f"每批需要 1–{maximum} 项操作。")
        for item in commands:
            self.authorize(item.op, page, args=item.args)
            if item.op not in OPERATIONS or item.op in {"control.acquire", "control.release"}:
                raise HTTPException(422, "批量中不能申请/释放控制或提交未知操作。")
            if item.op in DESTRUCTIVE and item.args.get("confirm") != DESTRUCTIVE[item.op]:
                raise HTTPException(422, "破坏性操作需要确认文字。")
        if sum(t["status"] not in TERMINAL for t in self.tasks.values()) + len(commands) > 64:
            raise HTTPException(429, "任务队列已满；全局停止请使用独立入口。")
        params = [binary_inputs(command.args) for command in commands]
        for command in commands:
            self.remember_secrets(command.args)
        tasks = [self.new_task(item.op, page) for item in commands]
        if any(item.op == "outputs.stop" for item in commands):
            self.control_epoch += 1
            self.owner, self.controlled = None, False
            self.changed()
        try:
            ids = await self.connection.batch(
                [{"type": c.op, "params": args} for c, args in zip(commands, params, strict=True)]
            )
        except Exception as exc:
            for task in tasks:
                task.update(
                    status="failed",
                    error={
                        "reason": "batch_rejected",
                        "message": "批量提交未通过本地校验或队列准入。",
                        "may_have_executed": False,
                    },
                )
                self.save(task)
            raise HTTPException(422, "批量未提交；请检查每项参数及整帧大小。") from exc
        for rid, task, args in zip(ids, tasks, params, strict=True):
            task.update(request_id=rid, status="submitted")
            self.request_map[(self.generation, rid)] = (
                task["id"],
                page,
                self.control_epoch,
                args,
            )
            self.save(task)
            for event in self.early.pop(rid, []):
                await self.reduce(event, self.generation)
        return tasks

    async def wait(self, operation_id):
        task = self.tasks.get(operation_id) or self.store.get(operation_id)
        if not task:
            raise HTTPException(404, "操作不存在。")
        if task["status"] not in TERMINAL:
            future = asyncio.get_running_loop().create_future()
            self.waiters.setdefault(operation_id, []).append(future)
            try:
                async with asyncio.timeout(self.job_timeout + 30):
                    await future
            finally:
                self.waiters[operation_id].remove(future)
                if not self.waiters[operation_id]:
                    self.waiters.pop(operation_id)
        if task["status"] != "completed" or task["result_expired"]:
            raise HTTPException(
                409,
                task.get("error")
                or {"reason": task["status"], "message": "任务未确认成功或结果已过期。"},
            )
        return task

    def _wake(self, task):
        for future in self.waiters.get(task["id"], []):
            if not future.done():
                future.set_result(None)

    async def reduce(self, event, generation):
        if generation != self.generation:
            return
        data = event.to_dict()
        kind = data["type"]
        if kind == "connection.closed":
            self.state["error"] = self.clean(data.get("error"))
            return
        if kind == "protocol.error":
            self.state["error"] = "协议异常，连接失效。"
            await self.connection.close()
            return
        if kind in {"state.changed", "notifications.gap"}:
            self.state["stale"] = True
            self.changed()
            self.schedule_refresh()
        if kind in {"data.available", "job.finished", "rpc.error", "notifications.gap", "unknown"}:
            # 通知永远不充当命令终态或实际样本。
            self.emit("notification", self.clean(data))
        rid = data.get("request_id")
        if rid is None:
            return
        mapping = self.request_map.get((generation, rid))
        if mapping is None:
            if rid not in self.early and len(self.early) >= 256:
                self.early.popitem(last=False)
            self.early.setdefault(rid, []).append(event)
            self.early[rid] = self.early[rid][-4:]
            return
        task_id, page, epoch, args = mapping
        task = self.tasks.get(task_id)
        if not task or task["status"] in TERMINAL:
            return
        job = data.get("job") or {}
        if kind == "command.accepted":
            if task["op"] == "resource.open" and job.get("resource"):
                self.resource_owners[job["resource"]] = page
            task.update(status="accepted", job_id=job["job_id"], job=self.clean(job))
            self.save(task)
            return
        if kind == "command.failed":
            error = self.clean(data["error"])
            task.update(
                status="unknown"
                if error.get("may_have_executed") or error.get("external_effect_possible")
                else "failed",
                error=error,
                job_id=data.get("job_id") or task["job_id"],
                external_effect_possible=error.get("external_effect_possible", False),
                handle_expired=error.get("reason") == "job_expired",
                job=self.clean(job) if job else task.get("job"),
                result_expired=job.get("result_expired", False),
            )
            if task["op"] == "resource.call":
                self.resource_values.pop(str(args.get("resource")), None)
        elif kind in {"job.failed", "job.cancelled"}:
            task.update(
                status="cancelled" if kind == "job.cancelled" else "failed",
                error=self.clean(data.get("error")),
                job=self.clean(job),
            )
        elif kind.endswith(".completed"):
            result = job.get("result") if job else data.get("result", {})
            task.update(status="completed", result=self.clean(result or {}))
            if job:
                task.update(
                    job=self.clean(job),
                    job_id=job["job_id"],
                    result_expired=job.get("result_expired", False),
                    external_effect_possible=job.get("external_effect_possible", False),
                )
            op = task["op"]
            if op == "control.acquire" and epoch == self.control_epoch and page == self.owner:
                self.controlled = True
            if kind == "discovery.completed":
                self.state["discovery"] = self.clean(result)
            if kind == "state.snapshot.completed":
                self.state.update(snapshot=self.clean(result), stale=False)
                if result.get("pages") and result["pages"][0]["owner_endpoint"] < 0:
                    self.controlled = False
            if op == "resource.open" and not task["result_expired"]:
                resource = job.get("resource") or (result or {}).get("resource")
                if resource:
                    self.resource_owners[resource] = page
            if op == "resource.call" and not task["result_expired"] and result:
                resource = str(args["resource"])
                self.resource_values[resource] = self.clean(result)
                events = result.get("events", [])
                if isinstance(events, list):
                    previous = self.samples.get(resource, [])
                    self.samples[resource] = (previous + self.clean(events))[-120:]
            if op == "state.snapshot":
                current = {str(resource["id"]) for resource in result.get("resources", [])}
                self.resource_values = {
                    key: value for key, value in self.resource_values.items() if key in current
                }
                self.resource_owners = {
                    key: value for key, value in self.resource_owners.items() if str(key) in current
                }
            for prefix, field in (
                ("buffer", "buffer_id"),
                ("upload", "upload_id"),
                ("flow", "flow_id"),
            ):
                handle = (result or {}).get(field)
                if handle:
                    self.handles[prefix][str(handle)] = {"id": handle, "boot_id": task["boot_id"]}
            for operation, family, field in (
                ("buffer.delete", "buffer", "buffer_id"),
                ("flow.remove", "flow", "flow_id"),
                ("storage.abort", "upload", "upload_id"),
                ("storage.commit", "upload", "upload_id"),
                ("ota.abort", "upload", "upload_id"),
                ("ota.commit", "upload", "upload_id"),
            ):
                if op == operation:
                    self.handles[family].pop(str(args[field]), None)
            if op in {
                "resource.open",
                "resource.call",
                "resource.close",
                "resource.recover",
                "outputs.stop",
                "flow.start",
                "flow.stop",
                "control.acquire",
                "control.release",
            }:
                self.schedule_refresh()
            if op == "job.get":
                self.reconcile_job(result, task)
            self.changed()
        else:
            return
        if task["op"] == "resource.open" and job.get("resource"):
            self.resource_owners[job["resource"]] = page
        if task["op"].startswith("resource.") or task["op"] in {"outputs.stop", "flow.stop"}:
            self.state["stale"] = True
            self.schedule_refresh()
            self.changed()
        if task["op"] == "control.acquire" and task["status"] != "completed" and self.owner == page:
            self.owner, self.controlled = None, False
        self.save(task)
        self.request_map.pop((generation, rid), None)
        self._wake(task)

    def reconcile_job(self, result, query):
        if result.get("state") not in {"completed", "failed", "cancelled"}:
            return
        for old in self.store.recent(10000):
            if old["id"] == query["id"] or old["op"] == "job.get":
                continue
            if (
                old["device_id"] == query["device_id"]
                and old["boot_id"] == query["boot_id"]
                and old["job_id"] == result.get("job_id")
                and old["status"] == "unknown"
            ):
                payload = result.get("result") or {}
                unconfirmed = result.get("result_expired", False) or (
                    old["op"] == "outputs.stop"
                    and result["state"] == "completed"
                    and (
                        payload.get("cleanup_faults") != 0
                        or payload.get("persist_error") != 0
                        or payload.get("autostart_inhibited") is not True
                    )
                )
                old.update(
                    status="unknown" if unconfirmed else result["state"],
                    result=self.clean(result.get("result")),
                    job=self.clean(result),
                    error={
                        "reason": "result_expired"
                        if result.get("result_expired")
                        else "stop_unconfirmed",
                        "message": "作业结果已过期或停止清理/持久化尚未确认。",
                        "may_have_executed": True,
                    }
                    if unconfirmed
                    else None,
                    result_expired=result.get("result_expired", False),
                )
                self.tasks[old["id"]] = old
                self.save(old)

    def schedule_refresh(self):
        if self.refreshing and not self.refreshing.done():
            return
        self.refreshing = self.spawn(self._refresh())

    async def _refresh(self):
        try:
            await asyncio.sleep(0.1)
            await self.execute("state.snapshot", {}, internal=True)
            self.changed()
        except Exception:  # noqa: BLE001 — 生命周期边界记录失败，不泄露设备原始凭据。
            self.state["stale"] = True
            self.changed()

    def operation_catalog(self):
        if not self.connection:
            return []
        return catalog(self.connection)

    async def sampling(self, resource: int, enabled: bool, page: str):
        self.authorize("resource.call", page)
        key = str(resource)
        if key in self.samplers:
            self.samplers[key].cancel()
            await asyncio.gather(self.samplers.pop(key), return_exceptions=True)
        if enabled:
            resources = (self.state.get("snapshot") or {}).get("resources", [])
            if not any(
                r["id"] == resource and r["kind"] == "adc" and r["state"] == "ready"
                for r in resources
            ):
                raise HTTPException(422, "请选择当前就绪的周期 ADC 资源。")
            self.samplers[key] = self.spawn(self._sample(resource, page, self.generation))
        self.changed()

    async def _sample(self, resource: int, page: str, generation: int):
        try:
            while generation == self.generation and self.owner == page and self.controlled:
                await self.execute(
                    "resource.call", {"resource": resource, "action": "events", "args": {}}, page
                )
                await asyncio.sleep(0.5)
        except HTTPException:
            # 一次明确失败即停止消费，不自动重发未知设备操作。
            pass
        finally:
            self.changed()


def binary_inputs(args):
    """业务表单的显式编码；普通 JSON 值不递归解释为二进制。"""
    result = dict(args)
    for key in ("data", "will"):
        value = result.get(key)
        if isinstance(value, dict) and set(value) == {"encoding", "value"}:
            try:
                encoding, text = value["encoding"], value["value"]
                if encoding == "text":
                    result[key] = text.encode("utf-8")
                elif encoding == "hex":
                    result[key] = bytes.fromhex(text)
                elif encoding == "base64":
                    result[key] = base64.b64decode(text, validate=True)
                    if base64.b64encode(result[key]).decode() != text:
                        raise ValueError("noncanonical Base64")
                else:
                    raise ValueError("unknown encoding")
            except (ValueError, TypeError, AttributeError) as exc:
                raise HTTPException(
                    422, "数据编码无效；HEX 需完整字节，Base64 需规范编码。"
                ) from exc
    if isinstance(result.get("args"), dict):
        result["args"] = binary_inputs(result["args"])
    return result
