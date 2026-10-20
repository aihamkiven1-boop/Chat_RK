"""Repository for event participants and group membership."""

from __future__ import annotations

from typing import Optional

from app.database import Database
from app.models import ParticipantRecord


class ParticipantRepository:
    """Persistence for event participants."""

    def __init__(self, db: Database) -> None:
        self._db = db

    def add(
        self,
        conn,
        event_id: int,
        chat_id: int,
        user_id: int,
        joined_at: str,
    ) -> None:
        """Add a user to event participants inside a transaction.

        ``participation_count`` is incremented only the first time a user joins
        an event in the group.
        """
        cursor = conn.execute(
            "INSERT OR IGNORE INTO event_participants (event_id, user_id, chat_id, joined_at)"
            " VALUES (?, ?, ?, ?)",
            (event_id, user_id, chat_id, joined_at),
        )
        inserted = cursor.rowcount > 0
        conn.execute(
            "INSERT INTO group_members"
            " (chat_id, user_id, total_points, wins, participation_count, joined_at, updated_at)"
            " VALUES (?, ?, 0, 0, ?, ?, ?)"
            " ON CONFLICT(chat_id, user_id) DO UPDATE SET"
            " participation_count = group_members.participation_count + ?,"
            " updated_at = excluded.updated_at",
            (chat_id, user_id, 1 if inserted else 0, joined_at, joined_at, 1 if inserted else 0),
        )

    def get(self, event_id: int, user_id: int) -> Optional[ParticipantRecord]:
        """Fetch a participant record."""
        row = self._db.execute(
            "SELECT * FROM event_participants WHERE event_id = ? AND user_id = ?",
            (event_id, user_id),
        ).fetchone()
        if row is None:
            return None
        return ParticipantRecord(
            event_id=row["event_id"],
            user_id=row["user_id"],
            chat_id=row["chat_id"],
            joined_at=row["joined_at"],
        )

    def count_for_event(self, event_id: int) -> int:
        """Count participants of an event."""
        row = self._db.execute(
            "SELECT COUNT(*) AS c FROM event_participants WHERE event_id = ?",
            (event_id,),
        ).fetchone()
        return int(row["c"])

    def list_for_event(self, event_id: int) -> list[ParticipantRecord]:
        """List participants of an event."""
        rows = self._db.execute(
            "SELECT * FROM event_participants WHERE event_id = ? ORDER BY joined_at",
            (event_id,),
        ).fetchall()
        return [
            ParticipantRecord(
                event_id=row["event_id"],
                user_id=row["user_id"],
                chat_id=row["chat_id"],
                joined_at=row["joined_at"],
            )
            for row in rows
        ]
