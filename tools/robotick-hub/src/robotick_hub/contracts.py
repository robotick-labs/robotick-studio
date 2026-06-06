from __future__ import annotations

from pydantic import BaseModel


class HubHealth(BaseModel):
    status: str
    workspace_root: str
    endpoint: str
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
    launch_script: str


class WorkspaceProjectsResponse(BaseModel):
    projects: list[WorkspaceProject]


class StudioProjectsResponse(BaseModel):
    projects: list[WorkspaceProject]
    selected_target_project: str | None = None
