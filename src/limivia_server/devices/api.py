from __future__ import annotations

import asyncio
import json
import logging
from contextlib import suppress
from urllib.parse import urlsplit

from anyio import CancelScope
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from limivia import AsyncConnection, AsyncLimivia, InvalidCommandError
from limivia.protocol import event_to_wire, parse_wire_command
from limivia.types import LinkKind

logger = logging.getLogger(__name__)


def error_message(kind: LinkKind, exc: Exception) -> str:
    if isinstance(exc, (ValueError, ConnectionError)):
        return str(exc)
    if isinstance(exc, TimeoutError):
        return "后端设备通信超时；操作可能已执行，请重连后查询状态。"
    if kind == "ble":
        return "后端蓝牙不可用或连接失败。请检查蓝牙适配器、系统权限及设备供电；Linux 还需运行 BlueZ 服务。"
    return "后端 USB 串口不可用。请检查数据线、串口占用及后端进程的串口访问权限。"


def device_router(client: AsyncLimivia) -> APIRouter:
    router = APIRouter(prefix="/api/device")
    scanning = asyncio.Lock()
    occupied = False

    @router.get("/discover")
    async def discover(kind: LinkKind = "ble"):
        if occupied or scanning.locked():
            raise HTTPException(409, "后端正在连接设备或搜索设备，请先断开或等待搜索结束。")
        async with scanning:
            try:
                devices = await client.devices.list(kind=kind)
            except Exception as exc:
                logger.warning("%s discovery failed: %s", kind, exc)
                raise HTTPException(503, error_message(kind, exc)) from exc
        return {"kind": kind, "devices": [device.to_dict() for device in devices]}

    @router.websocket("/connect")
    async def connect(socket: WebSocket, kind: LinkKind = "ble", target: str = ""):
        nonlocal occupied
        origin = urlsplit(socket.headers.get("origin", ""))
        expected_scheme = "https" if socket.url.scheme == "wss" else "http"
        if origin.netloc != socket.headers.get("host") or origin.scheme != expected_scheme:
            await socket.close(code=1008)
            return
        await socket.accept()
        if occupied or scanning.locked():
            await socket.send_json(
                {"type": "error", "message": "后端设备正被其他页面使用，请先断开原连接。"}
            )
            await socket.close(code=1008)
            return
        occupied = True
        tasks: list[asyncio.Task] = []
        connected = asyncio.Event()
        sending = asyncio.Lock()
        connection: AsyncConnection | None = None
        request_ids: dict[int, int] = {}

        async def send(value: dict) -> None:
            async with sending:
                await socket.send_json(value)

        async def device_to_web():
            nonlocal connection
            async with client.devices.connect(kind=kind, target=target) as session:
                connection = session
                await send({"type": "connected"})
                connected.set()
                async for event in session:
                    if event.type == "connection.closed":
                        if event.error:
                            raise ConnectionError(event.error.message)
                        return
                    if event.type == "protocol.error":
                        raise ConnectionError(event.message)
                    request_id = None
                    if hasattr(event, "request_id"):
                        request_id = request_ids.pop(event.request_id, None)
                        if request_id is None:
                            # 自动 hello 的结果不占用浏览器请求 ID。
                            continue
                    if event.type == "command.failed" and event.error.source == "sdk":
                        raise ConnectionError(event.error.message)
                    frame = event_to_wire(event, request_id)
                    if frame is not None:
                        await send({"type": "data", "data": frame})

        async def web_to_device():
            while True:
                text = await socket.receive_text()
                try:
                    browser_id, command = parse_wire_command(text)
                except InvalidCommandError as exc:
                    if exc.request_id is None:
                        raise
                    await connected.wait()
                    frame = {
                        "v": 1,
                        "id": exc.request_id,
                        "ok": False,
                        "error": {"code": exc.code, "message": str(exc)},
                    }
                    await send({"type": "data", "data": json.dumps(frame) + "\n"})
                    continue
                await connected.wait()
                assert connection is not None
                sdk_id = await connection.send(command)
                # SDK send 原子入队，登记映射之前不会发生硬件收发。
                request_ids[sdk_id] = browser_id

        try:
            tasks = [asyncio.create_task(device_to_web()), asyncio.create_task(web_to_device())]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.warning("%s connection failed: %s", kind, exc, exc_info=True)
            # CancelScope 保证取消桥接任务时，SDK 的清理仍能执行完。
            with CancelScope(shield=True):
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                with suppress(Exception):
                    await send({"type": "error", "message": error_message(kind, exc)})
        finally:
            with CancelScope(shield=True):
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                occupied = False
                with suppress(Exception):
                    await socket.close()

    return router
