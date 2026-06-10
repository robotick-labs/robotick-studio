from __future__ import annotations

import os
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
import websockets

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
from robotick_hub.launcher import (
    ensure_launcher,
    get_launcher_status,
    proxy_launcher_request,
    stop_launcher,
)
from robotick_hub.runtime import remove_hub_record, write_hub_record
from robotick_hub.studio import (
    get_instance,
    get_instance_status,
    get_studio_status,
    get_studio_capability_status,
    list_instances,
    notify_instance_closing,
    open_studio,
    quit_instance,
    activate_studio_resource,
    select_studio_project,
    summarize_instance,
    update_instance_control_endpoint,
)
from robotick_hub.workspace import (
    build_workspace_projects,
    get_project_model,
    get_project_rc_settings,
    get_project_settings,
    list_project_model_paths,
    list_workspace_project_paths,
    resolve_project_asset_path,
)

HUB_API_VERSION = 1
HUB_FEATURES = [
    "hub_health_protocol",
    "workspace_projects",
    "studio_instances",
    "studio_status",
    "studio_control_endpoint",
    "studio_project_select",
    "studio_activation",
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


def build_capabilities() -> list[CapabilitySummary]:
    return [
        CapabilitySummary(
            name="query-workspace-config",
            kind="embedded",
            status=get_workspace_config_capability_status(),
        ),
        CapabilitySummary(
            name="launch-studio",
            kind="managed",
            status=get_studio_capability_status(get_workspace_root()),
        ),
        CapabilitySummary(
            name="query-launcher-status",
            kind="managed",
            status="available",
        ),
        CapabilitySummary(
            name="ensure-launcher-service",
            kind="managed",
            status="available",
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


def _proxyable_headers(request: Request) -> dict[str, str]:
    forwarded: dict[str, str] = {}
    content_type = request.headers.get("content-type")
    if content_type:
        forwarded["content-type"] = content_type
    accept = request.headers.get("accept")
    if accept:
        forwarded["accept"] = accept
    return forwarded


def _launcher_http_proxy(
    request: Request,
    path: str,
    *,
    method: str,
    body: bytes | None = None,
) -> Response:
    record = ensure_launcher(get_workspace_root())
    query_params = dict(request.query_params.multi_items())
    status_code, payload, headers = proxy_launcher_request(
        record,
        method,
        path,
        params=query_params,
        body=body,
        headers=_proxyable_headers(request),
    )
    content_type = headers.get("Content-Type", "application/json")
    return Response(content=payload, status_code=status_code, media_type=content_type)


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

    @app.get("/v1/workspace/projects", response_model=WorkspaceProjectsResponse)
    def workspace_projects() -> WorkspaceProjectsResponse:
        return WorkspaceProjectsResponse(projects=build_workspace_projects(get_workspace_root()))

    @app.get("/v1/studio/projects", response_model=StudioProjectsResponse)
    def studio_projects(instance_id: str | None = None) -> StudioProjectsResponse:
        projects = build_workspace_projects(get_workspace_root())
        selected_target_project = None
        if instance_id:
            instance = get_instance(get_workspace_root(), instance_id)
            if instance is not None:
                selected_target_project = str(instance.get("project_name") or "") or None
        return StudioProjectsResponse(
            projects=projects,
            selected_target_project=selected_target_project,
        )

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

    @app.get("/query/get-workloads-registry")
    async def query_get_workloads_registry(request: Request) -> Response:
        return _launcher_http_proxy(request, "/query/get-workloads-registry", method="GET")

    @app.get("/query/get-core-model-schema")
    async def query_get_core_model_schema(request: Request) -> Response:
        return _launcher_http_proxy(request, "/query/get-core-model-schema", method="GET")

    @app.get("/v1/studio/instances", response_model=StudioInstancesResponse)
    def studio_instances() -> StudioInstancesResponse:
        return StudioInstancesResponse.model_validate(
            {"resource_type": "robotick_studio_instances", "instances": list_instances(get_workspace_root())}
        )

    @app.get("/v1/studio/instances/{instance_id}/status", response_class=JSONResponse)
    def studio_instance_status(instance_id: str) -> JSONResponse:
        payload = get_studio_status(get_workspace_root(), instance_id)
        if payload is None:
            raise HTTPException(status_code=404, detail=f"Studio instance not found: {instance_id}")
        return JSONResponse(payload)

    @app.get("/v1/studio/instances/{instance_id}/{resource_path:path}/status", response_class=JSONResponse)
    def studio_node_status(instance_id: str, resource_path: str) -> JSONResponse:
        path_segments = tuple(segment for segment in resource_path.split("/") if segment)
        payload = get_studio_status(get_workspace_root(), instance_id, path_segments)
        if payload is None:
            raise HTTPException(
                status_code=404,
                detail=f"Studio resource not found: {instance_id}/{resource_path}",
            )
        return JSONResponse(payload)

    @app.post("/v1/studio/open", response_model=StudioOpenResponse)
    def studio_open(request: StudioOpenRequest) -> StudioOpenResponse:
        instance, support = open_studio(get_workspace_root(), project_name=request.project_name)
        return StudioOpenResponse.model_validate(
            {"instance": instance, "support": support}
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

    @app.post(
        "/v1/studio/instances/{instance_id}/control-endpoint",
        response_model=StudioControlEndpointResponse,
    )
    def studio_control_endpoint(
        instance_id: str,
        request: StudioControlEndpointRequest,
    ) -> StudioControlEndpointResponse:
        try:
            instance = update_instance_control_endpoint(
                get_workspace_root(),
                instance_id,
                request.endpoint,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        if instance is None:
            raise HTTPException(status_code=404, detail=f"Studio instance not found: {instance_id}")
        return StudioControlEndpointResponse.model_validate(
            {
                "accepted": True,
                "message": f"Studio control endpoint registered for {instance.name}.",
                "instance": summarize_instance(instance),
            }
        )

    @app.post(
        "/v1/studio/instances/{instance_id}/project/select",
        response_model=StudioProjectSelectResponse,
    )
    def studio_project_select(
        instance_id: str,
        request: StudioProjectSelectRequest,
    ) -> Response:
        try:
            result = select_studio_project(
                get_workspace_root(),
                instance_id,
                request.project_path,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        if result is None:
            raise HTTPException(
                status_code=404,
                detail=f"Studio control endpoint not available for: {instance_id}",
            )
        status_code, payload = result
        return JSONResponse(
            status_code=status_code,
            content=StudioProjectSelectResponse.model_validate(payload).model_dump(),
        )

    @app.post("/v1/studio/instances/{instance_id}/activate")
    @app.post("/v1/studio/instances/{instance_id}/{resource_path:path}/activate")
    def studio_resource_activate(
        instance_id: str,
        resource_path: str = "",
    ) -> Response:
        path_segments = tuple(segment for segment in resource_path.split("/") if segment)
        result = activate_studio_resource(get_workspace_root(), instance_id, path_segments)
        if result is None:
            raise HTTPException(
                status_code=404,
                detail=f"Studio control endpoint not available for: {instance_id}",
            )
        status_code, payload = result
        if "error" in payload:
            return JSONResponse(status_code=status_code, content=payload)
        return JSONResponse(
            status_code=status_code,
            content=StudioActivationResponse.model_validate(payload).model_dump(),
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

    @app.post("/launcher/run")
    async def launcher_run(request: Request) -> Response:
        return _launcher_http_proxy(request, "/launcher/run", method="POST")

    @app.post("/launcher/run-model")
    async def launcher_run_model(request: Request) -> Response:
        return _launcher_http_proxy(request, "/launcher/run-model", method="POST")

    @app.post("/launcher/stop")
    async def launcher_stop_proxy(request: Request) -> Response:
        return _launcher_http_proxy(request, "/launcher/stop", method="POST")

    @app.post("/launcher/stop-model")
    async def launcher_stop_model(request: Request) -> Response:
        return _launcher_http_proxy(request, "/launcher/stop-model", method="POST")

    @app.get("/launcher/status")
    async def launcher_status_proxy(request: Request) -> Response:
        return _launcher_http_proxy(request, "/launcher/status", method="GET")

    @app.websocket("/launcher/ws/log")
    async def launcher_log_proxy(websocket: WebSocket) -> None:
        await websocket.accept()
        record = ensure_launcher(get_workspace_root())
        launcher_ws_url = record.endpoint.replace("http://", "ws://").replace(
            "https://", "wss://"
        ) + "/launcher/ws/log"
        try:
            async with websockets.connect(launcher_ws_url) as upstream:
                while True:
                    message = await upstream.recv()
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(message)
        except WebSocketDisconnect:
            return
        except Exception as error:
            await websocket.close(code=1011, reason=str(error)[:120])

    return app


app = create_app()
