# robotick/launcher/schema/workload_yaml_model.py

from typing import List, Optional, Dict, Union, Literal
from pydantic import BaseModel, Field

# Source variants per type


class AptSource(BaseModel):
    type: Literal["apt"]
    package: str
    pin: Optional[str] = None


class GitSource(BaseModel):
    type: Literal["git"]
    url: str
    pin: Optional[str] = None
    dest: Optional[str] = None


class PkgConfigSource(BaseModel):
    type: Literal["pkgconfig"]
    module: str
    pin: Optional[str] = None


class IdfSource(BaseModel):
    type: Literal["idf"]
    component: str
    pin: Optional[str] = None


class WorkloadCMakeSource(BaseModel):
    type: Literal["workload_cmake"]
    path: Optional[str] = None


# Unified source union
SourceSpec = Union[
    AptSource, GitSource, PkgConfigSource, IdfSource, WorkloadCMakeSource
]


class Dependency(BaseModel):
    name: str
    source: SourceSpec
    find_package: Optional[str] = None
    components: Optional[List[str]] = None
    pkg_prefix: Optional[str] = None
    link_target: Optional[str] = None
    include_dirs: Optional[List[str]] = Field(default_factory=list)
    link_libraries: Optional[List[str]] = Field(default_factory=list)
    optional: Optional[bool] = False
    cmake_subdir: Optional[str] = None  # e.g. ".", "src"
    cmake_options: Dict[str, Union[str, int]] = Field(default_factory=dict)


class PlatformSpec(BaseModel):
    files: List[str] = Field(default_factory=list)
    deps: List[Dependency] = Field(default_factory=list)


class WorkloadSpec(BaseModel):
    platforms: Dict[str, PlatformSpec] = Field(default_factory=dict)


# Convenience alias for runtime discovery code
ParsedWorkloadMap = Dict[str, WorkloadSpec]
