import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from limivia.devices.api import validate_command
from limivia.devices.transports import RX, SERVICE, TX, BluetoothTransport, DeviceBackend
from limivia.web.app import create_app

ORIGIN = {"origin": "http://testserver"}
COMMAND = '{"v":1,"id":1,"op":"hello","params":{}}\n'


class FakeTransport:
    def __init__(self):
        self.closed = False
        self.writes = []

    async def open(self):
        self.queue = asyncio.Queue()

    async def read(self):
        data = await self.queue.get()
        if isinstance(data, Exception):
            raise data
        return data

    async def write(self, data):
        self.writes.append(data)
        if json.loads(data)["op"] == "fail":
            await self.queue.put(ConnectionError("模拟设备断线"))
            return
        # 接收端必须在 UTF-8 字符跨分片时仍保留完整的中文。
        reply = '{"v":1,"id":1,"ok":true,"result":"设备"}\n'.encode()
        boundary = reply.index("设".encode()) + 1
        await self.queue.put(reply[:boundary])
        await self.queue.put(reply[boundary:])

    async def close(self):
        self.closed = True


class FakeBackend:
    def __init__(self):
        self.transports = []

    async def discover(self, kind):
        return [{"id": "test", "name": f"{kind} device"}]

    def transport(self, kind, target):
        if target != "test":
            raise ValueError("请重新搜索设备")
        transport = FakeTransport()
        self.transports.append(transport)
        return transport


@pytest.fixture
def device_api(tmp_path):
    (tmp_path / "index.html").write_text("<title>LIMIVIA</title>")
    backend = FakeBackend()
    with TestClient(create_app(tmp_path, backend)) as client:
        yield client, backend


def test_discovery_defaults_to_ble(device_api):
    client, _ = device_api
    assert client.get("/api/device/discover").json()["kind"] == "ble"
    assert client.get("/api/device/discover?kind=usb").json()["devices"][0]["id"] == "test"
    assert client.get("/api/device/discover?kind=invalid").status_code == 422
    info = client.get("/api/info").json()
    assert info["device_owner"] == "backend"
    assert info["default_transport"] == "ble"


@pytest.mark.parametrize("kind", ["ble", "usb"])
def test_bridge_and_exclusive_ownership(device_api, kind):
    client, backend = device_api
    with client.websocket_connect(
        f"/api/device/connect?kind={kind}&target=test", headers=ORIGIN
    ) as ws:
        assert ws.receive_json() == {"type": "connected"}
        assert client.get("/api/device/discover").status_code == 409
        with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as other:
            assert "其他页面" in other.receive_json()["message"]
        ws.send_text(COMMAND)
        reply = ws.receive_json()["data"] + ws.receive_json()["data"]
        assert json.loads(reply)["result"] == "设备"
    assert backend.transports[0].closed
    assert backend.transports[0].writes == [COMMAND.encode()]
    with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as ws:
        assert ws.receive_json()["type"] == "connected"
    assert backend.transports[-1].closed


def test_bridge_reports_disconnect_and_releases_device(device_api):
    client, backend = device_api
    with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as ws:
        assert ws.receive_json()["type"] == "connected"
        ws.send_text(COMMAND.replace('"hello"', '"fail"'))
        assert ws.receive_json() == {"type": "error", "message": "模拟设备断线"}
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
    assert backend.transports[0].closed
    assert client.get("/api/device/discover").status_code == 200


def test_invalid_target_and_cross_origin_do_not_open_hardware(device_api):
    client, backend = device_api
    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(
            "/api/device/connect?target=test", headers={"origin": "http://evil.test"}
        ),
    ):
        pass
    with client.websocket_connect("/api/device/connect?target=unknown", headers=ORIGIN) as ws:
        assert "重新搜索" in ws.receive_json()["message"]
    assert not backend.transports


def test_invalid_command_closes_bridge_without_writing(device_api):
    client, backend = device_api
    with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as ws:
        assert ws.receive_json()["type"] == "connected"
        ws.send_text(COMMAND + COMMAND)
        assert ws.receive_json()["type"] == "error"
    assert backend.transports[0].writes == []
    assert backend.transports[0].closed


def test_open_failure_closes_partial_connection_and_allows_retry(device_api, monkeypatch):
    client, backend = device_api

    async def fail_open(self):
        raise OSError("adapter missing")

    with monkeypatch.context() as patch:
        patch.setattr(FakeTransport, "open", fail_open)
        with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as ws:
            assert "后端蓝牙" in ws.receive_json()["message"]
    assert backend.transports[0].closed
    with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as ws:
        assert ws.receive_json()["type"] == "connected"


def test_discovery_failure_is_actionable(device_api, monkeypatch):
    client, backend = device_api

    async def fail_discover(kind):
        raise OSError("adapter missing")

    monkeypatch.setattr(backend, "discover", fail_discover)
    response = client.get("/api/device/discover")
    assert response.status_code == 503
    assert "BlueZ" in response.json()["detail"]


