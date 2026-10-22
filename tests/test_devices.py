import asyncio
import json
import threading

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from limivia_server.web.app import create_app

from .fakes import SAMPLE, FakeBackend, FakeTransport

ORIGIN = {"origin": "http://testserver"}
COMMAND = '{"v":1,"id":1,"op":"hello","params":{}}\n'


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
        # 浏览器 id=1 与 SDK 内部握手 id=1 不冲突。
        ws.send_text(COMMAND)
        reply = json.loads(ws.receive_json()["data"])
        assert reply["id"] == 1 and reply["result"]["name"] == "设备"
        ws.send_text('{"v":1,"id":42,"op":"gpio.read","params":{"pin":13}}\n')
        reply = json.loads(ws.receive_json()["data"])
        assert reply == {"v": 1, "id": 42, "ok": True, "result": {"pin": 13, "level": 1}}
    transport = backend.transports[0]
    assert transport.closed
    assert [c["id"] for c in transport.commands] == [1, 2, 3]
    with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as ws:
        assert ws.receive_json()["type"] == "connected"
    assert backend.transports[-1].closed


def test_events_and_firmware_failure_keep_connection_usable(device_api, monkeypatch):
    client, backend = device_api
    original = FakeTransport.write

    async def write(self, data):
        await original(self, data)
        if json.loads(data)["op"] == "adc.start":
            await self.emit({"v": 1, "event": "adc", "data": SAMPLE})
            await self.emit({"v": 1, "event": "changed", "revision": 3})

    monkeypatch.setattr(FakeTransport, "write", write)
    with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as ws:
        assert ws.receive_json()["type"] == "connected"
        ws.send_text('{"v":1,"id":2,"op":"adc.start","params":{"pin":0,"interval_ms":200}}\n')
        messages = [json.loads(ws.receive_json()["data"]) for _ in range(3)]
        assert messages[0]["id"] == 2 and messages[0]["ok"]
        assert messages[1]["event"] == "adc" and messages[1]["data"] == SAMPLE
        assert messages[2] == {"v": 1, "event": "changed", "revision": 3}
        backend.transports[0].refuse = True
        ws.send_text('{"v":1,"id":4,"op":"gpio.read","params":{"pin":13}}\n')
        failed = json.loads(ws.receive_json()["data"])
        assert failed == {
            "v": 1,
            "id": 4,
            "ok": False,
            "error": {"code": "pin_busy", "message": "引脚已占用"},
        }
        backend.transports[0].refuse = False
        ws.send_text('{"v":1,"id":5,"op":"state","params":{}}\n')
        assert json.loads(ws.receive_json()["data"])["ok"]


def test_bridge_reports_disconnect_and_releases_device(device_api):
    client, backend = device_api
    with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as ws:
        assert ws.receive_json()["type"] == "connected"
        backend.transports[0].disconnect_op = "state"
        ws.send_text(COMMAND.replace('"hello"', '"state"'))
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


def test_invalid_frame_closes_bridge_without_forwarding(device_api):
    client, backend = device_api
    with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as ws:
        assert ws.receive_json()["type"] == "connected"
        ws.send_text(COMMAND + COMMAND)
        assert ws.receive_json()["type"] == "error"
    assert [c["op"] for c in backend.transports[0].commands] == ["hello"]
    assert backend.transports[0].closed


@pytest.mark.parametrize(
    "op,params,code",
    [
        ("future", {}, "unknown_operation"),
        ("pwm.set", {"pin": 13, "frequency": 0, "duty": 50}, "invalid_argument"),
    ],
)
def test_invalid_operation_or_params_returns_failure_without_device_write(
    device_api, op, params, code
):
    client, backend = device_api
    with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as ws:
        assert ws.receive_json()["type"] == "connected"
        ws.send_text(json.dumps({"v": 1, "id": 27, "op": op, "params": params}) + "\n")
        reply = json.loads(ws.receive_json()["data"])
        assert reply["id"] == 27 and reply["ok"] is False
        assert reply["error"]["code"] == code
        assert len(backend.transports[0].commands) == 1


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


def test_incompatible_firmware_never_reports_connected(device_api):
    client, backend = device_api
    backend.configure = lambda transport: transport.hello.update({"protocol": 2})
    with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as ws:
        assert "不兼容" in ws.receive_json()["message"]
    assert backend.transports[-1].closed


def test_discovery_failure_is_actionable(device_api, monkeypatch):
    client, backend = device_api

    async def fail_discover(kind):
        raise OSError("adapter missing")

    monkeypatch.setattr(backend, "discover", fail_discover)
    response = client.get("/api/device/discover")
    assert response.status_code == 503
    assert "BlueZ" in response.json()["detail"]


def test_disconnect_during_open_cancels_and_closes_transport(device_api, monkeypatch):
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


def test_disconnect_during_handshake_releases_device(device_api, monkeypatch):
    client, backend = device_api
    writing = threading.Event()

    async def no_reply(self, data):
        self.commands.append(json.loads(data))
        writing.set()

    monkeypatch.setattr(FakeTransport, "write", no_reply)
    with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN):
        assert writing.wait(2)
    assert backend.transports[0].closed
    assert client.get("/api/device/discover").status_code == 200


def test_request_cancellation_cannot_interrupt_hardware_release(device_api):
    client, backend = device_api
    backend.configure = lambda transport: setattr(transport, "close_delay", 0.05)
    for _ in range(3):
        with client.websocket_connect("/api/device/connect?target=test", headers=ORIGIN) as ws:
            assert ws.receive_json()["type"] == "connected"
        assert backend.transports[-1].closed
        assert client.get("/api/device/discover").status_code == 200
