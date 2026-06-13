from __future__ import annotations

from datetime import datetime, timedelta, timezone

from robotick.launcher.domain.contracts import GroupStatus, ModelSessionRecord, SessionLifecycle


def _normalize_now(now: datetime | None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now


def is_session_stale(
    session: ModelSessionRecord,
    *,
    now: datetime | None = None,
    stale_after: timedelta = timedelta(seconds=30),
) -> bool:
    if session.lifecycle == SessionLifecycle.STALE:
        return True
    if session.lifecycle not in {SessionLifecycle.RUNNING, SessionLifecycle.HANDED_OFF}:
        return False
    if session.last_confirmed_at is None:
        return True
    current = _normalize_now(now)
    return (current - session.last_confirmed_at) > stale_after


def _effective_lifecycle(
    session: ModelSessionRecord,
    *,
    now: datetime | None = None,
    stale_after: timedelta = timedelta(seconds=30),
) -> SessionLifecycle:
    if is_session_stale(session, now=now, stale_after=stale_after):
        return SessionLifecycle.STALE
    return session.lifecycle


def reduce_group_status(
    sessions: list[ModelSessionRecord],
    *,
    now: datetime | None = None,
    stale_after: timedelta = timedelta(seconds=30),
) -> GroupStatus:
    if not sessions:
        return GroupStatus.STOPPED

    effective = [
        _effective_lifecycle(session, now=now, stale_after=stale_after) for session in sessions
    ]

    if all(state == SessionLifecycle.STOPPED for state in effective):
        return GroupStatus.STOPPED
    if all(state == SessionLifecycle.STALE for state in effective):
        return GroupStatus.STALE
    if any(state in {SessionLifecycle.PLANNED, SessionLifecycle.STARTING} for state in effective):
        if not any(state == SessionLifecycle.FAILED for state in effective):
            return GroupStatus.STARTING

    running_count = sum(
        state in {SessionLifecycle.RUNNING, SessionLifecycle.HANDED_OFF} for state in effective
    )
    if running_count == len(effective):
        return GroupStatus.RUNNING
    if running_count > 0 and any(
        state in {SessionLifecycle.FAILED, SessionLifecycle.STOPPED, SessionLifecycle.STALE}
        for state in effective
    ):
        return GroupStatus.DEGRADED
    if running_count == 0 and any(state == SessionLifecycle.FAILED for state in effective):
        return GroupStatus.FAILED
    if any(state == SessionLifecycle.STALE for state in effective):
        return GroupStatus.STALE
    if any(state == SessionLifecycle.STOPPING for state in effective):
        return GroupStatus.STARTING
    return GroupStatus.STARTING
