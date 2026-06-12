from __future__ import annotations

from pathlib import Path

import yaml

from robotick.launcher.actions.query.list import list_project_models
from robotick.launcher.config import Config
from robotick.launcher.domain.contracts import (
    DependencyPolicy,
    LaunchIntent,
    LaunchScope,
    ResolvedLaunchIntent,
    ResolvedModelLaunch,
    ScopeKind,
    StagePolicy,
    TargetOverride,
    TargetPolicy,
)


def _normalize_model_id(model_spec: str) -> str:
    model_name = Path(model_spec).name
    if model_name.endswith(".model.yaml"):
        return Path(model_name).stem.removesuffix(".model")
    return model_spec


def _load_project_data(project_path: Path) -> dict:
    project_data = yaml.safe_load(project_path.read_text(encoding="utf-8")) or {}
    if not isinstance(project_data, dict):
        raise ValueError("Project file must decode to a mapping.")
    return project_data


def _load_profiles(project_path: Path) -> dict:
    project_data = _load_project_data(project_path)
    profiles = project_data.get("profiles") or {}
    if not isinstance(profiles, dict):
        raise ValueError("Project 'profiles' section must be a mapping when provided.")
    return profiles


def _build_project_model_index(project_path: Path) -> dict[str, Path]:
    model_index: dict[str, Path] = {}
    for rel_path in list_project_models(str(project_path.resolve())):
        model_path = (project_path.parent / rel_path).resolve()
        model_id = Path(rel_path).stem.removesuffix(".model")
        if model_id in model_index:
            raise RuntimeError(
                f"Multiple model files found for '{model_id}': {model_index[model_id]} and {model_path}"
            )
        model_index[model_id] = model_path
    return model_index


def _resolve_profile_model_ids(project_path: Path, profile_name: str) -> list[str] | None:
    profiles = _load_profiles(project_path)
    profile_entry = profiles.get(profile_name)
    if profile_entry is None:
        return None
    if isinstance(profile_entry, list):
        models = profile_entry
    elif isinstance(profile_entry, dict):
        models = profile_entry.get("models") or []
    else:
        raise ValueError(
            f"Profile '{profile_name}' must be a list of model ids or a mapping with 'models'."
        )
    if not isinstance(models, list) or any(
        not isinstance(model_id, str) or not model_id.strip() for model_id in models
    ):
        raise ValueError(
            f"Profile '{profile_name}' must resolve to a list of non-empty model ids."
        )
    return models


def parse_profile_selector(project_path: Path, profile: str) -> LaunchScope:
    if ":" not in profile:
        raise ValueError("Invalid profile format (expected 'local:xyz' or 'native:xyz')")
    _platform, selector = profile.split(":", 1)
    if selector == "ALL":
        return LaunchScope(kind=ScopeKind.ALL, value="ALL")
    if "," in selector:
        return LaunchScope(
            kind=ScopeKind.MODELS,
            value=[_normalize_model_id(item.strip()) for item in selector.split(",") if item.strip()],
        )
    if _resolve_profile_model_ids(project_path, selector) is not None:
        return LaunchScope(kind=ScopeKind.PROFILE, value=selector)
    return LaunchScope(kind=ScopeKind.MODEL, value=_normalize_model_id(selector))


def launch_intent_from_profile(
    project: str,
    project_path: Path,
    profile: str,
    *,
    target_overrides: dict[str, TargetOverride] | None = None,
    stage_policy: StagePolicy | None = None,
) -> LaunchIntent:
    if ":" not in profile:
        raise ValueError("Invalid profile format (expected 'local:xyz' or 'native:xyz')")
    target_policy_name, _selector = profile.split(":", 1)
    try:
        target_policy = TargetPolicy(target_policy_name)
    except ValueError as exc:
        raise ValueError(f"Platform '{target_policy_name}' not yet supported") from exc
    return LaunchIntent(
        project=project,
        scope=parse_profile_selector(project_path, profile),
        target_policy=target_policy,
        target_overrides=target_overrides or {},
        stage_policy=stage_policy or StagePolicy(),
        dependency_policy=DependencyPolicy.EXACT,
    )


def _scope_is_automatic(scope: LaunchScope) -> bool:
    return scope.kind in {ScopeKind.ALL, ScopeKind.PROFILE}


