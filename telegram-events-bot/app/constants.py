"""Enums and constant values used across the application."""

from __future__ import annotations

from enum import StrEnum


class EventStatus(StrEnum):
    """Lifecycle states of an event."""

    DRAFT = "DRAFT"
    REGISTRATION = "REGISTRATION"
    RUNNING = "RUNNING"
    FINISHED = "FINISHED"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"

    @classmethod
    def active_statuses(cls) -> tuple["EventStatus", ...]:
        """Statuses that count as an active event for a group."""
        return (cls.DRAFT, cls.REGISTRATION, cls.RUNNING)

    def is_active(self) -> bool:
        """True when the status represents an active event."""
        return self in self.active_statuses()


class QuestionRunStatus(StrEnum):
    """States of a single question run."""

    ACTIVE = "ACTIVE"
    CLOSED = "CLOSED"


class GameType(StrEnum):
    """Registered game types."""

    SPEED_QUIZ = "speed_quiz"
    TRUE_FALSE = "true_false"
    MULTIPLE_CHOICE = "multiple_choice"


class BotCommand(StrEnum):
    """Supported bot commands."""

    START = "start"
    HELP = "help"
    RULES = "rules"
    STATUS = "status"
    EVENT = "event"
    ADD_DEMO_QUESTIONS = "add_demo_questions"
    START_EVENT = "start_event"
    CANCEL_EVENT = "cancel_event"
    POINTS = "points"
    RANK = "rank"
    LEADERBOARD = "leaderboard"


# ---------------------------------------------------------------------------
# Scoring constants
# ---------------------------------------------------------------------------
BASE_POINTS = 100
MAX_SPEED_BONUS = 50
MAX_POINTS = BASE_POINTS + MAX_SPEED_BONUS
WRONG_ANSWER_POINTS = 0

# ---------------------------------------------------------------------------
# Timing defaults
# ---------------------------------------------------------------------------
DEFAULT_QUESTION_DURATION_SECONDS = 15
MIN_QUESTION_DURATION_SECONDS = 5
MAX_QUESTION_DURATION_SECONDS = 120

DEFAULT_QUESTIONS_PER_EVENT = 5
MAX_QUESTIONS_PER_EVENT = 20

# ---------------------------------------------------------------------------
# Runtime locks
# ---------------------------------------------------------------------------
LOCK_OWNER_PREFIX = "bot"
LOCK_TTL_SECONDS = 3600
