import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from limivia_server.devices.catalog import KINDS, OPERATIONS
from limivia_server.devices.transfers import validate_flow
from limivia_server.web.app import create_app

from .fakes import FakeBackend

ORIGIN = {"origin": "http://testserver"}


@pytest.fixture
def api(tmp_path):
    (tmp_path / "index.html").write_text("<title>LIMIVIA</title>")
    backend = FakeBackend()
    app = create_app(tmp_path, backend, tmp_path / "data")
    with TestClient(app) as client:
        token = client.post("/api/pages").json()["page_session"]
        client.headers["x-page-session"] = token
        yield client, backend, app.state.devices, token


def until(client, path, predicate):
    for _ in range(400):
        result = client.get(path).json()
        if predicate(result):
            return result
        time.sleep(0.005)
    pytest.fail(f"timed out: {result}")


def connect(client):
    assert (
        client.post("/api/device/connect", json={"kind": "usb", "target": "test"}).status_code
        == 202
    )
    return until(client, "/api/device", lambda state: state["status"] == "ready")


def command(client, op, args=None, **extra):
    response = client.post("/api/device/operations", json={"op": op, "args": args or {}, **extra})
    assert response.status_code == 202, response.text
    return response.json()


def completed(client, task):
    return until(
        client,
        "/api/operations/" + task["id"],
        lambda t: t["status"] in {"completed", "failed", "cancelled", "unknown"},
    )


def acquire(client):
    return completed(client, command(client, "control.acquire"))


def test_observer_connection_identity_discovery_and_catalog(api):
    client, backend, _, _ = api
    assert client.get("/api/device/discover").json()["kind"] == "ble"
    assert client.get("/api/device/discover?kind=ws").status_code == 422
    state = connect(client)
    assert state["identity"]["contract"] == "limivia-v3-jsonrpc2"
    assert state["snapshot"]["revision"] == 1
    assert not state["control"]["held"]
    assert len(client.get("/api/device/catalog").json()) == len(OPERATIONS) == 76
    assert len(KINDS) == 18
    assert "control.acquire" not in [c["op"] for c in backend.connection.commands]
    assert client.post("/api/device/operations", json={"op": "resource.open"}).status_code == 403


def test_scanning_and_connections_share_lifespan_sdk_search_cache(tmp_path, monkeypatch):
    from limivia import AsyncLimivia

    from limivia_server.devices import service as service_module

    backends = []

    class SearchRequiredBackend(FakeBackend):
        def transport(self, kind, target, options=None):
            assert self.discovered, "连接必须复用执行扫描的 SDK Backend"
            return super().transport(kind, target, options)

    def make_sdk(**kwargs):
        backend = SearchRequiredBackend()
        backends.append(backend)
        return AsyncLimivia(**{**kwargs, "backend": backend})

    monkeypatch.setattr(service_module, "AsyncLimivia", make_sdk)
    (tmp_path / "index.html").write_text("<title>LIMIVIA</title>")
    app = create_app(tmp_path, data_dir=tmp_path / "data")
    with TestClient(app) as client:
        client.headers["x-page-session"] = client.post("/api/pages").json()["page_session"]
        for _ in range(2):
            assert client.get("/api/device/discover?kind=usb").status_code == 200
            connect(client)
            assert client.post("/api/device/disconnect").status_code == 200
        assert len(backends) == 1
    assert backends[0].connection.closed


def test_resource_lifecycle_and_secret_projection(api):
    client, backend, _, _ = api
    connect(client)
    assert acquire(client)["status"] == "completed"
    opened = completed(
        client,
        command(
            client,
            "resource.open",
            {"kind": "gpio", "pins": {"pin": 13}, "config": {"mode": "output", "level": 0}},
        ),
    )
    resource = opened["job"]["resource"]
    assert resource > 0 and opened["job_id"]
    called = completed(
        client,
        command(
            client, "resource.call", {"resource": resource, "action": "write", "args": {"level": 1}}
        ),
    )
    assert called["status"] == "completed"
    assert (
        completed(client, command(client, "resource.close", {"resource": resource}))["status"]
        == "completed"
    )
    assert not backend.connection.resources
    body = client.get("/api/operations").text + client.get("/api/device").text
    assert "session-test" not in body and "control-test" not in body


