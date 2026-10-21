from __future__ import annotations

import asyncio
import codecs
import json
import logging
from contextlib import suppress
from urllib.parse import urlsplit

from anyio import CancelScope
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from limivia.devices.transports import DeviceBackend, LinkKind

logger = logging.getLogger(__name__)


def validate_command(text: str) -> bytes:
    data = text.encode("utf-8")
    if len(data) > 1025 or not text.endswith("\n") or "\n" in text[:-1] or "\0" in text:
        raise ValueError("命令须为单行 JSON，内容不得超过 1024 bytes。")
    try:
        command = json.loads(text)
    except (ValueError, RecursionError) as exc:
        raise ValueError("命令 JSON 格式无效。") from exc
    if (
        not isinstance(command, dict)
        or command.get("v") != 1
        or type(command.get("id")) is not int
        or not 1 <= command["id"] <= 2147483647
        or not isinstance(command.get("op"), str)
        or not command["op"]
        or not isinstance(command.get("params"), dict)
    ):
        raise ValueError("命令必须包含协议 v=1、有效 id、op 和 params。")
    return data


def error_message(kind: LinkKind, exc: Exception) -> str:
    if isinstance(exc, (ValueError, ConnectionError)):
        return str(exc)
    if isinstance(exc, TimeoutError):
        return (
            "后端设备通信超时，请检查设备供电、距离或串口占用；操作可能已执行，请重连后查询状态。"
        )
    if kind == "ble":
        return "后端蓝牙不可用或连接失败。请检查后端电脑的蓝牙适配器、系统权限及设备供电；Linux 还需运行 BlueZ 服务。"
    return "后端 USB 串口不可用。请检查数据线、串口占用及后端进程的串口访问权限。"


def device_router(backend: DeviceBackend | None = None) -> APIRouter:
    backend = backend or DeviceBackend()
    router = APIRouter(prefix="/api/device")
    scanning = asyncio.Lock()
    occupied = False

    @router.get("/discover")
    async def discover(kind: LinkKind = "ble"):
        if occupied or scanning.locked():
            raise HTTPException(409, "后端正在连接设备或搜索设备，请先断开或等待搜索结束。")
        async with scanning:
            try:
                devices = await asyncio.wait_for(backend.discover(kind), timeout=12)
            except Exception as exc:
                logger.warning("%s discovery failed: %s", kind, exc)
                raise HTTPException(503, error_message(kind, exc)) from exc
        return {"kind": kind, "devices": devices}

    @router.websocket("/connect")
    async def connect(socket: WebSocket, kind: LinkKind = "ble", target: str = ""):
        nonlocal occupied
        # 防止其他站点通过浏览器悄悄取得本机设备控制权。
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
        transport = None
        tasks: list[asyncio.Task] = []
        connected = asyncio.Event()
        try:
            transport = backend.transport(kind, target)

            async def device_to_web():
                await asyncio.wait_for(transport.open(), timeout=20)
                await socket.send_json({"type": "connected"})
                connected.set()
                decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
                while True:
                    data = await transport.read()
                    if not data:
                        raise ConnectionError("设备连接已断开，请重新搜索并连接。")
                    text = decoder.decode(data)
                    if text:
                        await socket.send_json({"type": "data", "data": text})

            async def web_to_device():
                while True:
                    text = await socket.receive_text()
                    data = validate_command(text)
                    await connected.wait()
                    await asyncio.wait_for(transport.write(data), timeout=5)

            tasks = [asyncio.create_task(device_to_web()), asyncio.create_task(web_to_device())]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.warning("%s connection failed: %s", kind, exc, exc_info=True)
            # 先停止数据发送，再发送错误，避免并发操作同一个 WebSocket。
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            with suppress(Exception):
                await socket.send_json({"type": "error", "message": error_message(kind, exc)})
        finally:
            # ASGI 请求取消不能打断硬件释放，否则后续页面可能永久收到占用错误。
            with CancelScope(shield=True):
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                if transport is not None:
                    try:
                        await asyncio.wait_for(transport.close(), timeout=5)
                    except Exception:
                        logger.exception("Failed to close %s transport", kind)
                occupied = False
                with suppress(Exception):
                    await socket.close()

    return router
