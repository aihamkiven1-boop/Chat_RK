"""Repository for user records."""

from __future__ import annotations

import sqlite3
from typing import Optional

from app.database import Database
from app.models import UserRecord


class UserRepository:
    """Persistence for Telegram users."""

    def __init__(self, db: Database) -> None:
        self._db = db

    def _row_to_model(self, row: sqlite3.Row) -> UserRecord:
        return UserRecord(
            user_id=row["user_id"],
            username=row["username"],
            first_name=row["first_name"],
            last_name=row["last_name"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def upsert(
        self,
        user_id: int,
        first_name: str,
        username: Optional[str],
        last_name: Optional[str],
        now: str,
    ) -> UserRecord:
        """Insert or update a user row."""
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO users (user_id, username, first_name, last_name, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?)"
                " ON CONFLICT(user_id) DO UPDATE SET"
                " username = COALESCE(excluded.username, users.username),"
                " first_name = excluded.first_name,"
                " last_name = COALESCE(excluded.last_name, users.last_name),"
                " updated_at = excluded.updated_at",
                (user_id, username, first_name, last_name, now, now),
            )
        return self.get(user_id)  # type: ignore[return-value]

    def get(self, user_id: int) -> Optional[UserRecord]:
        """Fetch a user by id."""
        row = self._db.execute(
            "SELECT * FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        return self._row_to_model(row) if row is not None else None

    def exists(self, user_id: int) -> bool:
        """Return True when the user exists."""
        return self.get(user_id) is not None