def test_page_refresh_and_explicit_takeover(api):
    client, backend, _, token = api
    connect(client)
    acquire(client)
    other = client.post("/api/pages").json()["page_session"]
    with client.websocket_connect("/api/device/events", headers=ORIGIN) as ws:
        ws.send_json({"page_session": token})
        assert ws.receive_json()["type"] == "snapshot"
        assert (
            client.post(
                "/api/device/operations",
                headers={"x-page-session": other},
                json={"op": "control.acquire", "takeover": True},
            ).status_code
            == 409
        )
    assert not backend.connection.closed
    client.headers["x-page-session"] = other
    assert client.post("/api/device/operations", json={"op": "control.acquire"}).status_code == 409
    assert (
        completed(client, command(client, "control.acquire", takeover=True))["status"]
        == "completed"
    )
    assert client.get("/api/device").json()["control"]["mine"]


def test_stop_is_independent_and_revokes_control(api):
    client, _, _, _ = api
    connect(client)
    acquire(client)
    observer = client.post("/api/pages").json()["page_session"]
    task = client.post("/api/device/stop", headers={"x-page-session": observer}).json()
    stop = completed(client, task)
    assert stop["status"] == "completed"
    assert stop["result"]["autostart_inhibited"]
    assert not client.get("/api/device").json()["control"]["held"]


def test_batch_out_of_order_independent_results(api):
    client, _, _, _ = api
    connect(client)
    tasks = client.post(
        "/api/device/batches", json=[{"op": "diagnostics"}, {"op": "diagnostics"}]
    ).json()
    assert tasks[0]["id"] != tasks[1]["id"]
    assert [completed(client, t)["status"] for t in tasks] == ["completed", "completed"]


def test_batch_uses_same_explicit_binary_encoding_as_single_commands(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    created = completed(client, command(client, "buffer.create", {"size": 2}))
    response = client.post(
        "/api/device/batches",
        json=[
            {
                "op": "buffer.write",
                "args": {
                    "buffer_id": created["result"]["buffer_id"],
                    "offset": 0,
                    "data": {"encoding": "hex", "value": "00ff"},
                },
            }
        ],
    )
    assert response.status_code == 202
    assert completed(client, response.json()[0])["status"] == "completed"
    assert (
        next(c for c in reversed(backend.connection.commands) if c["op"] == "buffer.write")[
            "params"
        ]["data"]
        == "AP8="
    )


def test_upload_rechecks_target_after_reading_host_file(api):
    from fastapi import HTTPException

    from limivia_server.devices.api import ConnectInput
    from limivia_server.devices.transfers import start_upload

    client, backend, service, page = api
    connect(client)
    acquire(client)
    original = backend.connection

    class SwitchFile:
        async def read(self, _limit):
            await service.disconnect()
            await service.connect(ConnectInput(kind="usb", target="signal"))
            return b"old target contents"

        async def close(self):
            pass

    with pytest.raises(HTTPException) as error:
        client.portal.call(start_upload, service, SwitchFile(), "old.txt", page)
    assert error.value.status_code == 409
    assert not any(command["op"] == "storage.begin" for command in original.commands)


def test_local_validation_and_unknown_disconnect(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    response = client.post(
        "/api/device/operations", json={"op": "resource.open", "args": {"unknown": 1}}
    )
    assert response.status_code == 422
    backend.connection.disconnect_op = "resource.open"
    task = command(client, "resource.open", {"kind": "gpio", "pins": {"pin": 0}, "config": {}})
    result = completed(client, task)
    assert result["status"] == "unknown"
    assert result["error"]["may_have_executed"]


def test_cancel_request_does_not_complete_original_job(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    backend.connection.hold_jobs = True
    original = command(client, "resource.open", {"kind": "gpio", "pins": {"pin": 0}, "config": {}})
    accepted = until(
        client, "/api/operations/" + original["id"], lambda t: t["status"] == "accepted"
    )
    cancel = completed(client, command(client, "job.cancel", {"job_id": accepted["job_id"]}))
    assert cancel["status"] == "completed"
    assert client.get("/api/operations/" + original["id"]).json()["status"] == "accepted"
    backend.connection.hold_jobs = False
    assert completed(client, original)["status"] == "cancelled"


@pytest.mark.parametrize(
    "field,value", [("contract", "old-v3"), ("protocol", 1), ("protocol", 2), ("jsonrpc", "1.0")]
)
def test_invalid_identity_and_cross_origin(api, field, value):
    client, backend, _, _ = api
    assert client.post("/api/pages", headers={"origin": "http://evil.test"}).status_code == 403
    backend.connection.hello[field] = value
    client.post("/api/device/connect", json={"kind": "usb", "target": "test"})
    state = until(client, "/api/device", lambda s: s["status"] == "disconnected")
    assert state["error"] and not state["identity"]


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "ws", "target": "ws://user:password@device/v3"},
        {"kind": "mqtt", "target": "mqtt://broker"},
        {"kind": "ws", "target": "http://device"},
    ],
)
def test_network_options_validation(api, body):
    assert api[0].post("/api/device/connect", json=body).status_code == 422


