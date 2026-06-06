from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from robotick_hub.contracts import (
    CapabilityList,
    CapabilitySummary,
    HubHealth,
    StudioProjectsResponse,
    WorkspaceProject,
    WorkspaceProjectsResponse,
)
from robotick_hub.manifest import load_manifest
from robotick_hub.runtime import remove_hub_record, write_hub_record


def get_workspace_root() -> str:
    return os.environ["ROBOTICK_WORKSPACE_ROOT"]


def get_endpoint() -> str:
    host = os.environ.get("ROBOTICK_HUB_HOST", "127.0.0.1")
    port = os.environ["ROBOTICK_HUB_PORT"]
    return f"http://{host}:{port}"


def build_capabilities() -> list[CapabilitySummary]:
    return [
        CapabilitySummary(name="workspace", kind="embedded", status="healthy"),
        CapabilitySummary(name="studio", kind="discovered", status="hello-world"),
        CapabilitySummary(name="launcher", kind="managed", status="not-yet-routed"),
    ]


@asynccontextmanager
async def lifespan(app: FastAPI):
    write_hub_record(get_workspace_root(), get_endpoint(), os.getpid())
    try:
        yield
    finally:
        remove_hub_record(get_workspace_root())


def create_app() -> FastAPI:
    app = FastAPI(title="robotick-hub", version="0.1.0", lifespan=lifespan)

    @app.get("/v1/health", response_model=HubHealth)
    def health() -> HubHealth:
        return HubHealth(
            status="ok",
            workspace_root=get_workspace_root(),
            endpoint=get_endpoint(),
        )

    @app.get("/v1/capabilities", response_model=CapabilityList)
    def capabilities() -> CapabilityList:
        return CapabilityList(capabilities=build_capabilities())

    @app.get("/v1/workspace/projects", response_model=WorkspaceProjectsResponse)
    def workspace_projects() -> WorkspaceProjectsResponse:
        manifest = load_manifest(get_workspace_root())
        projects = [
            WorkspaceProject(
                name=name,
                project_dir=project.project_dir,
                launch_script=project.launch_script,
            )
            for name, project in manifest.projects.items()
        ]
        return WorkspaceProjectsResponse(projects=projects)

    @app.get("/v1/studio/projects", response_model=StudioProjectsResponse)
    def studio_projects() -> StudioProjectsResponse:
        manifest = load_manifest(get_workspace_root())
        projects = [
            WorkspaceProject(
                name=name,
                project_dir=project.project_dir,
                launch_script=project.launch_script,
            )
            for name, project in manifest.projects.items()
        ]
        return StudioProjectsResponse(projects=projects, selected_target_project=None)

    return app


app = create_app()
