"""Tests for SpeedQuiz answer normalization and checking.

Documented normalization rules:
- Remove Arabic diacritics.
- Normalize أ/إ/آ -> ا, ى -> ي, ة -> ه, and unify Persian ی/ک with Arabic ي/ك.
- Lowercase English, collapse and strip whitespace.
"""

from __future__ import annotations

import pytest

from app.exceptions import DomainError
from app.games.speed_quiz import SpeedQuiz, normalize_text
from app.models import QuestionRecord


def _question(text: str, answer: str) -> QuestionRecord:
    return QuestionRecord(
        id=1,
        event_id=1,
        question_text=text,
        correct_answer=answer,
        options_json=None,
        base_points=100,
        duration_seconds=15,
        order_number=0,
        created_at="2026-01-01T00:00:00.000000Z",
    )


@pytest.fixture
def game():
    return SpeedQuiz()


# -- normalization ----------------------------------------------------------
def test_normalize_strips_whitespace(game):
    assert game.normalize_answer("  الرياض  ") == "الرياض"


def test_normalize_collapses_internal_spaces(game):
    assert game.normalize_answer("أبو   ظبي") == "ابو ظبي"
    assert game.normalize_answer("الدار   البيضاء") == "الدار البيضاء"


def test_normalize_removes_arabic_diacritics(game):
    assert game.normalize_answer("مُحَمَّد") == "محمد"


def test_normalize_alef_forms(game):
    assert game.normalize_answer("أحمد") == "احمد"
    assert game.normalize_answer("إبراهيم") == "ابراهيم"
    assert game.normalize_answer("آدم") == "ادم"


def test_normalize_ya_and_ta_marbuta(game):
    assert game.normalize_answer("موسى") == "موسي"
    assert game.normalize_answer("مكة") == "مكه"


def test_normalize_english_lowercase(game):
    assert game.normalize_answer("Tokyo") == "tokyo"
    assert game.normalize_answer("  New   York  ") == "new york"


def test_normalize_keeps_distinct_letters(game):
    """ق/ك and س/ص must not be conflated."""
    assert game.normalize_answer("قرأ") != game.normalize_answer("كرا")
    assert game.normalize_answer("شمس") != game.normalize_answer("صمص")


def test_normalize_persian_yeh_and_kaf(game):
    assert game.normalize_answer("الریاض") == "الرياض"
    assert game.normalize_answer("الکويت") == "الكويت"


def test_check_answer_accepts_persian_yeh_and_kaf(game):
    q = _question("سؤال؟", "الرياض")
    assert game.check_answer("الریاض", q)


# -- checking ---------------------------------------------------------------
def test_check_answer_ignores_diacritics(game):
    q = _question("ما اسم عاصمة السعودية؟", "الرياض")
    assert game.check_answer("الرِّياض", q)


def test_check_answer_normalizes_arabic_forms(game):
    q = _question("سؤال؟", "إجابة")
    assert game.check_answer("اجابه", q)
    assert game.check_answer("اجابة", q)


def test_check_answer_english_case_insensitive(game):
    q = _question("Capital of Japan?", "Tokyo")
    assert game.check_answer("tokyo", q)
    assert game.check_answer("TOKYO", q)


def test_check_answer_false_for_wrong_answer(game):
    q = _question("سؤال؟", "الإجابة الصحيحة")
    assert game.check_answer("إجابة خاطئة", q) is False


def test_check_answer_empty_raises(game):
    q = _question("سؤال؟", "جواب")
    with pytest.raises(DomainError):
        game.check_answer("   ", q)


def test_validate_question_accepts_valid(game):
    game.validate_question(_question("سؤال؟", "جواب"))


def test_validate_question_rejects_empty_answer(game):
    q = QuestionRecord(
        id=1, event_id=1, question_text="سؤال", correct_answer="  ",
        options_json=None, base_points=100, duration_seconds=15,
        order_number=0, created_at="2026-01-01T00:00:00.000000Z",
    )
    with pytest.raises(DomainError):
        game.validate_question(q)


def test_render_question_returns_text(game):
    q = _question("ما عاصمة فرنسا؟", "باريس")
    assert game.render_question(q) == "ما عاصمة فرنسا؟"