def test_store_restart_unknown_and_retention(tmp_path):
    from limivia_server.devices.service import DeviceService
    from limivia_server.devices.store import OperationStore

    store = OperationStore(tmp_path / "operations.sqlite3")
    store.save({"id": "interrupted", "status": "accepted", "updated": time.time()})
    store.close()

    async def restart():
        service = DeviceService(None, tmp_path)
        await service.start()
        assert service.store.get("interrupted")["status"] == "unknown"
        assert service.connection is None
        await service.close()

    asyncio.run(restart())


def test_slow_subscriber_never_blocks_reducer(api):
    _, _, service, _ = api
    queue = asyncio.Queue(maxsize=1)
    service.subscribers["slow"] = queue
    for _ in range(100):
        service.emit("test", {})
    assert queue.qsize() == 1
    assert queue.get_nowait()["type"] == "resync"
    service.subscribers.clear()


def test_flow_validation():
    flow = {
        "version": 1,
        "profile": "bus",
        "autostart": False,
        "resources": [],
        "variables": {"x": 0},
        "steps": [{"op": "delay", "ms": 10}, {"op": "end"}],
    }
    assert validate_flow(flow, "bus")["valid"]
    assert not validate_flow(flow, "signal")["valid"]
    flow["steps"] = [{"op": "if", "then": 0, "variable": "x", "value": 0}]
    assert not validate_flow(flow, "bus")["valid"]
    flow["variables"]["x"] = float("nan")
    assert not validate_flow(flow)["valid"]


