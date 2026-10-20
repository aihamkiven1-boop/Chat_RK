"""Database connection and schema management for SQLite.

This module is the only place that knows how to connect to SQLite and how to
run migrations. All timestamps are stored as UTC ISO-8601 strings.
"""

from __future__ import annotations

import logging
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.exceptions import ConfigurationError

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def ensure_data_dir(database_path: str | Path) -> Path:
    """Create the parent directory of the database file if needed."""
    path = Path(database_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _connect(database_path: str | Path) -> sqlite3.Connection:
    """Open a SQLite connection with the required PRAGMAs.

    ``isolation_level=None`` enables autocommit so transactions are controlled
    explicitly via ``BEGIN``/``COMMIT`` (no implicit transaction handling by
    the sqlite3 module).
    """
    path = ensure_data_dir(database_path)
    conn = sqlite3.connect(str(path), isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


class Database:
    """Thin wrapper around a SQLite connection with transaction support."""

    def __init__(self, database_path: str | Path, migrate: bool = True) -> None:
        self.database_path = str(database_path)
        self._conn = _connect(self.database_path)
        self._tx_depth = 0
        if migrate:
            self.run_migrations()

    def connection(self) -> sqlite3.Connection:
        """Return the underlying connection (read-only usage)."""
        return self._conn

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Run a block of SQL statements inside a short transaction.

        Commits on success and rolls back on any exception. Re-entrant:
        nested ``with self.transaction()`` blocks join the outer transaction.
        """
        conn = self._conn
        nested = self._tx_depth > 0
        self._tx_depth += 1
        if not nested:
            conn.execute("BEGIN")
        try:
            yield conn
            if not nested:
                conn.commit()
        except Exception:
            if not nested:
                conn.rollback()
            raise
        finally:
            self._tx_depth -= 1

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        """Execute a single statement (no implicit transaction)."""
        return self._conn.execute(sql, params)

    def run_migrations(self) -> None:
        """Apply pending migrations idempotently.

        Migration files are applied in sorted filename order and recorded in
        the ``schema_migrations`` table. Running twice is a no-op. All
        statements use IF NOT EXISTS so a partially applied migration can be
        re-run safely.
        """
        from app.utils.time_utils import utc_now_iso

        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " version TEXT PRIMARY KEY,"
            " applied_at TEXT NOT NULL"
            ")"
        )
        applied = {
            row["version"]
            for row in self._conn.execute("SELECT version FROM schema_migrations")
        }
        for migration_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if migration_file.name in applied:
                logger.debug("Migration already applied: %s", migration_file.name)
                continue
            sql = migration_file.read_text(encoding="utf-8")
            self._conn.executescript(sql)
            self._conn.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                (migration_file.name, utc_now_iso()),
            )
            logger.info("Applied migration: %s", migration_file.name)

    def close(self) -> None:
        """Close the underlying connection."""
        self._conn.close()


def open_database(database_path: str | Path, migrate: bool = True) -> Database:
    """Open a Database instance (kept for clarity in composition roots)."""
    return Database(database_path, migrate=migrate)
