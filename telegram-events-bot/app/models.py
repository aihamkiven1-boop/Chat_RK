"""Typed data models for entities and operation results.

Plain dataclasses only; no ORM involved.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.constants import (
    BASE_POINTS,
    DEFAULT_QUESTION_DURATION_SECONDS,
)


@dataclass(frozen=True)
class GroupRecord:
    """A Telegram group tracked by the bot."""

    chat_id: int
    title: str
    is_active: bool
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class UserRecord:
    """A Telegram user tracked by the bot."""

    user_id: int
    first_name: str
    username: Optional[str]
    last_name: Optional[str]
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class EventRecord:
    """A quiz event."""

    id: int
    chat_id: int
    created_by: int
    game_type: str
    title: str
    status: str
    total_questions: int
    current_question_index: int
    active_question_id: Optional[int]
    created_at: str
    started_at: Optional[str]
    finished_at: Optional[str]
    cancelled_at: Optional[str]
    failure_reason: Optional[str]


@dataclass(frozen=True)
class QuestionRecord:
    """A question belonging to an event."""

    id: int
    event_id: int
    question_text: str
    correct_answer: str
    options_json: Optional[str]
    base_points: int
    duration_seconds: int
    order_number: int
    created_at: str


@dataclass(frozen=True)
class QuestionRunRecord:
    """A single timed run of a question."""

    id: int
    event_id: int
    question_id: int
    status: str
    started_at: str
    ends_at: str
    closed_at: Optional[str]
    bot_message_id: Optional[int]
    created_at: str


@dataclass(frozen=True)
class AnswerRecord:
    """A stored answer submitted by a user."""

    id: int
    event_id: int
    question_id: int
    question_run_id: int
    chat_id: int
    user_id: int
    answer_text: str
    normalized_answer: str
    is_correct: bool
    points: int
    answered_at: str


@dataclass(frozen=True)
class ParticipantRecord:
    """A user participating in an event."""

    event_id: int
    user_id: int
    chat_id: int
    joined_at: str


@dataclass(frozen=True)
class ScoreRecord:
    """Per-event accumulated score of a user."""

    event_id: int
    chat_id: int
    user_id: int
    points: int
    correct_answers: int
    first_correct_count: int
    updated_at: str


@dataclass(frozen=True)
class LeaderboardEntry:
    """A single row of a leaderboard with tie-breaking metadata."""

    rank: int
    user_id: int
    username: Optional[str]
    first_name: str
    points: int
    correct_answers: int
    first_answer_at: Optional[str] = None


@dataclass(frozen=True)
class AnswerResult:
    """Outcome of submitting an answer."""

    accepted: bool
    correct: bool
    points: int
    rejection_reason: Optional[str] = None


@dataclass(frozen=True)
class QuestionCloseResult:
    """Outcome of closing a question and moving forward."""

    closed: bool
    next_question_index: Optional[int] = None
    event_finished: bool = False


@dataclass(frozen=True)
class QuestionInput:
    """Input data for registering a question with an event."""

    question_text: str
    correct_answer: str
    order_number: int
    base_points: int = BASE_POINTS
    duration_seconds: int = DEFAULT_QUESTION_DURATION_SECONDS
    options: Optional[list[str]] = None