def test_upload_commit_download_and_owned_abort(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    data = b"v3-file-" * 100
    task = client.post(
        "/api/device/files/upload?name=experiment.json", files={"file": ("experiment.json", data)}
    ).json()
    done = completed(client, task)
    assert done["status"] == "completed"
    assert done["progress"]["bytes"] == len(data)
    assert backend.connection.files["experiment.json"]["data"] == data
    assert client.get("/api/device/files/experiment.json/download").content == data
    backend.connection.fail_chunk = True
    failed = client.post(
        "/api/device/files/upload?name=experiment.json",
        files={"file": ("experiment.json", b"new-data")},
    ).json()
    assert completed(client, failed)["status"] == "failed"
    assert backend.connection.files["experiment.json"]["data"] == data
    assert not backend.connection.uploads
    assert [c["op"] for c in backend.connection.commands].count("storage.abort") == 1


def test_secret_file_never_read_back_or_listed(api):
    client, _, _, _ = api
    connect(client)
    acquire(client)
    task = client.post(
        "/api/device/files/upload?name=secret.json&secret=true",
        files={"file": ("secret.json", b'{"password":"never-display"}')},
    ).json()
    assert completed(client, task)["status"] == "completed"
    assert "never-display" not in client.get("/api/operations").text
    listing = completed(client, command(client, "storage.list"))
    assert listing["result"]["files"] == []
    assert client.get("/api/device/files/secret.json/download").status_code == 409


def test_ota_commit_defaults_no_reboot(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    task = client.post(
        "/api/device/ota/upload?profile=bus", files={"file": ("firmware.bin", b"image" * 100)}
    ).json()
    done = completed(client, task)
    assert done["status"] == "completed"
    assert done["result"]["reboot"] is False
    assert (
        next(c for c in backend.connection.commands if c["op"] == "ota.commit")["params"]["reboot"]
        is False
    )


def test_flow_upload_load_run_stop_remove_are_distinct(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    definition = {
        "version": 1,
        "profile": "bus",
        "autostart": False,
        "resources": [],
        "variables": {},
        "steps": [{"op": "delay", "ms": 20}, {"op": "end"}],
    }
    import json

    upload = client.post(
        "/api/device/files/upload?name=test.flow.json",
        files={"file": ("test.flow.json", json.dumps(definition).encode())},
    ).json()
    assert completed(client, upload)["status"] == "completed"
    loaded = completed(client, command(client, "flow.load", {"name": "test.flow.json"}))
    flow_id = loaded["result"]["flow_id"]
    assert (
        completed(client, command(client, "flow.start", {"flow_id": flow_id}))["result"]["state"]
        == "running"
    )
    assert (
        completed(client, command(client, "flow.pause", {"flow_id": flow_id}))["result"]["state"]
        == "paused"
    )
    assert (
        completed(client, command(client, "flow.stop", {"flow_id": flow_id}))["result"]["state"]
        == "stopped"
    )
    completed(client, command(client, "flow.remove", {"flow_id": flow_id}))
    assert "test.flow.json" in backend.connection.files


def test_fault_resource_stays_occupied_until_recover(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    opened = completed(
        client,
        command(client, "resource.open", {"kind": "gpio", "pins": {"pin": 13}, "config": {}}),
    )
    resource = opened["job"]["resource"]
    backend.connection.cleanup_fault = True
    closed = completed(client, command(client, "resource.close", {"resource": resource}))
    assert closed["status"] == "failed"
    assert closed["job"]["driver_error"] == 5
    assert backend.connection.resources[resource]["state"] == "fault"
    backend.connection.cleanup_fault = False
    assert (
        completed(client, command(client, "resource.recover", {"resource": resource}))["status"]
        == "completed"
    )
    assert resource not in backend.connection.resources


def test_parent_child_resources_require_explicit_cascade(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    parent = completed(
        client,
        command(
            client,
            "resource.open",
            {
                "kind": "i2c.master",
                "pins": {"sda": 0, "scl": 1},
                "config": {},
            },
        ),
    )["job"]["resource"]
    child = completed(
        client,
        command(
            client,
            "resource.open",
            {
                "kind": "i2c.device",
                "parent": parent,
                "pins": {},
                "config": {"address": 83},
            },
        ),
    )["job"]["resource"]
    client.post("/api/device/refresh")
    state = until(client, "/api/device", lambda state: len(state["snapshot"]["resources"]) == 2)
    assert next(r for r in state["snapshot"]["resources"] if r["id"] == child)["parent"] == parent
    rejected = completed(client, command(client, "resource.close", {"resource": parent}))
    assert rejected["error"]["reason"] == "children_exist"
    assert {parent, child}.issubset(backend.connection.resources)
    cascaded = completed(
        client,
        command(
            client,
            "resource.close",
            {
                "resource": parent,
                "cascade": True,
            },
        ),
    )
    assert cascaded["status"] == "completed"
    assert not backend.connection.resources


def test_expired_job_handle_is_distinct_from_expired_result(api):
    client, _, _, _ = api
    connect(client)
    query = completed(client, command(client, "job.get", {"job_id": 99999}))
    assert query["status"] == "failed"
    assert query["error"]["reason"] == "job_expired"
    assert query["handle_expired"] and not query["result_expired"]


def test_result_expired_and_response_capacity(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    backend.connection.result_expired = True
    opened = completed(
        client, command(client, "resource.open", {"kind": "gpio", "pins": {"pin": 0}, "config": {}})
    )
    assert opened["status"] == "unknown" and opened["result_expired"]
    backend.connection.result_expired = False
    backend.connection.bad_response = lambda response: {
        "id": response["id"],
        "ok": False,
        "error": {"code": 1001, "reason": "response_capacity", "external_effect_possible": True},
    }
    failed = completed(
        client,
        command(
            client,
            "resource.call",
            {"resource": opened["job"]["resource"], "action": "write", "args": {"level": 1}},
        ),
    )
    assert failed["status"] == "unknown" and failed["external_effect_possible"]
    assert len([c for c in backend.connection.commands if c["op"] == "resource.call"]) == 1


def test_revision_zero_is_not_ignored(api, monkeypatch):
    from .fakes import STATE

    monkeypatch.setitem(STATE, "revision", 0)
    state = connect(api[0])
    assert state["snapshot"]["revision"] == 0
    assert all(page["revision"] == 0 for page in state["snapshot"]["pages"])


def test_fast_event_before_registration_is_replayed(api, monkeypatch):
    from limivia.types import CommandCompletedEvent

    client, _, service, _ = api
    connect(client)

    async def immediate(command):
        await service.reduce(
            CommandCompletedEvent(request_id=4242, op=command["type"], result={"fast": True}),
            service.generation,
        )
        return 4242

    monkeypatch.setattr(service.connection, "send", immediate)
    task = command(client, "diagnostics")
    assert task["status"] == "completed" and task["result"]["fast"]


def test_binary_text_hex_encoding_and_canonical_base64(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    opened = completed(
        client,
        command(
            client, "resource.open", {"kind": "uart", "pins": {"tx": 20, "rx": 21}, "config": {}}
        ),
    )
    resource = opened["job"]["resource"]
    for encoding, value in [("text", "你好"), ("hex", "01 02")]:
        task = completed(
            client,
            command(
                client,
                "resource.call",
                {
                    "resource": resource,
                    "action": "write",
                    "args": {"data": {"encoding": encoding, "value": value}},
                },
            ),
        )
        assert task["status"] == "completed"
    writes = [c for c in backend.connection.commands if c["op"] == "resource.call"]
    assert writes[0]["params"]["args"]["data"] == "5L2g5aW9"
    assert writes[1]["params"]["args"]["data"] == "AQI="
    assert (
        client.post(
            "/api/device/operations",
            json={
                "op": "resource.call",
                "args": {
                    "resource": resource,
                    "action": "write",
                    "args": {"data": {"encoding": "hex", "value": "abc"}},
                },
            },
        ).status_code
        == 422
    )


def test_adc_consumer_is_shared_and_bounded(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    opened = completed(
        client,
        command(
            client,
            "resource.open",
            {"kind": "adc", "pins": {"pin": 0}, "config": {"interval_ms": 100}},
        ),
    )
    resource = opened["job"]["resource"]
    until(client, "/api/device", lambda s: bool(s["snapshot"]["resources"]))
    assert client.post(f"/api/device/resources/{resource}/sampling?enabled=true").status_code == 200
    state = until(client, "/api/device", lambda s: bool(s["samples"].get(str(resource))))
    assert len(state["samples"][str(resource)]) <= 120
    assert (
        client.post(f"/api/device/resources/{resource}/sampling?enabled=false").status_code == 200
    )
    assert not backend.connection.closed


@pytest.mark.parametrize(
    "op",
    [
        op
        for op in OPERATIONS
        if op
        not in {
            "hello",
            "session.ping",
            "event.subscribe",
            "event.unsubscribe",
            "capabilities",
            "state",
            "control.acquire",
            "control.release",
            "outputs.stop",
        }
    ],
)
def test_all_public_operations_reach_sdk_with_stable_task_id(api, monkeypatch, op):
    """网关分派覆盖；参数/驱动语义另由集成测试和 SDK 负责，不冒充硬件验收。"""
    from limivia.types import CommandCompletedEvent

    client, _, service, _ = api
    connect(client)
    acquire(client)
    captured = []

    async def send(event):
        captured.append(event)
        await service.reduce(
            CommandCompletedEvent(
                request_id=50000, op=event["type"], result={"gateway_operation": event["type"]}
            ),
            service.generation,
        )
        return 50000

    monkeypatch.setattr(service.connection, "send", send)
    args = {"resource": 987, "buffer_id": 987, "flow_id": 987, "upload_id": 987}
    if op == "storage.format":
        args["confirm"] = "erase_littlefs"
    if op == "system.nvs_format":
        args["confirm"] = "erase_nvs"
    task = command(client, op, args)
    assert task["status"] == "completed"
    assert task["result"]["gateway_operation"] == op
    assert captured[0]["type"] == op
    assert task["id"] and task["generation"] == 1 and task["request_id"] == 50000


def test_stale_explicit_connection_scope_never_submits(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    before = len(backend.connection.commands)
    response = client.post(
        "/api/device/operations",
        json={
            "op": "resource.call",
            "args": {"resource": 1, "action": "write", "args": {"level": 1}},
            "generation": 0,
            "boot_id": "old-boot",
        },
    )
    assert response.status_code == 409
    assert not any(c["op"] == "resource.call" for c in backend.connection.commands[before:])


def test_capability_refresh_reuses_handshake_but_reads_pages(api):
    client, backend, _, _ = api
    connect(client)
    before = len([c for c in backend.connection.commands if c["op"] == "capabilities"])
    client.post("/api/device/refresh")
    until(
        client,
        "/api/operations",
        lambda tasks: sum(t["op"] == "discover" and t["status"] == "completed" for t in tasks) >= 2,
    )
    assert len([c for c in backend.connection.commands if c["op"] == "capabilities"]) > before
    assert len([c for c in backend.connection.commands if c["op"] == "hello"]) == 1
    assert not any(c["op"] == "control.acquire" for c in backend.connection.commands)


def test_unknown_profile_is_preserved_and_capabilities_drive_ui(api):
    client, backend, _, _ = api
    backend.connection.hello["profile"] = "custom-lab"
    state = connect(client)
    assert state["identity"]["profile"] == "custom-lab"
    assert len(state["discovery"]["resources"]) == 18


@pytest.mark.parametrize(
    "step",
    [
        {"op": []},
        {"op": "service", "action": []},
        {"op": "call", "resource": {}, "action": "read", "args": {}, "timeout_ms": 5},
        {"op": "set", "variable": [], "value": 1},
        {
            "op": "call",
            "resource": "x",
            "action": "read",
            "args": {"value": {"$var": []}},
            "timeout_ms": 5,
        },
    ],
)
def test_flow_invalid_structured_values_are_validation_errors(step):
    definition = {"version": 1, "profile": "bus", "resources": [], "variables": {}, "steps": [step]}
    assert not validate_flow(definition, "bus")["valid"]


def test_finite_loop_without_wait_is_bounded_not_a_busy_cycle():
    definition = {
        "version": 1,
        "profile": "bus",
        "resources": [],
        "variables": {"x": 0},
        "steps": [
            {"op": "add", "variable": "x", "value": 1},
            {"op": "loop", "count": 5, "target": 0},
            {"op": "end"},
        ],
    }
    assert validate_flow(definition, "bus")["valid"]


def test_expired_result_query_never_fabricates_original_completion(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    backend.connection.result_expired = True
    task = completed(
        client, command(client, "resource.open", {"kind": "gpio", "pins": {"pin": 0}, "config": {}})
    )
    assert task["status"] == "unknown" and task["result_expired"]
    completed(client, command(client, "job.get", {"job_id": task["job_id"]}))
    original = client.get("/api/operations/" + task["id"]).json()
    assert original["status"] == "unknown" and original["result_expired"]


def test_stop_query_still_requires_cleanup_and_persistence_confirmation(api):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    backend.connection.stop_persist_error = 9
    task = completed(client, client.post("/api/device/stop").json())
    assert task["status"] == "unknown"
    completed(client, command(client, "job.get", {"job_id": task["job_id"]}))
    assert client.get("/api/operations/" + task["id"]).json()["status"] == "unknown"
    assert not client.get("/api/device").json()["control"]["held"]


def test_notifications_gap_recovers_read_only_and_retains_single_consumer(api):
    from limivia.types import NotificationGapEvent

    client, backend, service, _ = api
    connect(client)
    before = len(backend.connection.commands)
    event = NotificationGapEvent(
        boot_id=backend.connection.hello["boot_id"],
        session="session-test",
        expected=1,
        received=4,
        dropped=3,
    )
    client.portal.call(service.reduce, event, service.generation)
    until(client, "/api/device", lambda state: not state["stale"])
    after = backend.connection.commands[before:]
    assert any(c["op"] == "state" for c in after)
    assert not any(c["op"] in {"resource.call", "control.acquire", "outputs.stop"} for c in after)


def test_cross_page_revision_never_exposes_partial_snapshot(api):
    client, backend, _, _ = api

    def corrupt(response):
        if (
            backend.connection.commands[-1]["op"] == "state"
            and response.get("result", {}).get("page") == 1
        ):
            response["result"]["revision"] = 2
        return response

    backend.connection.bad_response = corrupt
    client.post("/api/device/connect", json={"kind": "usb", "target": "test"})
    state = until(client, "/api/device", lambda s: s["status"] == "discovery_failed")
    assert state["snapshot"] is None


def test_completed_history_is_bounded_without_evicting_unfinished(tmp_path):
    import json

    from limivia_server.devices.store import OperationStore

    store = OperationStore(tmp_path / "history.sqlite3")
    now = time.time()
    rows = [
        (str(i), now, 1, json.dumps({"id": str(i), "updated": now, "status": "completed"}))
        for i in range(10002)
    ]
    store.db.executemany("INSERT INTO operations VALUES (?,?,?,?)", rows)
    store.db.commit()
    store.save({"id": "active", "updated": 0, "status": "accepted"})
    store.prune()
    assert (
        store.db.execute("SELECT COUNT(*) FROM operations WHERE terminal=1").fetchone()[0] == 10000
    )
    assert store.get("active")["status"] == "accepted"
    store.close()


def test_pending_control_claim_cannot_be_overtaken(api):
    client, backend, _, _ = api
    connect(client)
    backend.connection.write_delay = 0.1
    original = command(client, "control.acquire")
    other = client.post("/api/pages").json()["page_session"]
    response = client.post(
        "/api/device/operations",
        headers={"x-page-session": other},
        json={"op": "control.acquire", "takeover": True},
    )
    assert response.status_code == 409
    assert completed(client, original)["status"] == "completed"
    assert len([c for c in backend.connection.commands if c["op"] == "control.acquire"]) == 1


def test_reconnect_cancels_previous_capability_initializer(api, monkeypatch):
    client, _, service, _ = api
    initialise = service._initialise

    async def delayed_initialise(generation, **kwargs):
        if generation == 1:
            await asyncio.Event().wait()
        await initialise(generation, **kwargs)

    monkeypatch.setattr(service, "_initialise", delayed_initialise)
    client.post("/api/device/connect", json={"kind": "usb", "target": "test"})
    until(client, "/api/device", lambda state: state["status"] == "discovering")
    client.post("/api/device/disconnect")
    client.post("/api/device/connect", json={"kind": "usb", "target": "signal"})
    state = until(client, "/api/device", lambda state: state["status"] == "ready")
    assert state["discovery"]["identity"]["profile"] == "signal"
    assert state["generation"] == 2


@pytest.mark.parametrize(
    "kind,target,options",
    [
        ("ws", "ws://board.test/v3", {"ca_file": "host-ca.pem"}),
        (
            "mqtt",
            "mqtts://broker.test:8883",
            {
                "device_id": "02:00:00:00:00:01",
                "protocol": "3.1.1",
                "password": "transport-private",
            },
        ),
        ("mqtt", "mqtt://broker.test:1883", {"device_id": "02:00:00:00:00:01", "protocol": "5.0"}),
    ],
)
def test_four_transport_public_options_and_private_projection(api, kind, target, options):
    client, _, _, _ = api
    assert (
        client.post(
            "/api/device/connect", json={"kind": kind, "target": target, "options": options}
        ).status_code
        == 202
    )
    state = until(client, "/api/device", lambda state: state["status"] == "ready")
    assert state["kind"] == kind
    assert "transport-private" not in client.get("/api/device").text


def test_expected_identity_mismatch_never_enters_ready(api):
    client, _, _, _ = api
    client.post(
        "/api/device/connect",
        json={"kind": "usb", "target": "test", "expected_device_id": "02:00:00:00:00:99"},
    )
    state = until(client, "/api/device", lambda state: state["status"] == "disconnected")
    assert not state["identity"] and state["error"]


def test_sdk_event_overflow_is_a_connection_fault(api, monkeypatch):
    client, backend, service, _ = api
    connect(client)

    async def burst():
        resume = asyncio.Event()
        reduce = service.reduce

        async def delayed_reduce(event, generation):
            if event.type == "data.available":
                await resume.wait()
            await reduce(event, generation)

        # 模拟服务消费者暂时滞后，让真实 SDK 的有界队列积压。
        monkeypatch.setattr(service, "reduce", delayed_reduce)
        try:
            for sequence in range(1, 400):
                await backend.connection.emit(
                    {
                        "event": "data.available",
                        "event_sequence": sequence,
                        "revision": 1,
                        "resource": 1,
                        "instance": 1,
                        "job_id": 0,
                        "sequence": sequence,
                        "dropped": 0,
                    }
                )
            async with asyncio.timeout(3):
                while not backend.connection.closed:
                    await asyncio.sleep(0)
        finally:
            resume.set()

    client.portal.call(burst)
    state = until(client, "/api/device", lambda state: state["status"] == "disconnected")
    assert state["error"]["reason"] == "event_buffer_overflow"
    assert service.connection is None


@pytest.mark.parametrize("kind", ["gpio", "pwm"])
def test_observer_reads_output_status_without_control_or_output_changes(api, kind):
    client, backend, _, _ = api
    connect(client)
    acquire(client)
    opened = completed(
        client,
        command(
            client,
            "resource.open",
            {
                "kind": kind,
                "pins": {"pin": 13},
                "config": {"mode": "output", "level": 1}
                if kind == "gpio"
                else {
                    "frequency": 1000,
                    "resolution": 10,
                    "duty": 50,
                    "breath_ms": 2000,
                },
            },
        ),
    )
    resource = opened["job"]["resource"]
    until(
        client,
        "/api/device",
        lambda state: any(r["id"] == resource for r in state["snapshot"]["resources"]),
    )
    completed(client, command(client, "control.release"))
    before = len(backend.connection.commands)
    result = completed(
        client,
        command(
            client,
            "resource.call",
            {
                "resource": resource,
                "action": "status",
                "args": {},
            },
        ),
    )
    assert result["status"] == "completed"
    assert result["result"]["enabled"] is True
    if kind == "gpio":
        assert result["result"]["level"] == 1
    assert not client.get("/api/device").json()["control"]["held"]
    assert not any(
        c["op"] in {"control.acquire", "resource.open", "resource.close"}
        for c in backend.connection.commands[before:]
    )
    for action, args in [
        ("write", {"level": 0}),
        ("duty", {"duty": 0}),
        ("status", {"unexpected": 1}),
    ]:
        response = client.post(
            "/api/device/operations",
            json={
                "op": "resource.call",
                "args": {
                    "resource": resource,
                    "action": action,
                    "args": args,
                },
            },
        )
        assert response.status_code == 403
    assert (
        client.post(
            "/api/device/operations",
            json={
                "op": "resource.call",
                "args": {
                    "resource": 9999,
                    "action": "status",
                    "args": {},
                },
            },
        ).status_code
        == 403
    )
