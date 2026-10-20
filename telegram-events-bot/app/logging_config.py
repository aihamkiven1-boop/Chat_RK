"""Logging configuration for the application.

Produces two rotating log files under ``logs/``:

- ``logs/app.log``    — everything at the configured level (5 MB, 5 backups).
- ``logs/errors.log`` — ERROR and above with file/line and full tracebacks
  (5 MB, 10 backups).

Security guarantees:

- Every rendered line (including tracebacks) is passed through a redactor that
  replaces anything resembling a Telegram bot token with ``[REDACTED]``.
- The ``httpx``/``httpcore``/``telegram``/``urllib3`` loggers are clamped to
  WARNING so request URLs containing the token are never printed, and any
  remainder is still masked by the redacting formatter.
- All timestamps are UTC.
"""

from __future__ import annotations

import logging
import logging.handlers
import re
import time
from pathlib import Path

from app.config import Settings

APP_LOG_MAX_BYTES = 5 * 1024 * 1024
APP_LOG_BACKUP_COUNT = 5
ERRORS_LOG_MAX_BYTES = 5 * 1024 * 1024
ERRORS_LOG_BACKUP_COUNT = 10

REDACTED = "[REDACTED]"

# Telegram bot token: "<bot_id>:<secret>" (matches the code-quality guard).
BOT_TOKEN_PATTERN = re.compile(r"\d{6,12}:[A-Za-z0-9_-]{30,}")

# Loggers that can emit raw HTTP URLs (containing the token) at DEBUG/INFO.
_QUIET_LOGGERS = ("httpx", "httpcore", "telegram", "urllib3")

_APP_LOG_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
_ERROR_LOG_FORMAT = (
    "%(asctime)s | %(levelname)s | %(name)s | %(filename)s:%(lineno)d | %(message)s"
)
_DATEFMT = "%Y-%m-%dT%H:%M:%SZ"

_HANDLER_MARKER = "_rtb_logging_handler"


def redact_text(text: str) -> str:
    """Replace any substring that looks like a Telegram bot token."""
    return BOT_TOKEN_PATTERN.sub(REDACTED, text or "")


class RedactingFormatter(logging.Formatter):
    """Formatter that masks bot tokens in the fully rendered log line.

    ``Formatter.format`` renders the message plus any exception traceback;
    redaction runs on that final string so tokens are never written even from
    third-party loggers (e.g. httpx printing an API URL with a token).
    """

    def format(self, record: logging.LogRecord) -> str:
        return redact_text(super().format(record))


def configure_logging(settings: Settings, log_dir: str = "logs") -> None:
    """Configure root logging: console, app.log, and errors.log.

    Safe to call more than once: previously added application handlers are
    removed first (detected by a marker attribute), so pytest's own capture
    handler on the root logger is preserved.
    """
    level = getattr(logging, str(settings.log_level).upper(), logging.INFO)
    root = logging.getLogger()
    root.setLevel(level)

    for handler in list(root.handlers):
        if getattr(handler, _HANDLER_MARKER, False):
            root.removeHandler(handler)
            handler.close()

    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)

    app_formatter = RedactingFormatter(_APP_LOG_FORMAT, datefmt=_DATEFMT)
    app_formatter.converter = time.gmtime
    error_formatter = RedactingFormatter(_ERROR_LOG_FORMAT, datefmt=_DATEFMT)
    error_formatter.converter = time.gmtime

    console = logging.StreamHandler()
    console.setLevel(level)
    console.setFormatter(app_formatter)
    setattr(console, _HANDLER_MARKER, True)
    root.addHandler(console)

    try:
        app_handler = logging.handlers.RotatingFileHandler(
            log_path / "app.log",
            maxBytes=APP_LOG_MAX_BYTES,
            backupCount=APP_LOG_BACKUP_COUNT,
            encoding="utf-8",
        )
        app_handler.setLevel(level)
        app_handler.setFormatter(app_formatter)
        setattr(app_handler, _HANDLER_MARKER, True)
        root.addHandler(app_handler)

        error_handler = logging.handlers.RotatingFileHandler(
            log_path / "errors.log",
            maxBytes=ERRORS_LOG_MAX_BYTES,
            backupCount=ERRORS_LOG_BACKUP_COUNT,
            encoding="utf-8",
        )
        error_handler.setLevel(logging.ERROR)
        error_handler.setFormatter(error_formatter)
        setattr(error_handler, _HANDLER_MARKER, True)
        root.addHandler(error_handler)
    except OSError:
        # File logging is best-effort; the console handler keeps working.
        root.debug("Could not create log files under %s.", log_dir)

    for name in _QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)