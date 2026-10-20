"""Code-quality guards: no secrets in the tree and all files compile."""

from __future__ import annotations

import compileall
import re
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]

TOKEN_PATTERN = re.compile(r"\d{6,12}:[A-Za-z0-9_-]{30,}")

# Directories that are allowed to contain generated/runtime artifacts.
SKIP_DIRS = {".git", ".venv", "__pycache__", ".pytest_cache", "data", "logs", "backups"}


def _tracked_files() -> list[Path]:
    """All source/documentation files, skipping generated dirs."""
    files: list[Path] = []
    for path in PROJECT_ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.name in {".env"}:
            continue
        files.append(path)
    return files


def test_no_telegram_token_in_any_file():
    """No real Telegram bot token may appear anywhere in the project."""
    offenders = []
    for path in _tracked_files():
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if TOKEN_PATTERN.search(content):
            offenders.append(str(path))
    assert offenders == [], f"Tokens detected in: {offenders}"


def test_bot_token_placeholder_is_empty_in_env_example():
    env_example = PROJECT_ROOT / ".env.example"
    text = env_example.read_text(encoding="utf-8")
    assert "BOT_TOKEN=" in text
    for line in text.splitlines():
        if line.startswith("BOT_TOKEN="):
            assert line == "BOT_TOKEN=" or not line.split("=", 1)[1].strip()


def test_no_env_file_committed():
    env_file = PROJECT_ROOT / ".env"
    if not env_file.exists():
        return
    if not (PROJECT_ROOT / ".git").exists():
        return
    result = subprocess.run(
        ["git", "-C", str(PROJECT_ROOT), "ls-files", "--error-unmatch", ".env"],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0, ".env is tracked in git"


def test_all_python_files_compile():
    """Every Python file must pass compileall."""
    success = compileall.compile_dir(
        str(PROJECT_ROOT),
        quiet=1,
        force=True,
        rx=re.compile(r"/(\.venv|\.git|__pycache__)/"),
    )
    assert success is True, "compileall reported errors"
