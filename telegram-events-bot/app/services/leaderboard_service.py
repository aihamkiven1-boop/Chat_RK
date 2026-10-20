"""Leaderboard and ranking service."""

from __future__ import annotations

from app.models import LeaderboardEntry
from app.repositories.event_repository import EventRepository
from app.repositories.question_run_repository import QuestionRunRepository
from app.repositories.score_repository import ScoreRepository


class LeaderboardService:
    """Reads leaderboards with deterministic tie-breaking."""

    def __init__(
        self,
        event_repository: EventRepository,
        score_repository: ScoreRepository,
        run_repository: QuestionRunRepository,
    ) -> None:
        self._events = event_repository
        self._scores = score_repository
        self._runs = run_repository

    def event_leaderboard(self, event_id: int, chat_id: int) -> list[LeaderboardEntry]:
        """Return the leaderboard for a specific event.

        Tie-break: points desc, correct_answers desc, first-correct time asc,
        user_id asc.
        """
        self._events.get_required(event_id, chat_id)
        return self._scores.leaderboard_for_event(event_id)

    def group_leaderboard(self, chat_id: int, limit: int = 10) -> list[LeaderboardEntry]:
        """Return the all-time group leaderboard."""
        return self._scores.group_leaderboard(chat_id, limit=limit)

    def member_rank(self, chat_id: int, user_id: int) -> int | None:
        """Return the all-time rank of a member in the group."""
        return self._scores.group_member_rank(chat_id, user_id)

    def member_points(self, chat_id: int, user_id: int) -> int:
        """Return the all-time total points of a member in the group."""
        return self._scores.group_member_points(chat_id, user_id)

    def event_winner(self, event_id: int) -> LeaderboardEntry | None:
        """Return the winner of an event, if any participant has points."""
        entries = self._scores.leaderboard_for_event(event_id)
        return entries[0] if entries else None

    def current_active_event_leaderboard(self, chat_id: int) -> list[LeaderboardEntry]:
        """Return the leaderboard of the active event for a group."""
        event = self._events.get_active_for_chat(chat_id)
        if event is None:
            return []
        return self._scores.leaderboard_for_event(event.id)
