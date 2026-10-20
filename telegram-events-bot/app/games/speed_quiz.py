"""SpeedQuiz game: free-text questions with normalized answer comparison.

Normalization rules (documented in ARCHITECTURE.md):

Arabic:
- Remove diacritics (tashkeel).
- Normalize alef forms أ/إ/آ to ا.
- Normalize ى to ي.
- Normalize ة to ه (documented, explicit choice).
- Collapse whitespace and strip leading/trailing spaces.

English:
- Lowercase.
- Collapse whitespace and strip leading/trailing spaces.

No fuzzy matching or AI is used: comparison happens after exact normalization.
"""

from __future__ import annotations

import re
import unicodedata

from app.constants import GameType
from app.exceptions import DomainError
from app.games.base_game import BaseGame
from app.models import QuestionRecord
from app.utils.validators import validate_answer_text, validate_question_text

_ARABIC_DIACRITICS = re.compile(
    "[\u064B-\u0652\u0670\u0640\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]"
)
_ARABIC_CHARS = re.compile(r"[\u0600-\u06FF]")

# Combined translation table for Arabic normalization.
_ARABIC_TRANS = str.maketrans(
    {
        "\u0623": "\u0627",  # أ -> ا
        "\u0625": "\u0627",  # إ -> ا
        "\u0622": "\u0627",  # آ -> ا
        "\u0649": "\u064A",  # ى -> ي
        "\u0629": "\u0647",  # ة -> ه
        "\u0624": "\u0648",  # ؤ -> و
        "\u0626": "\u064A",  # ئ -> ي
        "\u06CC": "\u064A",  # ی -> ي
        "\u06A9": "\u0643",  # ک -> ك
    }
)

_WS = re.compile(r"\s+")


def normalize_text(answer: str) -> str:
    """Normalize an answer per the documented rules for Arabic and English."""
    text = unicodedata.normalize("NFKC", answer or "")
    if _ARABIC_CHARS.search(text):
        text = _ARABIC_DIACRITICS.sub("", text)
        text = text.translate(_ARABIC_TRANS)
    else:
        text = text.lower()
    return _WS.sub(" ", text).strip()


class SpeedQuiz(BaseGame):
    """Speed quiz game strategy."""

    @property
    def game_type(self) -> GameType:
        return GameType.SPEED_QUIZ

    def validate_question(self, question: QuestionRecord) -> None:
        """Ensure the question text and answer are non-empty."""
        validate_question_text(question.question_text)
        validate_answer_text(question.correct_answer)

    def normalize_answer(self, answer: str) -> str:
        """Normalize a submitted answer for comparison."""
        return normalize_text(answer)

    def check_answer(self, submitted_answer: str, question: QuestionRecord) -> bool:
        """Compare a normalized submitted answer with the expected answer."""
        submitted = self.normalize_answer(submitted_answer)
        expected = self.normalize_answer(question.correct_answer)
        if not submitted:
            raise DomainError("الإجابة لا يمكن أن تكون فارغة.")
        return submitted == expected

    def render_question(self, question: QuestionRecord) -> str:
        """Render the question text for display."""
        return question.question_text
