from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Protocol

from fastapi import APIRouter
from pydantic import BaseModel, Field


class AbilityManifest(BaseModel):
    name: str
    version: str
    owner: str
    plugin_shaped: bool = True
    description: str = ""


class AbilityStatus(BaseModel):
    name: str
    version: str
    status: str
    details: dict[str, object] = Field(default_factory=dict)


@dataclass(frozen=True)
class HubContext:
    workspace_root: str
    endpoint: str
    tray_expected: bool
    tray_active: bool


class BuiltInAbility(Protocol):
    manifest: AbilityManifest

    def build_router(self, context_provider: Callable[[], HubContext]) -> APIRouter:
        ...

    def get_status(self, context: HubContext) -> AbilityStatus:
        ...