def _resolve_requested_model_ids(project_path: Path, scope: LaunchScope) -> list[str]:
    if scope.kind == ScopeKind.ALL:
        model_paths = list_project_models(str(project_path.resolve()))
        return [Path(path).stem.removesuffix(".model") for path in model_paths]
    if scope.kind == ScopeKind.PROFILE:
        models = _resolve_profile_model_ids(project_path, str(scope.value))
        if models is None:
            raise ValueError(f"Unknown profile: {scope.value}")
        return models
    if scope.kind == ScopeKind.MODELS:
        return [_normalize_model_id(model_id) for model_id in list(scope.value)]
    return [_normalize_model_id(str(scope.value))]


def _resolve_model_target(
    project_name: str,
    base_dir: Path,
    target_policy: TargetPolicy,
    model_id: str,
    override: TargetOverride | None,
) -> tuple[str, str | None, str | None]:
    if target_policy == TargetPolicy.LOCAL:
        return "linux", override.variant if override else None, override.host if override else None
    config = Config(
        project_name,
        model_id,
        None,
        base_dir,
        dry_run=False,
        stub_install=False,
    )
    runtime = dict(config.model.get("runtime") or {})
    target_platform = str(runtime.get("target_platform") or "linux").strip().lower() or "linux"
    target_variant = str(runtime.get("target_variant") or "").strip().lower() or None
    preferred_host = str(runtime.get("preferred_host") or "").strip() or None
    if override is not None:
        target_platform = str(override.platform or target_platform).strip().lower() or target_platform
        target_variant = override.variant or target_variant
        preferred_host = override.host or preferred_host
    return target_platform, target_variant, preferred_host


def _resolve_model_auto_launch(project_name: str, base_dir: Path, model_id: str) -> bool:
    config = Config(
        project_name,
        model_id,
        None,
        base_dir,
        dry_run=False,
        stub_install=False,
    )
    launcher = config.model.get("launcher")
    if launcher is None:
        return True
    if not isinstance(launcher, dict):
        raise ValueError(
            f"Model '{model_id}' has invalid 'launcher' section; expected a mapping."
        )
    auto_launch = launcher.get("auto_launch")
    if auto_launch is None:
        return True
    if not isinstance(auto_launch, bool):
        raise ValueError(
            f"Model '{model_id}' has invalid 'launcher.auto_launch'; expected a boolean."
        )
    return auto_launch


def expand_launch_intent(project_path: Path, intent: LaunchIntent) -> ResolvedLaunchIntent:
    project_path = project_path.resolve()
    if not project_path.exists():
        raise FileNotFoundError(f"Project file not found: {project_path}")

    project_name = project_path.stem.removesuffix(".project")
    requested_model_ids = _resolve_requested_model_ids(project_path, intent.scope)
    automatic_selection = _scope_is_automatic(intent.scope)
    model_index = _build_project_model_index(project_path)

    models: list[ResolvedModelLaunch] = []
    selected_model_ids: list[str] = []
    skipped_model_ids: list[str] = []

    for model_id in requested_model_ids:
        model_path = model_index.get(model_id)
        if model_path is None:
            raise FileNotFoundError(f"Model '{model_id}' was not found in project {project_path}")
        override = intent.target_overrides.get(model_id)
        target_platform, target_variant, preferred_host = _resolve_model_target(
            project_name,
            project_path.parent,
            intent.target_policy,
            model_id,
            override,
        )
        auto_launch = _resolve_model_auto_launch(project_name, project_path.parent, model_id)
        selected = (not automatic_selection) or auto_launch
        if selected:
            selected_model_ids.append(model_id)
        else:
            skipped_model_ids.append(model_id)
        models.append(
            ResolvedModelLaunch(
                model_id=model_id,
                model_path=str(model_path),
                target_platform=target_platform,
                target_variant=target_variant,
                preferred_host=preferred_host,
                auto_launch=auto_launch,
                selected=selected,
                stages=list(override.stages if override and override.stages else intent.stage_policy.stages),
            )
        )

    return ResolvedLaunchIntent(
        project=intent.project,
        project_path=str(project_path),
        intent=intent,
        automatic_selection=automatic_selection,
        requested_model_ids=requested_model_ids,
        selected_model_ids=selected_model_ids,
        skipped_model_ids=skipped_model_ids,
        models=models,
    )
