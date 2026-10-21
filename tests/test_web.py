from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from limivia.commands.app import app as cli
from limivia.web.app import create_app


@pytest.fixture()
def client(tmp_path: Path):
    (tmp_path / "index.html").write_text("<!doctype html><title>LIMIVIA</title>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log('limivia')")
    with TestClient(create_app(tmp_path)) as instance:
        yield instance


def test_serving_and_spa(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/info").json()["protocol"] == 1
    assert client.get("/openapi.json").json()["info"]["title"] == "LIMIVIA"
    assert client.get("/docs").status_code == 200
    assert client.get("/").status_code == 200
    assert "LIMIVIA" in client.get("/experiments/adc", headers={"accept": "text/html"}).text
    assert "console.log" in client.get("/assets/app.js").text
    assert client.get("/assets/missing.js", headers={"accept": "text/html"}).status_code == 404


@pytest.mark.parametrize("accept", ["application/json", "text/html"])
@pytest.mark.parametrize("path", ["/api", "/api/not-real"])
def test_unknown_api_never_falls_back(client, accept, path):
    for method in ("get", "head"):
        response = getattr(client, method)(path, headers={"accept": accept})
        assert response.status_code == 404
        assert "application/json" in response.headers["content-type"]


def test_missing_dist_is_actionable(tmp_path):
    with pytest.raises(RuntimeError, match="pnpm --dir src/web run build"):
        create_app(tmp_path / "missing")


def test_cli_reports_environment():
    result = CliRunner().invoke(cli, ["doctor"])
    assert result.exit_code == 0
