"""Time helpers: all timestamps are UTC ISO-8601 strings."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

ISO_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"


def utc_now() -> datetime:
    """Return the current UTC datetime (timezone-aware)."""
    return datetime.now(UTC)


def utc_now_iso() -> str:
    """Return the current UTC time formatted as ISO-8601."""
    return utc_now().strftime(ISO_FORMAT)


def parse_iso(value: str) -> datetime:
    """Parse an ISO-8601 UTC string into an aware datetime."""
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def format_iso(value: datetime) -> str:
    """Format an aware datetime as a UTC ISO-8601 string."""
    return value.astimezone(UTC).strftime(ISO_FORMAT)


def add_seconds_iso(value: datetime, seconds: int) -> str:
    """Return ``value`` plus ``seconds`` as a UTC ISO-8601 string."""
    return format_iso(value + timedelta(seconds=seconds))


def seconds_between(start_iso: str, end_iso: str) -> float:
    """Return elapsed seconds between two ISO-8601 timestamps."""
    return (parse_iso(end_iso) - parse_iso(start_iso)).total_seconds()
