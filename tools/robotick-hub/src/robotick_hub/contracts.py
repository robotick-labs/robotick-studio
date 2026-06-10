from __future__ import annotations

from pydantic import BaseModel


class HubHealth(BaseModel):
    status: str
    workspace_root: str
    endpoint: str
    api_version: int
    features: list[str]
    tray_expected: bool = False
    tray_active: bool = False


class CapabilitySummary(BaseModel):
    name: str
    kind: str
    status: str
    endpoint: str | None = None


class CapabilityList(BaseModel):
    capabilities: list[CapabilitySummary]


class WorkspaceProject(BaseModel):
    name: str
    project_dir: str
    project_path: str | None = None
    display_name: str | None = None
    description: str | None = None


class WorkspaceProjectsResponse(BaseModel):
    projects: list[WorkspaceProject]


class StudioProjectsResponse(BaseModel):
    projects: list[WorkspaceProject]
    selected_target_project: str | None = None


class StudioInstanceSummary(BaseModel):
    name: str
    pid: int
    mode: str
    started_at: str
    state: str
    project_name: str | None = None
    log_path: str | None = None
    control_endpoint: str | None = None


class StudioInstancesResponse(BaseModel):
    resource_type: str = "robotick_studio_instances"
    instances: list[StudioInstanceSummary]


class StudioOpenRequest(BaseModel):
    project_name: str | None = None


class ActionSummary(BaseModel):
    action: str


class StudioOpenSupport(BaseModel):
    launcher_service: ActionSummary


class StudioOpenResponse(BaseModel):
    instance: StudioInstanceSummary
    support: StudioOpenSupport


class StudioQuitResponse(BaseModel):
    accepted: bool
    message: str
    instance: StudioInstanceSummary | None = None


class StudioControlEndpointRequest(BaseModel):
    endpoint: str


class StudioControlEndpointResponse(BaseModel):
    accepted: bool
    message: str
    instance: StudioInstanceSummary | None = None


class StudioProjectSelectRequest(BaseModel):
    project_path: str


class StudioProjectSelectResponse(BaseModel):
    accepted: bool
    currentProjectPath: str
    issue: dict[str, object] | None = None


class StudioActivationResponse(BaseModel):
    accepted: bool
    changed: bool
    activated_path: list[str]
    previous_active_path: list[str] | None = None
    message: str


class AppClosingRequest(BaseModel):
    pid: int | None = None
    instance_name: str | None = None


class AppClosingResponse(BaseModel):
    accepted: bool
    message: str
    instance: StudioInstanceSummary | None = None


class LauncherEnsureResponse(BaseModel):
    capability_status: str
    endpoint: str
    pid: int | None = None


class LauncherStatusResponse(BaseModel):
    capability_status: str
    endpoint: str | None = None
    pid: int | None = None
    listener_status: dict[str, object] | None = None
