from __future__ import annotations

import logging
import os
from pathlib import Path
import shutil
import subprocess

import typer
from serial.tools import list_ports

from limivia.paths import FIRMWARE, ROOT, WEB_DIST

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger(__name__)
app = typer.Typer(help="LIMIVIA 本机服务与固件工具", no_args_is_help=True)
firmware = typer.Typer(help="构建和安装 ESP32-C3 固件", no_args_is_help=True)
app.add_typer(firmware, name="firmware")


def run_idf(idf_path: Path | None, arguments: list[str]) -> None:
    if idf_path is None or not (idf_path / "export.sh").is_file():
        raise typer.BadParameter("请通过 --idf-path 或 IDF_PATH 指定 ESP-IDF 6.0.2 目录")
    # Pass paths as positional arguments, never interpolate user input into shell code.
    result = subprocess.run([
        "bash", "-c", 'source "$1/export.sh" >/dev/null && shift && idf.py "$@"',
        "limivia-idf", str(idf_path.resolve()), "-C", str(FIRMWARE), *arguments,
    ], cwd=ROOT, env=os.environ.copy(), check=False)
    if result.returncode:
        raise typer.Exit(result.returncode)


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
    uvicorn.run("limivia.web.app:app", host=host, port=port)


@app.command()
def doctor() -> None:
    """显示开发环境及 USB 设备，不占用串口。"""
    for name in ("poetry", "pnpm", "cmake", "ninja"):
        logger.info("%s: %s", name, shutil.which(name) or "未找到")
    logger.info("IDF_PATH: %s", os.environ.get("IDF_PATH", "未设置"))
    logger.info("前端构建: %s", (WEB_DIST / "index.html").exists())
    for port in list_ports.comports():
        logger.info("串口 %s | %s | %s", port.device, port.description, port.serial_number)


@firmware.command()
def build(
    idf_path: Path | None = typer.Option(None, envvar="IDF_PATH", help="ESP-IDF 6.0.2 目录"),
) -> None:
    """编译专用固件。"""
    run_idf(idf_path, ["build"])


@firmware.command()
def flash(
    port: str = typer.Option(..., "--port", "-p", envvar="LIMIVIA_SERIAL_PORT", help="目标 USB 串口"),
    idf_path: Path | None = typer.Option(None, envvar="IDF_PATH", help="ESP-IDF 6.0.2 目录"),
) -> None:
    """构建并烧录，覆盖目标板现有固件。请先在网页断开 USB。"""
    run_idf(idf_path, ["-p", port, "flash"])


if __name__ == "__main__":
    app()
