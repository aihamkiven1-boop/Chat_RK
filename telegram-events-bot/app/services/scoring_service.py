"""Pure scoring functions.

points = base_points + speed_bonus

- base_points defaults to 100.
- speed_bonus ranges from 0 to 50 and depends on the remaining time ratio.
- Correct answers never score below 100 or above 150.
- Wrong answers score 0.
"""

from __future__ import annotations

import math

from app.constants import BASE_POINTS, MAX_SPEED_BONUS, WRONG_ANSWER_POINTS


def clamp(value: float, low: float, high: float) -> float:
    """Clamp ``value`` into the inclusive ``[low, high]`` range."""
    return max(low, min(high, value))


def calculate_speed_bonus(
    elapsed_seconds: float, duration_seconds: float
) -> int:
    """Compute the speed bonus from the remaining time ratio.

    remaining_ratio = clamp(0, 1, 1 - elapsed_seconds / duration_seconds)
    speed_bonus = floor(50 * remaining_ratio)
    """
    if duration_seconds <= 0:
        return MAX_SPEED_BONUS
    ratio = clamp(1.0 - elapsed_seconds / duration_seconds, 0.0, 1.0)
    return math.floor(MAX_SPEED_BONUS * ratio)


def score_correct_answer(
    elapsed_seconds: float,
    duration_seconds: float,
    base_points: int = BASE_POINTS,
) -> int:
    """Return the score for a correct answer.

    Score is clamped between ``base_points`` and ``base_points + 50``.
    """
    bonus = calculate_speed_bonus(elapsed_seconds, duration_seconds)
    return clamp(base_points + bonus, base_points, base_points + MAX_SPEED_BONUS)


def score_wrong_answer() -> int:
    """Return the score for a wrong answer (always zero)."""
    return WRONG_ANSWER_POINTS
