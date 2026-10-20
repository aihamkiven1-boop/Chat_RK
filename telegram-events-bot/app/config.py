"""Application configuration loaded from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

from app.exceptions import ConfigurationError

_ENV_FILE = Path(".env")


@dataclass(frozen=True)
class Settings:
    """Immutable application settings."""

    bot_token: str = ""
    database_path: str = "data/event_bot.sqlite3"
    log_level: str = "INFO"
    timezone: str = "UTC"

    @property
    def tzinfo(self) -> ZoneInfo:
        """Timezone as a ZoneInfo object."""
        return ZoneInfo(self.timezone)

    @property
    def database_path_resolved(self) -> Path:
        """Database path resolved relative to the project root."""
        return Path(self.database_path).resolve()

    @classmethod
    def load(cls, env_file: str | os.PathLike[str] | None = _ENV_FILE) -> "Settings":
        """Load settings from the environment, optionally from a .env file."""
        if env_file is not None:
            path = Path(env_file)
            if path.is_file():
                load_dotenv(path)
            elif env_file == _ENV_FILE:
                load_dotenv()
        return cls(
            bot_token=os.getenv("BOT_TOKEN", "").strip(),
            database_path=os.getenv("DATABASE_PATH", "data/event_bot.sqlite3").strip(),
            log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper(),
            timezone=os.getenv("TIMEZONE", "UTC").strip(),
        )

    def validate_for_run(self) -> None:
        """Validate that the configuration is ready for a real bot run.

        The token is required only when running against the Telegram API,
        never for tests.
        """
        if not self.bot_token:
            raise ConfigurationError(
                "BOT_TOKEN is not set. Copy .env.example to .env and add your token."
            )
