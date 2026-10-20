"""True/False game skeleton (not active yet).

Not registered in the game registry and not wired to handlers. Provides the
interface for a future implementation.
"""

from __future__ import annotations

from app.constants import GameType
from app.exceptions import DomainError
from app.games.base_game import BaseGame
from app.models import QuestionRecord


class TrueFalseGame(BaseGame):
    """Placeholder strategy for a true/false game."""

    @property
    def game_type(self) -> GameType:
        return GameType.TRUE_FALSE

    def validate_question(self, question: QuestionRecord) -> None:
        raise DomainError("لعبة صحيح/خطأ غير مفعّلة بعد.")

    def normalize_answer(self, answer: str) -> str:
        raise DomainError("لعبة صحيح/خطأ غير مفعّلة بعد.")

    def check_answer(self, submitted_answer: str, question: QuestionRecord) -> bool:
        raise DomainError("لعبة صحيح/خطأ غير مفعّلة بعد.")

    def render_question(self, question: QuestionRecord) -> str:
        raise DomainError("لعبة صحيح/خطأ غير مفعّلة بعد.")