@pytest.mark.parametrize(
    "text",
    [
        "{}\n",
        COMMAND * 2,
        COMMAND.rstrip(),
        "[1]\n",
        "null\n",
        "x" * 1025 + "\n",
        COMMAND.replace('"id":1', '"id":true'),
        COMMAND.replace('"id":1', '"id":0'),
    ],
)
def test_command_validation(text):
    with pytest.raises(ValueError):
        validate_command(text)


def test_ble_transport_subscribes_fragments_and_surfaces_disconnect(monkeypatch):
    class Client:
        def __init__(self, device, disconnected_callback, **kwargs):
            self.disconnected = disconnected_callback
            self.writes = []
            self.notifications = None
            self.connected = False

        async def connect(self):
            self.connected = True

        async def start_notify(self, uuid, callback):
            assert uuid == TX
            self.notifications = callback

        async def write_gatt_char(self, uuid, data, response):
            assert self.notifications is not None
            assert uuid == RX and response is True
            self.writes.append(data)

        async def disconnect(self):
            self.connected = False

    monkeypatch.setattr("limivia.devices.transports.BleakClient", Client)

    async def run():
        transport = BluetoothTransport("test")
        await transport.open()
        payload = b"x" * 51
        await transport.write(payload)
        assert list(map(len, transport.client.writes)) == [20, 20, 11]
        assert b"".join(transport.client.writes) == payload
        transport.client.notifications(None, bytearray(b"data"))
        assert await transport.read() == b"data"
        transport.client.disconnected(None)
        with pytest.raises(ConnectionError, match="蓝牙连接已断开"):
            await transport.read()
        await transport.close()
        assert not transport.client.connected

    asyncio.run(run())


def test_discovery_filters_candidates_and_refuses_arbitrary_targets(monkeypatch):
    async def discover(**kwargs):
        assert kwargs["service_uuids"] == [SERVICE]
        return {
            "one": (
                SimpleNamespace(address="one", name="board"),
                SimpleNamespace(local_name="LIMIVIA", service_uuids=[SERVICE]),
            ),
            "two": (
                SimpleNamespace(address="two", name="other"),
                SimpleNamespace(local_name="other", service_uuids=[]),
            ),
        }

    monkeypatch.setattr("limivia.devices.transports.BleakScanner.discover", discover)
    monkeypatch.setattr(
        "limivia.devices.transports.list_ports.comports",
        lambda: [
            SimpleNamespace(vid=0x303A, pid=0x1001, device="/dev/test", description="ESP32"),
            SimpleNamespace(vid=1, pid=2, device="/dev/other", description="other"),
        ],
    )

    async def run():
        backend = DeviceBackend()
        assert await backend.discover("ble") == [{"id": "one", "name": "LIMIVIA"}]
        assert len(await backend.discover("usb")) == 1
        with pytest.raises(ValueError, match="搜索"):
            backend.transport("usb", "/etc/passwd")

    asyncio.run(run())


def test_disconnect_during_open_cancels_and_closes_transport(device_api, monkeypatch):
    import threading

    client, backend = device_api
    opening = threading.Event()

    async def slow_open(self):
        opening.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(FakeTransport, "open", slow_open)
    with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN):
        assert opening.wait(2)
    assert backend.transports[0].closed
    assert client.get("/api/device/discover").status_code == 200


def test_serial_transport_preserves_bytes_and_does_not_toggle_reset(monkeypatch):
    from limivia.devices.transports import SerialTransport

    class Port:
        def __init__(self, **kwargs):
            assert kwargs == {"baudrate": 115200, "timeout": 0.2, "write_timeout": 2}
            self.is_open = False
            self.writes = []

        def open(self):
            assert self.dtr is False and self.rts is False
            assert self.port == "/dev/test"
            self.is_open = True

        def read(self, size):
            return b"response\n"

        def write(self, data):
            self.writes.append(data)
            return len(data)

        def close(self):
            self.is_open = False

    monkeypatch.setattr("limivia.devices.transports.serial.Serial", Port)

    async def run():
        transport = SerialTransport("/dev/test")
        await transport.open()
        await transport.write(COMMAND.encode())
        assert await transport.read() == b"response\n"
        assert transport.port.writes == [COMMAND.encode()]
        await transport.close()
        assert not transport.port.is_open

    asyncio.run(run())


def test_request_cancellation_cannot_interrupt_hardware_release(device_api, monkeypatch):
    client, backend = device_api

    async def slow_close(self):
        # 模拟系统 GATT/串口释放正在等待；退出 TestClient 会取消 ASGI 请求。
        await asyncio.sleep(0.05)
        self.closed = True

    monkeypatch.setattr(FakeTransport, "close", slow_close)
    for _ in range(3):
        with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as ws:
            assert ws.receive_json()["type"] == "connected"
        assert backend.transports[-1].closed
        assert client.get("/api/device/discover").status_code == 200
