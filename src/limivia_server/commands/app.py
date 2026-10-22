from __future__ import annotations

import logging
import shutil

import typer

from limivia_server.paths import WEB_DIST

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger(__name__)
app = typer.Typer(help="LIMIVIA 本机工作台服务", no_args_is_help=True)


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", envvar="LIMIVIA_HOST", help="监听地址"),
    port: int = typer.Option(8000, min=1, max=65535, envvar="LIMIVIA_PORT", help="监听端口"),
) -> None:
    """启动统一托管前端的 FastAPI 服务。"""
    if not (WEB_DIST / "index.html").is_file():
        logger.error("请先执行 pnpm --dir src/web run build")
        raise typer.Exit(1)
    import uvicorn

    uvicorn.run("limivia_server.web.app:app", host=host, port=port)


@app.command()
def doctor() -> None:
    """检查工作台运行环境与前端构建。"""
    for name in ("poetry", "pnpm"):
        logger.info("%s: %s", name, shutil.which(name) or "未找到")
    logger.info("前端构建: %s", (WEB_DIST / "index.html").exists())


if __name__ == "__main__":
    app()
