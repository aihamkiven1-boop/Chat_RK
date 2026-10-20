"""Repository for group records."""

from __future__ import annotations

import sqlite3
from typing import Optional

from app.database import Database
from app.models import GroupRecord


class GroupRepository:
    """Persistence for Telegram groups."""

    def __init__(self, db: Database) -> None:
        self._db = db

    def _row_to_model(self, row: sqlite3.Row) -> GroupRecord:
        return GroupRecord(
            chat_id=row["chat_id"],
            title=row["title"],
            is_active=bool(row["is_active"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def upsert(self, chat_id: int, title: str, now: str) -> GroupRecord:
        """Insert or update a group row."""
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO groups (chat_id, title, is_active, created_at, updated_at)"
                " VALUES (?, ?, 1, ?, ?)"
                " ON CONFLICT(chat_id) DO UPDATE SET"
                " title = excluded.title, updated_at = excluded.updated_at",
                (chat_id, title, now, now),
            )
        return self.get(chat_id, now)  # type: ignore[return-value]

    def get(self, chat_id: int, now: Optional[str] = None) -> Optional[GroupRecord]:
        """Fetch a group by chat id."""
        row = self._db.execute(
            "SELECT * FROM groups WHERE chat_id = ?", (chat_id,)
        ).fetchone()
        if row is None:
            return None
        if not row["is_active"] and now is not None:
            with self._db.transaction() as conn:
                conn.execute(
                    "UPDATE groups SET is_active = 1, updated_at = ? WHERE chat_id = ?",
                    (now, chat_id),
                )
            row = self._db.execute(
                "SELECT * FROM groups WHERE chat_id = ?", (chat_id,)
            ).fetchone()
        return self._row_to_model(row)

    def deactivate(self, chat_id: int, now: str) -> None:
        """Mark a group as inactive."""
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE groups SET is_active = 0, updated_at = ? WHERE chat_id = ?",
                (now, chat_id),
            )
