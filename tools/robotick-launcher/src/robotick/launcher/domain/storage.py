from __future__ import annotations

from pathlib import Path

from pydantic import ValidationError

from robotick.launcher.domain.contracts import ModelSessionGroupRecord, ModelSessionRecord


class LauncherSessionStore:
    def __init__(self, workspace_root: str | Path):
        self.workspace_root = Path(workspace_root).resolve()
        self.root = self.workspace_root / ".robotick" / "launcher"
        self.group_dir = self.root / "model-session-groups"
        self.session_dir = self.root / "model-sessions"

    def _ensure_dirs(self) -> None:
        self.group_dir.mkdir(parents=True, exist_ok=True)
        self.session_dir.mkdir(parents=True, exist_ok=True)

    def _write_json(self, path: Path, payload: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{payload}\n", encoding="utf-8")

    def _group_path(self, group_id: str) -> Path:
        return self.group_dir / f"{group_id}.json"

    def _session_path(self, session_id: str) -> Path:
        return self.session_dir / f"{session_id}.json"

    def _read_group(self, path: Path) -> ModelSessionGroupRecord | None:
        try:
            text = path.read_text(encoding="utf-8")
            if not text.strip():
                return None
            return ModelSessionGroupRecord.model_validate_json(text)
        except (OSError, ValidationError, ValueError):
            return None

    def _read_session(self, path: Path) -> ModelSessionRecord | None:
        try:
            text = path.read_text(encoding="utf-8")
            if not text.strip():
                return None
            return ModelSessionRecord.model_validate_json(text)
        except (OSError, ValidationError, ValueError):
            return None

    def create_group(self, group: ModelSessionGroupRecord) -> ModelSessionGroupRecord:
        self._ensure_dirs()
        path = self._group_path(group.id)
        if path.exists():
            raise FileExistsError(f"Model session group already exists: {group.id}")
        self._write_json(path, group.model_dump_json(indent=2))
        return group

    def update_group(self, group: ModelSessionGroupRecord) -> ModelSessionGroupRecord:
        self._ensure_dirs()
        self._write_json(self._group_path(group.id), group.model_dump_json(indent=2))
        return group

    def get_group(self, group_id: str) -> ModelSessionGroupRecord | None:
        path = self._group_path(group_id)
        if not path.exists():
            return None
        return self._read_group(path)

    def list_groups(self, *, project_id: str | None = None) -> list[ModelSessionGroupRecord]:
        self._ensure_dirs()
        groups = [
            group
            for path in sorted(self.group_dir.glob("*.json"))
            if (group := self._read_group(path)) is not None
        ]
        if project_id is not None:
            groups = [group for group in groups if group.project_id == project_id]
        return groups

    def create_session(self, session: ModelSessionRecord) -> ModelSessionRecord:
        self._ensure_dirs()
        path = self._session_path(session.id)
        if path.exists():
            raise FileExistsError(f"Model session already exists: {session.id}")
        self._write_json(path, session.model_dump_json(indent=2))
        return session

    def update_session(self, session: ModelSessionRecord) -> ModelSessionRecord:
        self._ensure_dirs()
        self._write_json(self._session_path(session.id), session.model_dump_json(indent=2))
        return session

    def get_session(self, session_id: str) -> ModelSessionRecord | None:
        path = self._session_path(session_id)
        if not path.exists():
            return None
        return self._read_session(path)

    def list_sessions(
        self,
        *,
        group_id: str | None = None,
        project_id: str | None = None,
    ) -> list[ModelSessionRecord]:
        self._ensure_dirs()
        sessions = [
            session
            for path in sorted(self.session_dir.glob("*.json"))
            if (session := self._read_session(path)) is not None
        ]
        if group_id is not None:
            sessions = [session for session in sessions if session.group_id == group_id]
        if project_id is not None:
            sessions = [session for session in sessions if session.project_id == project_id]
        return sessions
