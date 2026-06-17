from __future__ import annotations

from datetime import timedelta
from pathlib import Path

from robotick.launcher.domain import (
    CreatorMetadata,
    CreatorClient,
    GroupStatus,
    LaunchIntent,
    LaunchScope,
    LauncherSessionStore,
    ModelSessionGroupRecord,
    ModelSessionRecord,
    ScopeKind,
    SessionLifecycle,
    StagePolicy,
    StagePolicyKind,
    TargetOverride,
    TargetPolicy,
    expand_launch_intent,
    is_session_stale,
    launch_intent_from_profile,
    reduce_group_status,
    select_group_sessions,
    select_latest_sessions_by_model,
)


def write_project(tmp_path: Path) -> Path:
    project_dir = tmp_path / "robots" / "alf-e"
    project_dir.mkdir(parents=True)
    (project_dir / "engine").mkdir()
    project_path = project_dir / "alf-e.project.yaml"
    project_path.write_text(
        "\n".join(
            [
                "runtime:",
                "  engine: ./engine",
                "profiles:",
                "  face-pack:",
                "    models:",
                "      - face",
                "      - spine",
            ]
        ),
        encoding="utf-8",
    )
    (project_dir / "face.model.yaml").write_text(
        "\n".join(
            [
                "launcher:",
                "  auto_launch: false",
                "runtime:",
                "  target_platform: linux",
                "  target_variant: x64",
            ]
        ),
        encoding="utf-8",
    )
    (project_dir / "spine.model.yaml").write_text(
        "\n".join(
            [
                "runtime:",
                "  target_platform: esp32",
                "  target_variant: esp32s3_m5",
                "  preferred_host: alf-e-spine.local",
            ]
        ),
        encoding="utf-8",
    )
    return project_path

def test_launch_intent_from_profile_resolves_all_profile_and_model(tmp_path: Path) -> None:
    project_path = write_project(tmp_path)

    all_intent = launch_intent_from_profile("alf-e", project_path, "native:ALL")
    profile_intent = launch_intent_from_profile("alf-e", project_path, "native:face-pack")
    model_intent = launch_intent_from_profile("alf-e", project_path, "native:spine")
    models_intent = launch_intent_from_profile("alf-e", project_path, "native:face,spine")

    assert all_intent.scope.kind == ScopeKind.ALL
    assert profile_intent.scope.kind == ScopeKind.PROFILE
    assert model_intent.scope.kind == ScopeKind.MODEL
    assert models_intent.scope.kind == ScopeKind.MODELS
    assert models_intent.scope.value == ["face", "spine"]


def test_expand_launch_intent_preserves_auto_launch_and_native_target_semantics(
    tmp_path: Path,
) -> None:
    project_path = write_project(tmp_path)
    intent = launch_intent_from_profile("alf-e", project_path, "native:face-pack")

    resolved = expand_launch_intent(project_path, intent)

    assert resolved.automatic_selection is True
    assert resolved.requested_model_ids == ["face", "spine"]
    assert resolved.selected_model_ids == ["spine"]
    assert resolved.skipped_model_ids == ["face"]
    spine = next(model for model in resolved.models if model.model_id == "spine")
    face = next(model for model in resolved.models if model.model_id == "face")
    assert face.selected is False
    assert spine.target_platform == "esp32"
    assert spine.target_variant == "esp32s3_m5"
    assert spine.preferred_host == "alf-e-spine.local"


def test_expand_launch_intent_preserves_explicit_model_selection_and_local_target_semantics(
    tmp_path: Path,
) -> None:
    project_path = write_project(tmp_path)
    intent = LaunchIntent(
        project="alf-e",
        scope=LaunchScope(kind=ScopeKind.MODELS, value=["face", "spine"]),
        target_policy=TargetPolicy.LOCAL,
        target_overrides={"spine": TargetOverride(variant="arm64")},
        stage_policy=StagePolicy(kind=StagePolicyKind.EXPLICIT, stages=["build", "run"]),
    )

    resolved = expand_launch_intent(project_path, intent)

    assert resolved.automatic_selection is False
    assert resolved.selected_model_ids == ["face", "spine"]
    assert resolved.skipped_model_ids == []
    assert [model.target_platform for model in resolved.models] == ["linux", "linux"]
    assert next(model for model in resolved.models if model.model_id == "spine").stages == [
        "build",
        "run",
    ]


