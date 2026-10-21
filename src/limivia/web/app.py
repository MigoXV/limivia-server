from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from starlette.staticfiles import StaticFiles

from limivia.paths import WEB_DIST


class FrontendFiles(StaticFiles):
    """SPA fallback only for extensionless browser routes; missing assets stay 404."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or Path(path).suffix:
                raise
        except Exception as exc:
            # StaticFiles raises Starlette's base HTTPException.
            from starlette.exceptions import HTTPException as StarletteHTTPException

            if not isinstance(exc, StarletteHTTPException) or exc.status_code != 404:
                raise
            if Path(path).suffix:
                raise
        return FileResponse(Path(self.directory) / "index.html")


def create_app(dist: Path = WEB_DIST) -> FastAPI:
    if not (dist / "index.html").is_file():
        raise RuntimeError("前端尚未构建，请先执行 pnpm --dir src/web run build")
    app = FastAPI(title="LIMIVIA", version="0.1.0")

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/info")
    async def info() -> dict:
        return {"name": "LIMIVIA", "version": "0.1.0", "protocol": 1,
                "transports": ["web-serial", "web-bluetooth"]}

    @app.api_route("/api", methods=["GET", "HEAD"], include_in_schema=False)
    @app.api_route("/api/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def unknown_api(path: str = ""):
        raise HTTPException(404, detail="API route not found")

    # Use framework-native hosting where the installed FastAPI exposes it.
    if hasattr(app, "frontend"):
        app.frontend("/", directory=dist, fallback="index.html")
    else:
        app.mount("/", FrontendFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
