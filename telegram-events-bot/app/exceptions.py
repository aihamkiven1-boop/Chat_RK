"""Domain-level exceptions for the application."""

from __future__ import annotations


class DomainError(Exception):
    """Base class for all domain-level errors."""


class PermissionDeniedError(DomainError):
    """Raised when a non-admin user attempts an administrative action."""


class EventConflictError(DomainError):
    """Raised when an operation conflicts with an existing active event."""


class InvalidStateTransitionError(DomainError):
    """Raised when an event transition is not allowed by the state machine."""


class AnswerRejectedError(DomainError):
    """Raised when an answer is rejected by business rules.

    The message is intended to be shown to the user, so it must be in Arabic.
    """


class NotFoundError(DomainError):
    """Raised when a requested entity does not exist."""


class ConfigurationError(DomainError):
    """Raised when the application configuration is invalid."""