def test_session_store_round_trips_groups_and_sessions(tmp_path: Path) -> None:
    store = LauncherSessionStore(tmp_path)
    intent = LaunchIntent(
        project="alf-e",
        scope=LaunchScope(kind=ScopeKind.ALL, value="ALL"),
        target_policy=TargetPolicy.NATIVE,
        created_by=CreatorMetadata(client=CreatorClient.CLI, instance_id="cli-1"),
    )
    group = ModelSessionGroupRecord(
        workspace_id="workspace",
        project_id="alf-e",
        project_path="/tmp/alf-e.project.yaml",
        intent=intent,
        resolved_model_ids=["face", "spine"],
        session_ids=["ms_1"],
        created_by=intent.created_by,
    )
    session = ModelSessionRecord(
        group_id=group.id,
        project_id="alf-e",
        model_id="spine",
        created_by=intent.created_by,
    )

    store.create_group(group)
    store.create_session(session)

    loaded_group = store.get_group(group.id)
    loaded_session = store.get_session(session.id)

    assert loaded_group is not None
    assert loaded_group.created_by.client == CreatorClient.CLI
    assert loaded_group.session_ids == ["ms_1"]
    assert loaded_session is not None
    assert loaded_session.group_id == group.id
    assert store.list_groups(project_id="alf-e")[0].id == group.id
    assert store.list_sessions(group_id=group.id)[0].id == session.id
    assert group.id.startswith("msg_")
    assert session.id.startswith("ms_")


def test_session_store_ignores_empty_or_invalid_records(tmp_path: Path) -> None:
    store = LauncherSessionStore(tmp_path)
    store.session_dir.mkdir(parents=True)
    store.group_dir.mkdir(parents=True)
    (store.session_dir / "ms_empty.json").write_text("", encoding="utf-8")
    (store.session_dir / "ms_invalid.json").write_text("{", encoding="utf-8")
    (store.group_dir / "msg_empty.json").write_text("", encoding="utf-8")
    (store.group_dir / "msg_invalid.json").write_text("{", encoding="utf-8")

    assert store.get_session("ms_empty") is None
    assert store.get_group("msg_empty") is None
    assert store.list_sessions() == []
    assert store.list_groups() == []


def test_status_reduction_and_freshness() -> None:
    group_id = "msg_test"
    confirmed_at = ModelSessionRecord(
        id="ms_seed",
        group_id=group_id,
        project_id="alf-e",
        model_id="seed",
    ).created_at
    fresh = ModelSessionRecord(
        id="ms_fresh",
        group_id=group_id,
        project_id="alf-e",
        model_id="spine",
        lifecycle=SessionLifecycle.RUNNING,
        last_confirmed_at=confirmed_at,
    )
    failed = ModelSessionRecord(
        id="ms_failed",
        group_id=group_id,
        project_id="alf-e",
        model_id="face",
        lifecycle=SessionLifecycle.FAILED,
    )
    stale = ModelSessionRecord(
        id="ms_stale",
        group_id=group_id,
        project_id="alf-e",
        model_id="voice",
        lifecycle=SessionLifecycle.RUNNING,
        last_confirmed_at=confirmed_at - timedelta(minutes=5),
    )

    assert is_session_stale(stale, now=confirmed_at, stale_after=timedelta(seconds=30)) is True
    assert reduce_group_status([fresh], now=confirmed_at) == GroupStatus.RUNNING
    assert reduce_group_status([fresh, failed], now=confirmed_at) == GroupStatus.DEGRADED
    assert reduce_group_status([failed], now=confirmed_at) == GroupStatus.FAILED
    assert reduce_group_status([stale], now=confirmed_at) == GroupStatus.STALE


def test_selection_helpers_choose_requested_or_latest_sessions() -> None:
    sessions = [
        ModelSessionRecord(
            id="ms_face_1",
            group_id="msg_test",
            project_id="alf-e",
            model_id="face",
            generation=1,
        ),
        ModelSessionRecord(
            id="ms_face_2",
            group_id="msg_test",
            project_id="alf-e",
            model_id="face",
            generation=2,
        ),
        ModelSessionRecord(
            id="ms_spine_1",
            group_id="msg_test",
            project_id="alf-e",
            model_id="spine",
            generation=1,
        ),
    ]

    assert [session.id for session in select_group_sessions(sessions, model_ids=["spine"])] == [
        "ms_spine_1"
    ]
    assert [session.id for session in select_group_sessions(sessions, session_ids=["ms_face_1"])] == [
        "ms_face_1"
    ]
    assert [session.id for session in select_latest_sessions_by_model(sessions)] == [
        "ms_face_2",
        "ms_spine_1",
    ]
