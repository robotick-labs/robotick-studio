from __future__ import annotations

from typing import Callable

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse

from robotick_hub.abilities.base import AbilityManifest, AbilityStatus, HubContext
from robotick_hub.contracts import (
    AppClosingRequest,
    AppClosingResponse,
    StudioActivationResponse,
    StudioControlEndpointRequest,
    StudioControlEndpointResponse,
    StudioInstancesResponse,
    StudioOpenRequest,
    StudioOpenResponse,
    StudioProjectSelectRequest,
    StudioProjectSelectResponse,
    StudioProjectsResponse,
    StudioQuitResponse,
    WorkspaceProjectsResponse,
)
from robotick_hub.workspace import build_workspace_projects
from robotick.studio_ability.domain import (
    activate_studio_resource,
    get_studio_diagnostics,
    get_studio_focused,
    get_studio_capability_status,
    get_studio_status,
    list_instances,
    notify_instance_closing,
    open_studio,
    quit_instance,
    select_studio_project,
    summarize_instance,
    update_instance_control_endpoint,
)


def _selected_project(context: HubContext, instance_id: str) -> str | None:
    payload = get_studio_status(context.workspace_root, instance_id)
    if not isinstance(payload, dict):
        return None
    return str(payload.get("project_name") or "") or None


class StudioAbility:
    manifest = AbilityManifest(
        name="studio",
        version="0.1.0",
        owner="robotick-studio",
        description="Studio process and resource integration for robotick-hub.",
        plugin_shaped=True,
    )

    def build_router(self, context_provider: Callable[[], HubContext]) -> APIRouter:
        router = APIRouter()

        @router.get("/v1/studio/projects", response_model=StudioProjectsResponse)
        def studio_projects(instance_id: str | None = None) -> StudioProjectsResponse:
            context = context_provider()
            projects = build_workspace_projects(context.workspace_root)
            selected_target_project = _selected_project(context, instance_id) if instance_id else None
            return StudioProjectsResponse(
                projects=projects,
                selected_target_project=selected_target_project,
            )

        @router.get("/v1/studio/instances", response_model=StudioInstancesResponse)
        def studio_instances() -> StudioInstancesResponse:
            context = context_provider()
            return StudioInstancesResponse.model_validate(
                {
                    "resource_type": "robotick_studio_instances",
                    "instances": list_instances(context.workspace_root),
                }
            )

        @router.get("/v1/studio/instances/{instance_id}/status", response_class=JSONResponse)
        def studio_instance_status(instance_id: str) -> JSONResponse:
            context = context_provider()
            payload = get_studio_status(context.workspace_root, instance_id)
            if payload is None:
                raise HTTPException(status_code=404, detail=f"Studio instance not found: {instance_id}")
            if "error" in payload:
                return JSONResponse(status_code=503, content=payload)
            return JSONResponse(payload)

        @router.get("/v1/studio/instances/{instance_id}/focused", response_class=JSONResponse)
        def studio_instance_focused(instance_id: str) -> JSONResponse:
            context = context_provider()
            payload = get_studio_focused(context.workspace_root, instance_id)
            if payload is None:
                raise HTTPException(status_code=404, detail=f"Studio instance not found: {instance_id}")
            if "error" in payload:
                return JSONResponse(status_code=503, content=payload)
            return JSONResponse(payload)

        @router.get(
            "/v1/studio/instances/{instance_id}/diagnostics/{kind}",
            response_class=JSONResponse,
        )
        def studio_instance_diagnostics(instance_id: str, kind: str) -> JSONResponse:
            context = context_provider()
            if kind not in {"status", "endpoints", "renderer", "fetch-check", "telemetry"}:
                raise HTTPException(status_code=404, detail=f"Unknown Studio diagnostics kind: {kind}")
            payload = get_studio_diagnostics(context.workspace_root, instance_id, kind)
            if payload is None:
                raise HTTPException(status_code=404, detail=f"Studio instance not found: {instance_id}")
            if "error" in payload:
                return JSONResponse(status_code=503, content=payload)
            return JSONResponse(payload)

        @router.get("/v1/studio/instances/{instance_id}/{resource_path:path}/status", response_class=JSONResponse)
        def studio_node_status(instance_id: str, resource_path: str) -> JSONResponse:
            context = context_provider()
            path_segments = tuple(segment for segment in resource_path.split("/") if segment)
            payload = get_studio_status(context.workspace_root, instance_id, path_segments)
            if payload is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Studio resource not found: {instance_id}/{resource_path}",
                )
            return JSONResponse(payload)

        @router.post("/v1/studio/open", response_model=StudioOpenResponse)
        def studio_open(request: StudioOpenRequest) -> StudioOpenResponse:
            context = context_provider()
            instance, support = open_studio(context.workspace_root, project_name=request.project_name)
            return StudioOpenResponse.model_validate({"instance": instance, "support": support})

        @router.post("/v1/studio/instances/{instance_id}/quit", response_model=StudioQuitResponse)
        def studio_quit(instance_id: str) -> StudioQuitResponse:
            context = context_provider()
            accepted, message, instance = quit_instance(context.workspace_root, instance_id)
            return StudioQuitResponse.model_validate(
                {
                    "accepted": accepted,
                    "message": message,
                    "instance": instance,
                }
            )

        @router.post(
            "/v1/studio/instances/{instance_id}/control-endpoint",
            response_model=StudioControlEndpointResponse,
        )
        def studio_control_endpoint(
            instance_id: str,
            request: StudioControlEndpointRequest,
        ) -> StudioControlEndpointResponse:
            context = context_provider()
            try:
                instance = update_instance_control_endpoint(
                    context.workspace_root,
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

        @router.post(
            "/v1/studio/instances/{instance_id}/project/select",
            response_model=StudioProjectSelectResponse,
        )
        def studio_project_select(
            instance_id: str,
            request: StudioProjectSelectRequest,
        ) -> Response:
            context = context_provider()
            try:
                result = select_studio_project(
                    context.workspace_root,
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
            if "error" in payload:
                return JSONResponse(status_code=status_code, content=payload)
            return JSONResponse(
                status_code=status_code,
                content=StudioProjectSelectResponse.model_validate(payload).model_dump(),
            )

        @router.post("/v1/studio/instances/{instance_id}/activate")
        @router.post("/v1/studio/instances/{instance_id}/{resource_path:path}/activate")
        def studio_resource_activate(instance_id: str, resource_path: str = "") -> Response:
            context = context_provider()
            path_segments = tuple(segment for segment in resource_path.split("/") if segment)
            result = activate_studio_resource(context.workspace_root, instance_id, path_segments)
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

        @router.post("/v1/apps/{app_id}/instances/closing", response_model=AppClosingResponse)
        def app_instance_closing(app_id: str, request: AppClosingRequest) -> AppClosingResponse:
            context = context_provider()
            accepted, message, instance = notify_instance_closing(
                context.workspace_root,
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

        return router

    def get_status(self, context: HubContext) -> AbilityStatus:
        instances = list_instances(context.workspace_root)
        return AbilityStatus(
            name=self.manifest.name,
            version=self.manifest.version,
            status=get_studio_capability_status(context.workspace_root),
            details={"instance_count": len(instances)},
        )
