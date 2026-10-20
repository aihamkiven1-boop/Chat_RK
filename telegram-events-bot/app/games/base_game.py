"""Abstract base class for game strategies."""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.constants import GameType
from app.models import QuestionRecord


class BaseGame(ABC):
    """Interface every game must implement.

    A game is pure: it validates questions, normalizes answers, checks answers,
    and renders a question for display. It has no database or Telegram access.
    """

    @property
    @abstractmethod
    def game_type(self) -> GameType:
        """Return the game type identifier."""

    @abstractmethod
    def validate_question(self, question: QuestionRecord) -> None:
        """Validate that a question is well-formed for this game.

        Raises ``app.exceptions.DomainError`` when invalid.
        """

    @abstractmethod
    def normalize_answer(self, answer: str) -> str:
        """Normalize an answer for comparison."""

    @abstractmethod
    def check_answer(self, submitted_answer: str, question: QuestionRecord) -> bool:
        """Return True when the submitted answer matches the question's answer."""

    @abstractmethod
    def render_question(self, question: QuestionRecord) -> str:
        """Render a question as user-facing text."""
