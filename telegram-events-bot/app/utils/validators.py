"""Input validators for user-provided values."""

from __future__ import annotations

import re

from app.constants import (
    MAX_QUESTION_DURATION_SECONDS,
    MAX_QUESTIONS_PER_EVENT,
    MIN_QUESTION_DURATION_SECONDS,
)
from app.exceptions import DomainError

_EVENT_TITLE_MAX = 200
_QUESTION_TEXT_MAX = 1000
_ANSWER_TEXT_MAX = 200


def validate_event_title(title: str) -> str:
    """Validate and normalize an event title."""
    title = title.strip()
    if not title:
        raise DomainError("عنوان الفعالية لا يمكن أن يكون فارغًا.")
    if len(title) > _EVENT_TITLE_MAX:
        raise DomainError("عنوان الفعالية أطول من الحد المسموح.")
    return title


def validate_question_text(text: str) -> str:
    """Validate question text length."""
    text = text.strip()
    if not text:
        raise DomainError("نص السؤال لا يمكن أن يكون فارغًا.")
    if len(text) > _QUESTION_TEXT_MAX:
        raise DomainError("نص السؤال أطول من الحد المسموح.")
    return text


def validate_answer_text(text: str) -> str:
    """Validate a submitted answer length."""
    text = text.strip()
    if not text:
        raise DomainError("الإجابة لا يمكن أن تكون فارغة.")
    if len(text) > _ANSWER_TEXT_MAX:
        raise DomainError("الإجابة أطول من الحد المسموح.")
    return text


def validate_duration(seconds: int) -> int:
    """Validate the question duration is within bounds."""
    if not MIN_QUESTION_DURATION_SECONDS <= seconds <= MAX_QUESTION_DURATION_SECONDS:
        raise DomainError("مدة السؤال يجب أن تكون بين 5 و120 ثانية.")
    return seconds


def validate_question_count(count: int) -> int:
    """Validate the number of questions is within bounds."""
    if not 1 <= count <= MAX_QUESTIONS_PER_EVENT:
        raise DomainError("عدد الأسئلة يجب أن يكون بين 1 و20.")
    return count


def strip_command_args(text: str) -> str:
    """Extract and clean arguments after a bot command."""
    if not text:
        return ""
    return re.sub(r"^/[\w]+\s*", "", text, flags=re.UNICODE).strip()
