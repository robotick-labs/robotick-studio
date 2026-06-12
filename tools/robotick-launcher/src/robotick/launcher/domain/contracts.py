from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
import secrets
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _new_resource_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


class ScopeKind(str, Enum):
    ALL = "ALL"
    PROFILE = "profile"
    MODELS = "models"
    MODEL = "model"


class TargetPolicy(str, Enum):
    LOCAL = "local"
    NATIVE = "native"


class StagePolicyKind(str, Enum):
    DEFAULT = "default"
    EXPLICIT = "explicit"


class DependencyPolicy(str, Enum):
    EXACT = "exact"


class CreatorClient(str, Enum):
    STUDIO = "studio"
    CLI = "robotick-cli"
    OTHER = "other"


class SessionLifecycle(str, Enum):
    PLANNED = "planned"
    STARTING = "starting"
    HANDED_OFF = "handed_off"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    FAILED = "failed"
    STALE = "stale"


class GroupStatus(str, Enum):
    STARTING = "starting"
    RUNNING = "running"
    DEGRADED = "degraded"
    STOPPED = "stopped"
    FAILED = "failed"
    STALE = "stale"


class Diagnostics(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class CreatorMetadata(BaseModel):
    client: CreatorClient = CreatorClient.OTHER
    instance_id: str | None = None


class DesiredRuntime(BaseModel):
    telemetry: bool = True
    control: bool = True


class StagePolicy(BaseModel):
    kind: StagePolicyKind = StagePolicyKind.DEFAULT
    stages: list[str] = Field(default_factory=list)

    @field_validator("stages")
    @classmethod
    def validate_stages(cls, value: list[str]) -> list[str]:
        cleaned = [stage.strip() for stage in value if stage.strip()]
        if len(cleaned) != len(value):
            raise ValueError("Stage names must be non-empty strings.")
        return cleaned

    @model_validator(mode="after")
    def validate_policy(self) -> StagePolicy:
        if self.kind == StagePolicyKind.DEFAULT and self.stages:
            raise ValueError("Default stage policy cannot declare explicit stages.")
        if self.kind == StagePolicyKind.EXPLICIT and not self.stages:
            raise ValueError("Explicit stage policy requires at least one stage.")
        return self


class LaunchScope(BaseModel):
    kind: ScopeKind
    value: str | list[str]

    @model_validator(mode="after")
    def validate_scope(self) -> LaunchScope:
        if self.kind in {ScopeKind.ALL, ScopeKind.PROFILE, ScopeKind.MODEL}:
            if not isinstance(self.value, str) or not self.value.strip():
                raise ValueError(f"Scope '{self.kind.value}' requires a non-empty string value.")
            if self.kind == ScopeKind.ALL and self.value != "ALL":
                raise ValueError("Scope kind 'ALL' must use the literal value 'ALL'.")
        elif self.kind == ScopeKind.MODELS:
            if not isinstance(self.value, list) or not self.value:
                raise ValueError("Scope kind 'models' requires a non-empty list of model ids.")
            if any(not isinstance(item, str) or not item.strip() for item in self.value):
                raise ValueError("Scope kind 'models' requires non-empty model id strings.")
        return self


class TargetOverride(BaseModel):
    platform: str | None = None
    variant: str | None = None
    host: str | None = None
    stages: list[str] = Field(default_factory=list)

    @field_validator("platform", "variant", "host")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("stages")
    @classmethod
    def validate_override_stages(cls, value: list[str]) -> list[str]:
        cleaned = [stage.strip() for stage in value if stage.strip()]
        if len(cleaned) != len(value):
            raise ValueError("Override stages must be non-empty strings.")
        return cleaned


class LaunchIntent(BaseModel):
    project: str
    scope: LaunchScope
    target_policy: TargetPolicy
    target_overrides: dict[str, TargetOverride] = Field(default_factory=dict)
    stage_policy: StagePolicy = Field(default_factory=StagePolicy)
    dependency_policy: DependencyPolicy = DependencyPolicy.EXACT
    desired_runtime: DesiredRuntime = Field(default_factory=DesiredRuntime)
    created_by: CreatorMetadata = Field(default_factory=CreatorMetadata)

    @field_validator("project")
    @classmethod
    def validate_project(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Project name must be non-empty.")
        return cleaned


class ResolvedModelLaunch(BaseModel):
    model_id: str
    model_path: str
    target_platform: str
    target_variant: str | None = None
    preferred_host: str | None = None
    auto_launch: bool = True
    selected: bool = True
    stages: list[str] = Field(default_factory=list)


class ResolvedLaunchIntent(BaseModel):
    project: str
    project_path: str
    intent: LaunchIntent
    automatic_selection: bool
    requested_model_ids: list[str]
    selected_model_ids: list[str]
    skipped_model_ids: list[str]
    models: list[ResolvedModelLaunch]


class ModelSessionRecord(BaseModel):
    resource_type: Literal["model_session"] = "model_session"
    id: str = Field(default_factory=lambda: _new_resource_id("ms"))
    group_id: str
    project_id: str
    model_id: str
    generation: int = 1
    target: TargetOverride = Field(default_factory=TargetOverride)
    lifecycle: SessionLifecycle = SessionLifecycle.PLANNED
    readiness: Literal["pending", "ready", "stale", "failed"] = "pending"
    created_by: CreatorMetadata = Field(default_factory=CreatorMetadata)
    diagnostics: list[Diagnostics] = Field(default_factory=list)
    runtime: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    last_confirmed_at: datetime | None = None


class ModelSessionGroupRecord(BaseModel):
    resource_type: Literal["model_session_group"] = "model_session_group"
    id: str = Field(default_factory=lambda: _new_resource_id("msg"))
    workspace_id: str
    project_id: str
    project_path: str
    intent: LaunchIntent
    resolved_model_ids: list[str]
    status: GroupStatus = GroupStatus.STARTING
    readiness: Literal["pending", "ready", "stale", "failed"] = "pending"
    created_by: CreatorMetadata = Field(default_factory=CreatorMetadata)
    diagnostics: list[Diagnostics] = Field(default_factory=list)
    session_ids: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    last_confirmed_at: datetime | None = None
