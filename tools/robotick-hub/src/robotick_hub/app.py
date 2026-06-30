from __future__ import annotations

import os
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

from robotick_hub.abilities.base import HubContext
from robotick_hub.contracts import (
    AbilityListResponse,
    AbilityManifestResponse,
    AbilityStatusResponse,
    AppClosingRequest,
    AppClosingResponse,
    CapabilityList,
    CapabilitySummary,
    HubHealth,
    StudioInstancesResponse,
    StudioOpenRequest,
    StudioOpenResponse,
    StudioControlEndpointRequest,
    StudioControlEndpointResponse,
    StudioActivationResponse,
    StudioProjectSelectRequest,
    StudioProjectSelectResponse,
    StudioProjectsResponse,
    StudioQuitResponse,
    WorkspaceProject,
    WorkspaceProjectsResponse,
)
from robotick_hub.runtime import remove_hub_record, write_hub_record
from robotick_hub.workspace import (
    build_workspace_projects,
    get_project_model,
    get_project_rc_settings,
    get_project_settings,
    list_project_model_paths,
    list_workspace_project_paths,
    resolve_project_asset_path,
)
from robotick.launcher.hub_ability import LauncherAbility
from robotick.studio_ability.hub_ability import StudioAbility

HUB_API_VERSION = 1
HUB_FEATURES = [
    "hub_health_protocol",
    "hub_abilities",
    "workspace_projects",
    "studio_instances",
    "studio_status",
    "studio_control_endpoint",
    "studio_project_select",
    "studio_activation",
    "studio_focused",
    "launcher_status",
    "launcher_ensure",
]


def get_workspace_config_capability_status() -> str:
    try:
        build_workspace_projects(get_workspace_root())
    except Exception:
        return "unavailable"
    return "available"


def get_endpoint() -> str:
    host = os.environ.get("ROBOTICK_HUB_HOST", "127.0.0.1")
    port = os.environ["ROBOTICK_HUB_PORT"]
    return f"http://{host}:{port}"


def tray_expected() -> bool:
    return os.environ.get("ROBOTICK_HUB_EXPECT_TRAY") == "1"


def tray_active() -> bool:
    return os.environ.get("ROBOTICK_HUB_TRAY_ACTIVE") == "1"


def get_hub_context() -> HubContext:
    return HubContext(
        workspace_root=get_workspace_root(),
        endpoint=get_endpoint(),
        tray_expected=tray_expected(),
        tray_active=tray_active(),
    )


def get_built_in_abilities() -> list[object]:
    return [StudioAbility(), LauncherAbility()]


def build_capabilities() -> list[CapabilitySummary]:
    ability_status = {ability.manifest.name: ability.get_status(get_hub_context()) for ability in get_built_in_abilities()}
    return [
        CapabilitySummary(
            name="query-workspace-config",
            kind="embedded",
            status=get_workspace_config_capability_status(),
        ),
        CapabilitySummary(
            name="launch-studio",
            kind="managed",
            status=ability_status["studio"].status,
        ),
        CapabilitySummary(
            name="query-launcher-status",
            kind="embedded",
            status=ability_status["launcher"].status,
        ),
        CapabilitySummary(
            name="ensure-launcher-service",
            kind="embedded",
            status=ability_status["launcher"].status,
        ),
    ]


def get_workspace_root() -> str:
    return os.environ["ROBOTICK_WORKSPACE_ROOT"]


def _resolve_registered_project_path(project_path: str) -> str:
    resolved_project_path = str(Path(project_path).resolve())
    registered_paths = {
        str(Path(candidate).resolve())
        for candidate in list_workspace_project_paths(get_workspace_root())
    }
    if resolved_project_path not in registered_paths:
        raise FileNotFoundError(
            f"Project file is not registered in this workspace: {resolved_project_path}"
        )
    return resolved_project_path


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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["null"],
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/v1/health", response_model=HubHealth)
    def health() -> HubHealth:
        return HubHealth(
            status="ok",
            workspace_root=get_workspace_root(),
            endpoint=get_endpoint(),
            api_version=HUB_API_VERSION,
            features=HUB_FEATURES,
            tray_expected=tray_expected(),
            tray_active=tray_active(),
        )

    @app.get("/v1/capabilities", response_model=CapabilityList)
    def capabilities() -> CapabilityList:
        return CapabilityList(capabilities=build_capabilities())

    @app.get("/v1/abilities", response_model=AbilityListResponse)
    def abilities() -> AbilityListResponse:
        return AbilityListResponse(
            abilities=[
                AbilityManifestResponse.model_validate(ability.manifest.model_dump())
                for ability in get_built_in_abilities()
            ]
        )

    @app.get("/v1/abilities/{ability_name}/status", response_model=AbilityStatusResponse)
    def ability_status(ability_name: str) -> AbilityStatusResponse:
        for ability in get_built_in_abilities():
            if ability.manifest.name == ability_name:
                return AbilityStatusResponse.model_validate(
                    ability.get_status(get_hub_context()).model_dump()
                )
        raise HTTPException(status_code=404, detail=f"Unknown ability: {ability_name}")

    @app.get("/v1/workspace/projects", response_model=WorkspaceProjectsResponse)
    def workspace_projects() -> WorkspaceProjectsResponse:
        return WorkspaceProjectsResponse(projects=build_workspace_projects(get_workspace_root()))

    @app.get("/query/list-projects", response_model=list[str])
    def query_list_projects() -> list[str]:
        return list_workspace_project_paths(get_workspace_root())

    @app.get("/query/get-project-settings", response_class=JSONResponse)
    def query_get_project_settings(
        project_path: str = Query(..., description="Absolute path to the project YAML file")
    ) -> JSONResponse:
        try:
            return JSONResponse(get_project_settings(_resolve_registered_project_path(project_path)))
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @app.get("/query/get-project-rc-settings", response_class=JSONResponse)
    def query_get_project_rc_settings(
        project_path: str = Query(..., description="Absolute path to the project YAML file")
    ) -> JSONResponse:
        try:
            return JSONResponse(get_project_rc_settings(_resolve_registered_project_path(project_path)))
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @app.get("/query/list-project-models", response_model=list[str])
    def query_list_project_models(
        project_path: str = Query(..., description="Absolute path to the project YAML file")
    ) -> list[str]:
        try:
            return list_project_model_paths(_resolve_registered_project_path(project_path))
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.get("/query/get-model", response_class=JSONResponse)
    def query_get_model(
        project_path: str = Query(..., description="Absolute path to the project YAML file"),
        model_path: str = Query(
            ..., description="Relative path to the model YAML, from the project folder"
        ),
    ) -> JSONResponse:
        try:
            return JSONResponse(
                get_project_model(_resolve_registered_project_path(project_path), model_path)
            )
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.get("/query/project-assets/{asset_path:path}", response_class=FileResponse)
    def query_project_asset(
        asset_path: str,
        project_path: str = Query(..., description="Absolute path to the project YAML file"),
    ) -> FileResponse:
        try:
            return FileResponse(
                path=resolve_project_asset_path(
                    _resolve_registered_project_path(project_path), asset_path
                )
            )
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    for ability in get_built_in_abilities():
        app.include_router(ability.build_router(get_hub_context))

    return app


app = create_app()
