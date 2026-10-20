"""Tests for the pure scoring functions."""

from __future__ import annotations

import math

from app.services.scoring_service import (
    calculate_speed_bonus,
    clamp,
    score_correct_answer,
    score_wrong_answer,
)

DURATION = 15


def test_clamp_bounds():
    assert clamp(-5.0, 0.0, 1.0) == 0.0
    assert clamp(0.5, 0.0, 1.0) == 0.5
    assert clamp(5.0, 0.0, 1.0) == 1.0


def test_score_first_second_is_maximum():
    """An answer at the very start scores 150 (base 100 + bonus 50)."""
    assert score_correct_answer(0.0, DURATION) == 150


def test_score_midpoint_is_125():
    """Half the time elapsed yields floor(50*0.5)=25 bonus => 125."""
    assert score_correct_answer(DURATION / 2, DURATION) == 125


def test_score_at_end_is_100():
    """No remaining time yields zero bonus => 100."""
    assert score_correct_answer(DURATION, DURATION) == 100


def test_score_after_end_clamped_to_100():
    """Answers after the deadline cannot score below base points."""
    assert score_correct_answer(DURATION * 2, DURATION) == 100


def test_speed_bonus_exact_values():
    assert calculate_speed_bonus(0, DURATION) == 50
    assert calculate_speed_bonus(DURATION / 2, DURATION) == 25
    assert calculate_speed_bonus(DURATION, DURATION) == 0
    assert calculate_speed_bonus(100, DURATION) == 0


def test_speed_bonus_uses_floor():
    elapsed = 1.0
    remaining = 1 - elapsed / DURATION
    assert calculate_speed_bonus(elapsed, DURATION) == math.floor(50 * remaining)


def test_custom_base_points():
    assert score_correct_answer(0.0, DURATION, base_points=200) == 250
    assert score_correct_answer(DURATION, DURATION, base_points=200) == 200


def test_score_never_below_base_or_above_max():
    for elapsed in (0.0, 1.0, 7.5, 14.9, 15.0, 30.0, -1.0):
        score = score_correct_answer(elapsed, DURATION)
        assert 100 <= score <= 150


def test_wrong_answer_scores_zero():
    assert score_wrong_answer() == 0
