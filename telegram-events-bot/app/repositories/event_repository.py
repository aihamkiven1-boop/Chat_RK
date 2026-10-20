"""Repository for event records and state transitions."""

from __future__ import annotations

import sqlite3
from typing import Optional

from app.constants import EventStatus
from app.database import Database
from app.exceptions import EventConflictError, InvalidStateTransitionError, NotFoundError
from app.models import EventRecord


class EventRepository:
    """Persistence for events and their lifecycle transitions.

    The active-event uniqueness per group is enforced by the partial unique
    index ``uq_events_one_active_per_group``; any conflicting insert surfaces
    as an ``IntegrityError`` here and is mapped to ``EventConflictError``.
    """

    def __init__(self, db: Database) -> None:
        self._db = db

    def _row_to_model(self, row: sqlite3.Row) -> EventRecord:
        return EventRecord(
            id=row["id"],
            chat_id=row["chat_id"],
            created_by=row["created_by"],
            game_type=row["game_type"],
            title=row["title"],
            status=row["status"],
            total_questions=row["total_questions"],
            current_question_index=row["current_question_index"],
            active_question_id=row["active_question_id"],
            created_at=row["created_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            cancelled_at=row["cancelled_at"],
            failure_reason=row["failure_reason"],
        )

    def create(
        self,
        chat_id: int,
        created_by: int,
        game_type: str,
        title: str,
        total_questions: int,
        status: EventStatus,
        now: str,
    ) -> EventRecord:
        """Create a new event; raises EventConflictError if an active one exists."""
        try:
            with self._db.transaction() as conn:
                cursor = conn.execute(
                    "INSERT INTO events"
                    " (chat_id, created_by, game_type, title, status, total_questions,"
                    "  current_question_index, active_question_id, created_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)",
                    (
                        chat_id,
                        created_by,
                        game_type,
                        title,
                        status.value,
                        total_questions,
                        now,
                    ),
                )
                event_id = cursor.lastrowid
        except sqlite3.IntegrityError as exc:
            if "UNIQUE constraint failed: events.chat_id" in str(exc):
                raise EventConflictError(
                    "يوجد فعالية نشطة في هذه المجموعة. أنهِ الفعالية الحالية أولًا."
                ) from exc
            raise
        return self.get(event_id, chat_id)  # type: ignore[return-value]

    def get(self, event_id: int, chat_id: Optional[int] = None) -> Optional[EventRecord]:
        """Fetch an event by id, optionally scoped to a group."""
        if chat_id is None:
            row = self._db.execute(
                "SELECT * FROM events WHERE id = ?", (event_id,)
            ).fetchone()
        else:
            row = self._db.execute(
                "SELECT * FROM events WHERE id = ? AND chat_id = ?",
                (event_id, chat_id),
            ).fetchone()
        return self._row_to_model(row) if row is not None else None

    def get_required(self, event_id: int, chat_id: Optional[int] = None) -> EventRecord:
        """Fetch an event or raise NotFoundError."""
        event = self.get(event_id, chat_id)
        if event is None:
            raise NotFoundError("الفعالية غير موجودة.")
        return event

    def get_active_for_chat(self, chat_id: int) -> Optional[EventRecord]:
        """Return the active event for a group, if any."""
        row = self._db.execute(
            "SELECT * FROM events WHERE chat_id = ? AND status IN ('DRAFT','REGISTRATION','RUNNING')"
            " ORDER BY id DESC LIMIT 1",
            (chat_id,),
        ).fetchone()
        return self._row_to_model(row) if row is not None else None

    def get_running_events(self) -> list[EventRecord]:
        """Return all events currently in RUNNING status."""
        rows = self._db.execute(
            "SELECT * FROM events WHERE status = 'RUNNING' ORDER BY id"
        ).fetchall()
        return [self._row_to_model(row) for row in rows]

    def get_by_status(self, status: EventStatus) -> list[EventRecord]:
        """Return all events with the given status."""
        rows = self._db.execute(
            "SELECT * FROM events WHERE status = ? ORDER BY id", (status.value,)
        ).fetchall()
        return [self._row_to_model(row) for row in rows]

    def transition(
        self,
        event_id: int,
        from_status: EventStatus,
        to_status: EventStatus,
        now: str,
        chat_id: Optional[int] = None,
    ) -> EventRecord:
        """Atomically transition an event to a new status.

        Uses an optimistic compare-and-swap inside a transaction so concurrent
        transitions cannot race.
        """
        event = self.get_required(event_id, chat_id)
        if event.status != from_status.value:
            raise InvalidStateTransitionError(
                f"لا يمكن الانتقال من الحالة {event.status} إلى {to_status.value}."
            )
        with self._db.transaction() as conn:
            cursor = conn.execute(
                "UPDATE events SET status = ? WHERE id = ? AND status = ?",
                (to_status.value, event_id, from_status.value),
            )
            updated = cursor.rowcount
        if updated == 0:
            raise InvalidStateTransitionError(
                f"لا يمكن الانتقال من الحالة {from_status.value} إلى {to_status.value}."
            )
        return self.get_required(event_id, chat_id)

    def mark_started(self, event_id: int, now: str) -> None:
        """Set an event to RUNNING and record the start time."""
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE events SET status = ?, started_at = ? WHERE id = ?",
                (EventStatus.RUNNING.value, now, event_id),
            )

    def mark_finished(self, event_id: int, now: str) -> None:
        """Set an event to FINISHED and record the finish time."""
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE events SET status = ?, finished_at = ? WHERE id = ?",
                (EventStatus.FINISHED.value, now, event_id),
            )

    def mark_cancelled(self, event_id: int, now: str) -> None:
        """Set an event to CANCELLED and record the cancel time."""
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE events SET status = ?, cancelled_at = ? WHERE id = ?",
                (EventStatus.CANCELLED.value, now, event_id),
            )

    def mark_failed(self, event_id: int, reason: str, now: str) -> None:
        """Move an event to FAILED with a failure reason."""
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE events SET status = ?, failure_reason = ? WHERE id = ?",
                (EventStatus.FAILED.value, reason, event_id),
            )

    def update_question_pointer(
        self,
        event_id: int,
        current_question_index: int,
        active_question_id: Optional[int],
    ) -> None:
        """Update the question pointer of an event."""
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE events SET current_question_index = ?, active_question_id = ?"
                " WHERE id = ?",
                (current_question_index, active_question_id, event_id),
            )

    def has_active_event(self, chat_id: int) -> bool:
        """Return True when the group already has an active event."""
        return self.get_active_for_chat(chat_id) is not None

    def count_active(self, chat_id: int) -> int:
        """Count active events for a group (debugging helper)."""
        row = self._db.execute(
            "SELECT COUNT(*) AS c FROM events"
            " WHERE chat_id = ? AND status IN ('DRAFT','REGISTRATION','RUNNING')",
            (chat_id,),
        ).fetchone()
        return int(row["c"])

    @staticmethod
    def is_active(event: EventRecord) -> bool:
        """Return True if the event status is active."""
        return EventStatus(event.status) in EventStatus.active_statuses()

    def active_question_ends_at(self, event: EventRecord) -> Optional[str]:
        """Return ends_at of the active question run for an event."""
        if event.active_question_id is None:
            return None
        row = self._db.execute(
            "SELECT ends_at FROM question_runs"
            " WHERE event_id = ? AND question_id = ? AND status = 'ACTIVE'"
            " ORDER BY id DESC LIMIT 1",
            (event.id, event.active_question_id),
        ).fetchone()
        return row["ends_at"] if row is not None else None
