"""Safe demo questions used by /add_demo_questions.

Answers are plain text; SpeedQuiz normalization applies on comparison.
"""

from __future__ import annotations

from app.models import QuestionInput

DEMO_QUESTIONS: list[tuple[str, str]] = [
    ("ما عاصمة المملكة العربية السعودية؟", "الرياض"),
    ("كم عدد أيام الأسبوع؟", "سبعة"),
    ("ما أكبر كوكب في المجموعة الشمسية؟", "المشتري"),
    ("في أي قارة تقع مصر؟", "أفريقيا"),
    ("ما عاصمة اليابان؟", "طوكيو"),
]


def build_demo_questions() -> list[QuestionInput]:
    """Return demo questions with sequential order numbers (0-based)."""
    return [
        QuestionInput(
            question_text=text,
            correct_answer=answer,
            order_number=index,
            base_points=100,
            duration_seconds=15,
        )
        for index, (text, answer) in enumerate(DEMO_QUESTIONS)
    ]
