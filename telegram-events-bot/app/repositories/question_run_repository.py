"""Repository for question runs."""

from __future__ import annotations

import sqlite3
from typing import Optional

from app.constants import QuestionRunStatus
from app.database import Database
from app.exceptions import EventConflictError
from app.models import QuestionRunRecord


class QuestionRunRepository:
    """Persistence for question runs.

    A single ACTIVE run per event is enforced by the partial unique index
    ``uq_question_runs_one_active_per_event``.
    """

    def __init__(self, db: Database) -> None:
        self._db = db

    def _row_to_model(self, row: sqlite3.Row) -> QuestionRunRecord:
        return QuestionRunRecord(
            id=row["id"],
            event_id=row["event_id"],
            question_id=row["question_id"],
            status=row["status"],
            started_at=row["started_at"],
            ends_at=row["ends_at"],
            closed_at=row["closed_at"],
            bot_message_id=row["bot_message_id"],
            created_at=row["created_at"],
        )

    def create_active(
        self,
        event_id: int,
        question_id: int,
        started_at: str,
        ends_at: str,
        now: str,
        bot_message_id: Optional[int] = None,
    ) -> QuestionRunRecord:
        """Create a new ACTIVE question run for an event."""
        try:
            with self._db.transaction() as conn:
                cursor = conn.execute(
                    "INSERT INTO question_runs"
                    " (event_id, question_id, status, started_at, ends_at, closed_at,"
                    "  bot_message_id, created_at)"
                    " VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
                    (
                        event_id,
                        question_id,
                        QuestionRunStatus.ACTIVE.value,
                        started_at,
                        ends_at,
                        bot_message_id,
                        now,
                    ),
                )
                run_id = cursor.lastrowid
        except sqlite3.IntegrityError as exc:
            if "UNIQUE constraint failed: question_runs.event_id" in str(exc):
                raise EventConflictError(
                    "يوجد سؤال نشط بالفعل لهذه الفعالية."
                ) from exc
            raise
        return self.get(run_id)  # type: ignore[return-value]

    def get(self, run_id: int) -> Optional[QuestionRunRecord]:
        """Fetch a question run by id."""
        row = self._db.execute(
            "SELECT * FROM question_runs WHERE id = ?", (run_id,)
        ).fetchone()
        return self._row_to_model(row) if row is not None else None

    def get_active_for_event(self, event_id: int) -> Optional[QuestionRunRecord]:
        """Return the ACTIVE run of an event, if any."""
        row = self._db.execute(
            "SELECT * FROM question_runs"
            " WHERE event_id = ? AND status = 'ACTIVE' ORDER BY id DESC LIMIT 1",
            (event_id,),
        ).fetchone()
        return self._row_to_model(row) if row is not None else None

    def get_for_question(self, event_id: int, question_id: int) -> list[QuestionRunRecord]:
        """Return all runs of a question within an event."""
        rows = self._db.execute(
            "SELECT * FROM question_runs WHERE event_id = ? AND question_id = ?"
            " ORDER BY id",
            (event_id, question_id),
        ).fetchall()
        return [self._row_to_model(row) for row in rows]

    def get_active_runs(self) -> list[QuestionRunRecord]:
        """Return all ACTIVE runs across events (used by recovery)."""
        rows = self._db.execute(
            "SELECT * FROM question_runs WHERE status = 'ACTIVE' ORDER BY id"
        ).fetchall()
        return [self._row_to_model(row) for row in rows]

    def close(self, run_id: int, closed_at: str) -> bool:
        """Idempotently close an ACTIVE run; returns True when it was closed."""
        with self._db.transaction() as conn:
            cursor = conn.execute(
                "UPDATE question_runs SET status = 'CLOSED', closed_at = ?"
                " WHERE id = ? AND status = 'ACTIVE'",
                (closed_at, run_id),
            )
        return cursor.rowcount > 0

    def update_bot_message_id(self, run_id: int, bot_message_id: int) -> None:
        """Record the Telegram message id of the posted question."""
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE question_runs SET bot_message_id = ? WHERE id = ?",
                (bot_message_id, run_id),
            )

    def is_expired(self, run: QuestionRunRecord, now_iso: str) -> bool:
        """Return True when the run's end time has passed.

        ISO-8601 UTC strings with the same format compare correctly as strings.
        """
        return now_iso >= run.ends_at
