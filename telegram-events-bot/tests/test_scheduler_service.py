"""Tests for scheduler behavior."""

from __future__ import annotations

from datetime import UTC

from app.services.scheduler_service import JobQueueScheduler


class DummyDispatcher:
    async def run(self, *args, **kwargs):
        return None


class FakeQueue:
    def __init__(self):
        self.calls = []

    def jobs(self):
        return []

    def run_once(self, callback, when, name=None, data=None):
        self.calls.append({
            "callback": callback,
            "when": when,
            "name": name,
            "data": data,
        })


def test_schedule_question_close_uses_utc_datetime():
    queue = FakeQueue()
    scheduler = JobQueueScheduler(queue, DummyDispatcher())
    scheduler.schedule_question_close(7, 9, "2026-01-01T12:00:00.000000Z")

    assert len(queue.calls) == 1
    when = queue.calls[0]["when"]
    assert when.tzinfo is not None
    assert when.utcoffset() == UTC.utcoffset(when)
    assert queue.calls[0]["name"] == "event:7:question:9:close"
    assert queue.calls[0]["data"] == {"event_id": 7, "run_id": 9}
