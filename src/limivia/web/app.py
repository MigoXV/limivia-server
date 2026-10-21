from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from limivia.devices.api import device_router
from limivia.devices.transports import DeviceBackend
from limivia.paths import WEB_DIST


def create_app(dist: Path = WEB_DIST, backend: DeviceBackend | None = None) -> FastAPI:
    if not (dist / "index.html").is_file():
        raise RuntimeError("前端尚未构建，请先执行 pnpm --dir src/web run build")
    app = FastAPI(title="LIMIVIA", version="0.1.0")

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/info")
    async def info() -> dict:
        return {
            "name": "LIMIVIA",
            "version": "0.1.0",
            "protocol": 1,
            "transports": ["ble", "usb"],
            "device_owner": "backend",
            "default_transport": "ble",
        }

    app.include_router(device_router(backend))

    @app.api_route("/api", methods=["GET", "HEAD"], include_in_schema=False)
    @app.api_route("/api/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def unknown_api(path: str = ""):
        raise HTTPException(404, detail="API route not found")

    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
    app.frontend("/", directory=dist, fallback="index.html", check_dir=True)
    return app


app = create_app()
