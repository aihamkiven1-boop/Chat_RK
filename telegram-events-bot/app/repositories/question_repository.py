"""Repository for question records."""

from __future__ import annotations

import sqlite3
from typing import Optional

from app.database import Database
from app.models import QuestionRecord


class QuestionRepository:
    """Persistence for questions."""

    def __init__(self, db: Database) -> None:
        self._db = db

    def _row_to_model(self, row: sqlite3.Row) -> QuestionRecord:
        return QuestionRecord(
            id=row["id"],
            event_id=row["event_id"],
            question_text=row["question_text"],
            correct_answer=row["correct_answer"],
            options_json=row["options_json"],
            base_points=row["base_points"],
            duration_seconds=row["duration_seconds"],
            order_number=row["order_number"],
            created_at=row["created_at"],
        )

    def create(
        self,
        event_id: int,
        question_text: str,
        correct_answer: str,
        order_number: int,
        now: str,
        options_json: Optional[str] = None,
        base_points: int = 100,
        duration_seconds: int = 15,
    ) -> QuestionRecord:
        """Create a question for an event."""
        with self._db.transaction() as conn:
            cursor = conn.execute(
                "INSERT INTO questions"
                " (event_id, question_text, correct_answer, options_json, base_points,"
                "  duration_seconds, order_number, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    event_id,
                    question_text,
                    correct_answer,
                    options_json,
                    base_points,
                    duration_seconds,
                    order_number,
                    now,
                ),
            )
            question_id = cursor.lastrowid
        return self.get(question_id)  # type: ignore[return-value]

    def get(self, question_id: int) -> Optional[QuestionRecord]:
        """Fetch a question by id."""
        row = self._db.execute(
            "SELECT * FROM questions WHERE id = ?", (question_id,)
        ).fetchone()
        return self._row_to_model(row) if row is not None else None

    def get_for_event(self, event_id: int) -> list[QuestionRecord]:
        """Fetch all questions of an event in order."""
        rows = self._db.execute(
            "SELECT * FROM questions WHERE event_id = ? ORDER BY order_number",
            (event_id,),
        ).fetchall()
        return [self._row_to_model(row) for row in rows]

    def get_by_order(self, event_id: int, order_number: int) -> Optional[QuestionRecord]:
        """Fetch a question by its position within the event."""
        row = self._db.execute(
            "SELECT * FROM questions WHERE event_id = ? AND order_number = ?",
            (event_id, order_number),
        ).fetchone()
        return self._row_to_model(row) if row is not None else None

    def count_for_event(self, event_id: int) -> int:
        """Count questions belonging to an event."""
        row = self._db.execute(
            "SELECT COUNT(*) AS c FROM questions WHERE event_id = ?", (event_id,)
        ).fetchone()
        return int(row["c"])
