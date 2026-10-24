"""有界、脱敏的操作历史；设备句柄不因持久化而获得跨 boot 效力。"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

TERMINAL = {"completed", "failed", "cancelled", "unknown"}


class OperationStore:
    def __init__(self, path: Path | str):
        if isinstance(path, Path):
            path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS operations "
            "(id TEXT PRIMARY KEY, updated REAL NOT NULL, terminal INTEGER NOT NULL, data TEXT)"
        )
        self.db.execute("PRAGMA user_version=1")
        self.db.execute("CREATE INDEX IF NOT EXISTS operations_recent ON operations(updated DESC)")
        self.db.execute(
            "CREATE INDEX IF NOT EXISTS operations_finished ON operations(terminal, updated DESC)"
        )
        self.prune()

    def save(self, task: dict) -> None:
        previous = self.db.execute(
            "SELECT terminal FROM operations WHERE id=?", (task["id"],)
        ).fetchone()
        self.finished_count += int(task["status"] in TERMINAL) - (previous[0] if previous else 0)
        self.db.execute(
            "INSERT OR REPLACE INTO operations VALUES (?, ?, ?, ?)",
            (
                task["id"],
                task["updated"],
                task["status"] in TERMINAL,
                json.dumps(task, ensure_ascii=False, allow_nan=False),
            ),
        )
        self.db.commit()
        if self.finished_count > 10000 or time.time() >= self.next_prune:
            self.prune()

    def get(self, operation_id: str) -> dict | None:
        row = self.db.execute("SELECT data FROM operations WHERE id=?", (operation_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def recent(self, limit: int = 100, offset: int = 0) -> list[dict]:
        return [
            json.loads(row[0])
            for row in self.db.execute(
                "SELECT data FROM operations ORDER BY updated DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        ]

    def interrupted(self) -> list[dict]:
        return [
            json.loads(row[0])
            for row in self.db.execute("SELECT data FROM operations WHERE terminal=0")
        ]

    def prune(self) -> None:
        self.db.execute(
            "DELETE FROM operations WHERE terminal=1 AND (updated<? OR id IN "
            "(SELECT id FROM operations WHERE terminal=1 ORDER BY updated DESC LIMIT -1 OFFSET 10000))",
            (time.time() - 30 * 86400,),
        )
        self.db.commit()
        self.finished_count = self.db.execute(
            "SELECT COUNT(*) FROM operations WHERE terminal=1"
        ).fetchone()[0]
        self.next_prune = time.time() + 3600

    def close(self) -> None:
        self.prune()
        self.db.close()
