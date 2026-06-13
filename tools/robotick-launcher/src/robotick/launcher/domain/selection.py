from __future__ import annotations

from robotick.launcher.domain.contracts import ModelSessionRecord


def select_group_sessions(
    sessions: list[ModelSessionRecord],
    *,
    model_ids: list[str] | None = None,
    session_ids: list[str] | None = None,
) -> list[ModelSessionRecord]:
    selected = sessions
    if model_ids is not None:
        wanted_models = set(model_ids)
        selected = [session for session in selected if session.model_id in wanted_models]
    if session_ids is not None:
        wanted_sessions = set(session_ids)
        selected = [session for session in selected if session.id in wanted_sessions]
    return selected


def select_latest_sessions_by_model(sessions: list[ModelSessionRecord]) -> list[ModelSessionRecord]:
    latest_by_model: dict[str, ModelSessionRecord] = {}
    for session in sessions:
        current = latest_by_model.get(session.model_id)
        if current is None or session.generation > current.generation:
            latest_by_model[session.model_id] = session
    return [latest_by_model[key] for key in sorted(latest_by_model)]
