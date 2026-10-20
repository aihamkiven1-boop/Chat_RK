"""Repository for per-event scores and group member aggregates."""

from __future__ import annotations

import sqlite3
from typing import Optional

from app.database import Database
from app.models import LeaderboardEntry, ScoreRecord


class ScoreRepository:
    """Persistence for event_scores and group_members aggregates.

    ``first_correct_count`` counts the number of questions where the user was
    the fastest correct answerer. The timestamp of that first correct answer is
    stored in the answers table and used as a tie-breaker.
    """

    def __init__(self, db: Database) -> None:
        self._db = db

    def _row_to_score(self, row: sqlite3.Row) -> ScoreRecord:
        return ScoreRecord(
            event_id=row["event_id"],
            chat_id=row["chat_id"],
            user_id=row["user_id"],
            points=row["points"],
            correct_answers=row["correct_answers"],
            first_correct_count=row["first_correct_count"],
            updated_at=row["updated_at"],
        )

    def apply_answer_transaction(
        self,
        conn: sqlite3.Connection,
        event_id: int,
        chat_id: int,
        user_id: int,
        points: int,
        is_correct: bool,
        is_first_correct: bool,
        updated_at: str,
    ) -> None:
        """Update event scores and group member totals inside a transaction.

        ``is_first_correct`` is resolved by the answer service using the run's
        earlier-correct-answer count before calling this method.
        """
        correct_delta = 1 if is_correct else 0
        first_correct_delta = 1 if is_first_correct else 0
        conn.execute(
            "INSERT INTO event_scores"
            " (event_id, chat_id, user_id, points, correct_answers,"
            "  first_correct_count, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(event_id, user_id) DO UPDATE SET"
            " points = event_scores.points + excluded.points,"
            " correct_answers = event_scores.correct_answers + excluded.correct_answers,"
            " first_correct_count = event_scores.first_correct_count + excluded.first_correct_count,"
            " updated_at = excluded.updated_at",
            (event_id, chat_id, user_id, points, correct_delta, first_correct_delta, updated_at),
        )
        conn.execute(
            "INSERT INTO group_members"
            " (chat_id, user_id, total_points, wins, participation_count, joined_at, updated_at)"
            " VALUES (?, ?, ?, 0, 0, ?, ?)"
            " ON CONFLICT(chat_id, user_id) DO UPDATE SET"
            " total_points = group_members.total_points + excluded.total_points,"
            " updated_at = excluded.updated_at",
            (chat_id, user_id, points, updated_at, updated_at),
        )

    def get_score(self, event_id: int, user_id: int) -> Optional[ScoreRecord]:
        """Fetch the score of a user in an event."""
        row = self._db.execute(
            "SELECT * FROM event_scores WHERE event_id = ? AND user_id = ?",
            (event_id, user_id),
        ).fetchone()
        return self._row_to_score(row) if row is not None else None

    def leaderboard_for_event(self, event_id: int) -> list[LeaderboardEntry]:
        """Return the leaderboard of an event with tie-breaking.

        Tie-break order: points desc, correct_answers desc, first correct
        answer time asc, user_id asc.
        """
        rows = self._db.execute(
            "SELECT s.event_id, s.chat_id, s.user_id, s.points, s.correct_answers,"
            "       COALESCE(u.username, '') AS username, u.first_name,"
            "       MIN(CASE WHEN a.is_correct = 1 THEN a.answered_at END) AS first_answer_at"
            "  FROM event_scores s"
            "  JOIN users u ON u.user_id = s.user_id"
            "  LEFT JOIN answers a ON a.event_id = s.event_id AND a.user_id = s.user_id"
            " WHERE s.event_id = ?"
            " GROUP BY s.user_id, s.points, s.correct_answers, u.username, u.first_name"
            " ORDER BY s.points DESC, s.correct_answers DESC,"
            "          first_answer_at ASC, s.user_id ASC",
            (event_id,),
        ).fetchall()
        entries = [
            LeaderboardEntry(
                rank=rank,
                user_id=row["user_id"],
                username=row["username"] or None,
                first_name=row["first_name"],
                points=row["points"],
                correct_answers=row["correct_answers"],
                first_answer_at=row["first_answer_at"],
            )
            for rank, row in enumerate(rows, start=1)
        ]
        return entries

    def group_leaderboard(self, chat_id: int, limit: int = 10) -> list[LeaderboardEntry]:
        """Return the all-time group leaderboard."""
        rows = self._db.execute(
            "SELECT m.chat_id, m.user_id, m.total_points AS points,"
            "       COALESCE(u.username, '') AS username, u.first_name,"
            "       0 AS correct_answers, NULL AS first_answer_at"
            "  FROM group_members m"
            "  JOIN users u ON u.user_id = m.user_id"
            " WHERE m.chat_id = ? AND m.total_points > 0"
            " ORDER BY m.total_points DESC, m.wins DESC, m.user_id ASC"
            " LIMIT ?",
            (chat_id, limit),
        ).fetchall()
        return [
            LeaderboardEntry(
                rank=rank,
                user_id=row["user_id"],
                username=row["username"] or None,
                first_name=row["first_name"],
                points=row["points"],
                correct_answers=row["correct_answers"],
                first_answer_at=None,
            )
            for rank, row in enumerate(rows, start=1)
        ]

    def group_member_rank(self, chat_id: int, user_id: int) -> Optional[int]:
        """Return the rank of a member in the all-time group leaderboard."""
        row = self._db.execute(
            "SELECT rank FROM ("
            "  SELECT user_id, RANK() OVER (ORDER BY total_points DESC, wins DESC, user_id ASC) AS rank"
            "  FROM group_members WHERE chat_id = ?"
            ") WHERE user_id = ?",
            (chat_id, user_id),
        ).fetchone()
        return int(row["rank"]) if row is not None else None

    def group_member_points(self, chat_id: int, user_id: int) -> int:
        """Return the total points of a member in a group."""
        row = self._db.execute(
            "SELECT total_points FROM group_members WHERE chat_id = ? AND user_id = ?",
            (chat_id, user_id),
        ).fetchone()
        return int(row["total_points"]) if row is not None else 0

    def record_win(self, event_id: int, chat_id: int, user_id: int, now: str) -> None:
        """Increment the win counter of the winner in a group."""
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO group_members"
                " (chat_id, user_id, total_points, wins, participation_count, joined_at, updated_at)"
                " VALUES (?, ?, 0, 1, 0, ?, ?)"
                " ON CONFLICT(chat_id, user_id) DO UPDATE SET"
                " wins = group_members.wins + 1, updated_at = excluded.updated_at",
                (chat_id, user_id, now, now),
            )
