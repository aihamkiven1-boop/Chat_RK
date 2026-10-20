"""Text formatting helpers for user-facing messages."""

from __future__ import annotations

import html


def escape_html(text: str) -> str:
    """Escape a string for safe use inside HTML-formatted messages."""
    return html.escape(text or "", quote=True)


def truncate(text: str, limit: int = 100) -> str:
    """Truncate a string to ``limit`` characters adding an ellipsis."""
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def mask_token(token: str) -> str:
    """Return a masked version of a token for safe logging."""
    if not token:
        return ""
    if len(token) <= 8:
        return "*" * len(token)
    return f"{token[:4]}...{token[-4:]}"
