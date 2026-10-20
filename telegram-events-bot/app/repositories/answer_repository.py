"""Repository for answer records."""

from __future__ import annotations

import sqlite3
from typing import Optional

from app.database import Database
from app.models import AnswerRecord


class AnswerRepository:
    """Persistence for submitted answers."""

    def __init__(self, db: Database) -> None:
        self._db = db

    def _row_to_model(self, row: sqlite3.Row) -> AnswerRecord:
        return AnswerRecord(
            id=row["id"],
            event_id=row["event_id"],
            question_id=row["question_id"],
            question_run_id=row["question_run_id"],
            chat_id=row["chat_id"],
            user_id=row["user_id"],
            answer_text=row["answer_text"],
            normalized_answer=row["normalized_answer"],
            is_correct=bool(row["is_correct"]),
            points=row["points"],
            answered_at=row["answered_at"],
        )

    def create(
        self,
        conn: sqlite3.Connection,
        event_id: int,
        question_id: int,
        question_run_id: int,
        chat_id: int,
        user_id: int,
        answer_text: str,
        normalized_answer: str,
        is_correct: bool,
        points: int,
        answered_at: str,
    ) -> AnswerRecord:
        """Insert an answer inside the caller's transaction.

        Duplicates are rejected by the UNIQUE (question_run_id, user_id)
        constraint and surface as ``sqlite3.IntegrityError``.
        """
        cursor = conn.execute(
            "INSERT INTO answers"
            " (event_id, question_id, question_run_id, chat_id, user_id,"
            "  answer_text, normalized_answer, is_correct, points, answered_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                event_id,
                question_id,
                question_run_id,
                chat_id,
                user_id,
                answer_text,
                normalized_answer,
                int(is_correct),
                points,
                answered_at,
            ),
        )
        answer_id = cursor.lastrowid
        return self.get(answer_id)  # type: ignore[return-value]

    def get(self, answer_id: int) -> Optional[AnswerRecord]:
        """Fetch an answer by id."""
        row = self._db.execute(
            "SELECT * FROM answers WHERE id = ?", (answer_id,)
        ).fetchone()
        return self._row_to_model(row) if row is not None else None

    def exists_for_user(self, question_run_id: int, user_id: int) -> bool:
        """Return True when the user already answered in this run."""
        row = self._db.execute(
            "SELECT 1 FROM answers WHERE question_run_id = ? AND user_id = ? LIMIT 1",
            (question_run_id, user_id),
        ).fetchone()
        return row is not None

    def count_for_run(self, question_run_id: int) -> int:
        """Count answers submitted for a question run."""
        row = self._db.execute(
            "SELECT COUNT(*) AS c FROM answers WHERE question_run_id = ?",
            (question_run_id,),
        ).fetchone()
        return int(row["c"])

    def count_correct_for_run(self, question_run_id: int) -> int:
        """Count correct answers already stored for a question run.

        Used within the answer transaction to decide first-correct status.
        """
        row = self._db.execute(
            "SELECT COUNT(*) AS c FROM answers"
            " WHERE question_run_id = ? AND is_correct = 1",
            (question_run_id,),
        ).fetchone()
        return int(row["c"])

    def get_for_run(self, question_run_id: int) -> list[AnswerRecord]:
        """Return all answers of a question run ordered by submission time."""
        rows = self._db.execute(
            "SELECT * FROM answers WHERE question_run_id = ? ORDER BY id",
            (question_run_id,),
        ).fetchall()
        return [self._row_to_model(row) for row in rows]

    def get_first_correct_answer(self, question_run_id: int) -> Optional[AnswerRecord]:
        """Return the first correct answer in a run, if any."""
        row = self._db.execute(
            "SELECT * FROM answers WHERE question_run_id = ? AND is_correct = 1"
            " ORDER BY id LIMIT 1",
            (question_run_id,),
        ).fetchone()
        return self._row_to_model(row) if row is not None else None

    def count_correct_for_event(self, event_id: int, user_id: int) -> int:
        """Count correct answers of a user within an event."""
        row = self._db.execute(
            "SELECT COUNT(*) AS c FROM answers"
            " WHERE event_id = ? AND user_id = ? AND is_correct = 1",
            (event_id, user_id),
        ).fetchone()
        return int(row["c"])
