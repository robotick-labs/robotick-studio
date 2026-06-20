from __future__ import annotations

from pathlib import Path

from robotick.launcher.domain import (
    CreatorClient,
    CreatorMetadata,
    LaunchIntent,
    LaunchScope,
    LauncherSessionStore,
    ModelSessionGroupRecord,
    ModelSessionRecord,
    ScopeKind,
    SessionLifecycle,
    TargetOverride,
    TargetPolicy,
)
from robotick.launcher.hub_ability import ability


class FakeStopWorker:
    pid = 12345

    def wait(self) -> int:
        return 0


def test_restart_stop_finalization_preserves_request_id_when_phonebook_operation_was_cleared(
    tmp_path: Path,
    monkeypatch,
) -> None:
    project_path = tmp_path / "robots" / "alf-e" / "alf-e.project.yaml"
    project_path.parent.mkdir(parents=True)
    (project_path.parent / "models").mkdir()
    (project_path.parent / "models" / "alf-e-spine.model.yaml").write_text(
        "runtime:\n  target_platform: linux\n",
        encoding="utf-8",
    )
    project_path.write_text(
        "runtime:\n  engine: ./engine\nmodels:\n  - models/alf-e-spine.model.yaml\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(ability, "_resolve_project_path", lambda _root, _project: project_path)

    store = LauncherSessionStore(tmp_path)
    created_by = CreatorMetadata(client=CreatorClient.CLI, instance_id="cli-test")
    intent = LaunchIntent(
        project="alf-e",
        scope=LaunchScope(kind=ScopeKind.MODEL, value="alf-e-spine"),
        target_policy=TargetPolicy.NATIVE,
        created_by=created_by,
    )
    group = ModelSessionGroupRecord(
        workspace_id="workspace",
        project_id="alf-e",
        project_path=str(project_path),
        intent=intent,
        resolved_model_ids=["alf-e-spine"],
        session_ids=[],
        created_by=created_by,
    )
    session = ModelSessionRecord(
        group_id=group.id,
        project_id="alf-e",
        model_id="alf-e-spine",
        target=TargetOverride(platform="linux"),
        lifecycle=SessionLifecycle.STOPPING,
        runtime={
            "worker": {
                "pid": 98765,
                "command": ["run", "alf-e-spine"],
                "log_path": str(tmp_path / "alf-e-spine.log"),
            },
            "probe": {
                "host": "localhost",
                "port": 9040,
                "telemetry_url": "http://localhost:9040/api/telemetry",
                "health_urls": ["http://localhost:9040/api/telemetry/health"],
            },
        },
        created_by=created_by,
    )
    group = group.model_copy(update={"session_ids": [session.id]})
    store.create_group(group)
    store.create_session(session)
    ability._write_runtime_phonebook_record(
        str(tmp_path),
        ability._runtime_phonebook_record_from_session(
            str(tmp_path),
            session,
            project_path=str(project_path),
            operation=None,
        ),
    )

    operation_id = "restart-group-test"
    ability._finalize_stop_model_sessions(
        str(tmp_path),
        [(session, FakeStopWorker(), str(tmp_path / "alf-e-spine-stop.log"), ["stop"])],
        action="restart",
        operation_id=operation_id,
    )

    projection = ability._launcher_runtime_projection(
        str(tmp_path),
        project_id="alf-e",
        model_ids=["alf-e-spine"],
    )
    [model] = projection["models"]

    assert model["lifecycle"] == "stopping"
    assert model["operation"]["action"] == "restarting"
    assert model["operation"]["request_id"] == operation_id
