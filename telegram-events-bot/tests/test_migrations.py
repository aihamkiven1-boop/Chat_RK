"""Tests that migrations apply cleanly and can be re-run safely."""

from __future__ import annotations

import sqlite3

from app.database import Database, MIGRATIONS_DIR


def _table_names(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'index')"
    ).fetchall()
    return {row["name"] for row in rows}


def test_migrations_run_twice_without_error(tmp_path):
    """Migrations must be idempotent (run twice with no failure)."""
    db_path = tmp_path / "twice.sqlite3"
    db1 = Database(db_path)
    db1.run_migrations()
    tables_after_first = _table_names(db1.connection())
    db1.run_migrations()
    tables_after_second = _table_names(db1.connection())
    db1.close()

    assert tables_after_first == tables_after_second
    assert "schema_migrations" in tables_after_first


def test_reopening_database_reruns_migrations_safely(tmp_path):
    """Reopening the same file must not fail or duplicate rows."""
    db_path = tmp_path / "reopen.sqlite3"
    db1 = Database(db_path)
    db1.close()

    db2 = Database(db_path)
    rows = db2.connection().execute(
        "SELECT version FROM schema_migrations ORDER BY version"
    ).fetchall()
    db2.close()
    assert [row["version"] for row in rows] == sorted(
        f.name for f in MIGRATIONS_DIR.glob("*.sql")
    )


def test_required_tables_exist(tmp_path):
    """All required tables must be created by the migrations."""
    db = Database(tmp_path / "schema.sqlite3")
    conn = db.connection()
    tables = {
        "groups",
        "users",
        "group_members",
        "events",
        "questions",
        "question_runs",
        "answers",
        "event_participants",
        "event_scores",
        "bot_runtime_locks",
    }
    assert tables.issubset(_table_names(conn))
    db.close()


def test_partial_unique_indexes_exist(tmp_path):
    """The partial unique indexes required by business rules must exist."""
    db = Database(tmp_path / "indexes.sqlite3")
    indexes = _table_names(db.connection())
    db.close()
    assert "uq_events_one_active_per_group" in indexes
    assert "uq_question_runs_one_active_per_event" in indexes
