from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from robotick_hub.contracts import (
    AppClosingRequest,
    AppClosingResponse,
    CapabilityList,
    CapabilitySummary,
    HubHealth,
    LauncherEnsureResponse,
    LauncherStatusResponse,
    StudioInstancesResponse,
    StudioOpenRequest,
    StudioOpenResponse,
    StudioProjectsResponse,
    StudioQuitResponse,
    WorkspaceProject,
    WorkspaceProjectsResponse,
)
from robotick_hub.launcher import ensure_launcher, get_launcher_status, stop_launcher
from robotick_hub.manifest import load_manifest
from robotick_hub.runtime import remove_hub_record, write_hub_record
from robotick_hub.studio import (
    get_instance,
    list_instances,
    notify_instance_closing,
    open_studio,
    quit_instance,
)


def get_workspace_root() -> str:
    return os.environ["ROBOTICK_WORKSPACE_ROOT"]


def get_endpoint() -> str:
    host = os.environ.get("ROBOTICK_HUB_HOST", "127.0.0.1")
    port = os.environ["ROBOTICK_HUB_PORT"]
    return f"http://{host}:{port}"


def tray_expected() -> bool:
    return os.environ.get("ROBOTICK_HUB_EXPECT_TRAY") == "1"


def tray_active() -> bool:
    return os.environ.get("ROBOTICK_HUB_TRAY_ACTIVE") == "1"


def build_capabilities() -> list[CapabilitySummary]:
    launcher_status = get_launcher_status(get_workspace_root())
    return [
        CapabilitySummary(name="workspace", kind="embedded", status="healthy"),
        CapabilitySummary(name="studio", kind="discovered", status="hello-world"),
        CapabilitySummary(
            name="launcher",
            kind="managed",
            status=launcher_status["capability_status"],
            endpoint=launcher_status["endpoint"],
        ),
    ]


@asynccontextmanager
async def lifespan(app: FastAPI):
    write_hub_record(
        get_workspace_root(),
        get_endpoint(),
        os.getpid(),
        tray_expected=tray_expected(),
        tray_active=tray_active(),
        python_executable=os.environ.get("ROBOTICK_HUB_PYTHON_EXECUTABLE"),
    )
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
            tray_expected=tray_expected(),
            tray_active=tray_active(),
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
    def studio_projects(instance_id: str | None = None) -> StudioProjectsResponse:
        manifest = load_manifest(get_workspace_root())
        projects = [
            WorkspaceProject(
                name=name,
                project_dir=project.project_dir,
                launch_script=project.launch_script,
            )
            for name, project in manifest.projects.items()
        ]
        selected_target_project = None
        if instance_id:
            instance = get_instance(get_workspace_root(), instance_id)
            if instance is not None:
                selected_target_project = str(instance.get("project_name") or "") or None
        return StudioProjectsResponse(
            projects=projects,
            selected_target_project=selected_target_project,
        )

    @app.get("/v1/studio/instances", response_model=StudioInstancesResponse)
    def studio_instances() -> StudioInstancesResponse:
        return StudioInstancesResponse.model_validate(
            {"instances": list_instances(get_workspace_root())}
        )

    @app.post("/v1/studio/open", response_model=StudioOpenResponse)
    def studio_open(request: StudioOpenRequest) -> StudioOpenResponse:
        return StudioOpenResponse.model_validate(
            {"instance": open_studio(get_workspace_root(), project_name=request.project_name)}
        )

    @app.post("/v1/studio/instances/{instance_id}/quit", response_model=StudioQuitResponse)
    def studio_quit(instance_id: str) -> StudioQuitResponse:
        accepted, message, instance = quit_instance(get_workspace_root(), instance_id)
        return StudioQuitResponse.model_validate(
            {
                "accepted": accepted,
                "message": message,
                "instance": instance,
            }
        )

    @app.post("/v1/apps/{app_id}/instances/closing", response_model=AppClosingResponse)
    def app_instance_closing(app_id: str, request: AppClosingRequest) -> AppClosingResponse:
        accepted, message, instance = notify_instance_closing(
            get_workspace_root(),
            app_id=app_id,
            process_id=request.pid,
            instance_name=request.instance_name,
        )
        return AppClosingResponse.model_validate(
            {
                "accepted": accepted,
                "message": message,
                "instance": instance,
            }
        )

    @app.post("/v1/capabilities/launcher/ensure", response_model=LauncherEnsureResponse)
    def launcher_ensure() -> LauncherEnsureResponse:
        record = ensure_launcher(get_workspace_root())
        return LauncherEnsureResponse(
            capability_status="healthy",
            endpoint=record.endpoint,
            pid=record.pid,
        )

    @app.get("/v1/launcher/status", response_model=LauncherStatusResponse)
    def launcher_status() -> LauncherStatusResponse:
        return LauncherStatusResponse.model_validate(get_launcher_status(get_workspace_root()))

    @app.post("/v1/launcher/stop", response_model=LauncherStatusResponse)
    def launcher_stop() -> LauncherStatusResponse:
        return LauncherStatusResponse.model_validate(stop_launcher(get_workspace_root()))

    return app


app = create_app()
