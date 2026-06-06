from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ShellBuiltinSpec:
    name: str
    summary: str


@dataclass(frozen=True)
class NamespaceSpec:
    name: str
    summary: str


@dataclass(frozen=True)
class CommandSpec:
    name: str
    usage: str
    summary: str
    description_lines: tuple[str, ...] = ()
    options_lines: tuple[str, ...] = ()
    shell_label: str | None = None
    visible_in_studio_root: bool = True
    visible_in_bound_instance: bool = False


TOP_LEVEL_NAMESPACES: tuple[NamespaceSpec, ...] = (
    NamespaceSpec("hub", "Inspect the local Robotick hub for this workspace"),
    NamespaceSpec("launcher", "Inspect launcher capability state through robotick-hub"),
    NamespaceSpec("studio", "Open and inspect Robotick Studio projects in this workspace"),
)

TOP_LEVEL_SHELL_BUILTINS: tuple[ShellBuiltinSpec, ...] = (
    ShellBuiltinSpec("ls", "List available namespaces and shell commands"),
    ShellBuiltinSpec("cd", "Enter a context"),
    ShellBuiltinSpec("clear", "Clear the terminal"),
    ShellBuiltinSpec("help", "Show this help"),
    ShellBuiltinSpec("exit", "Leave Robotick"),
)

CONTEXT_SHELL_BUILTINS: tuple[ShellBuiltinSpec, ...] = (
    ShellBuiltinSpec("ls", "List commands in the current context"),
    ShellBuiltinSpec("cd", "Enter a child context"),
    ShellBuiltinSpec("clear", "Clear the terminal"),
    ShellBuiltinSpec("help", "Show context help"),
    ShellBuiltinSpec("back", "Return to the parent shell context"),
    ShellBuiltinSpec("exit", "Leave Robotick"),
)

STUDIO_COMMAND_SPECS: tuple[CommandSpec, ...] = (
    CommandSpec(
        name="projects",
        usage="robotick studio projects [--json]",
        summary="List registered Studio projects from robotick.yaml",
        shell_label="projects",
    ),
    CommandSpec(
        name="instances",
        usage="robotick studio instances [--json]",
        summary="List live Studio instances tracked in .robotick/instances",
        shell_label="instances",
    ),
    CommandSpec(
        name="create",
        usage="robotick studio create [project] [--attach] [studio-args...]",
        summary="Primitive instance creation without changing shell context",
        shell_label="create [project]",
        description_lines=(
            "Create a new Robotick Studio instance without changing shell context.",
            "By default the launch is quiet and writes logs to .robotick/logs/.",
            "Use --attach to inherit the full Studio log stream.",
            "Any extra arguments are forwarded to the project launch script when a project is given.",
        ),
    ),
    CommandSpec(
        name="open",
        usage="robotick studio open [project] [--attach] [studio-args...]",
        summary="Convenience launch; in the immediate shell it creates then enters the instance",
        shell_label="open [project]",
        description_lines=(
            "Convenience launch command. In the immediate shell it creates a new",
            "Robotick Studio instance and enters it immediately.",
            "In one-shot CLI usage it behaves like the create primitive.",
            "By default the launch is quiet and writes logs to .robotick/logs/.",
            "Use --attach to inherit the full Studio log stream.",
            "Any extra arguments are forwarded to the project launch script when a project is given.",
        ),
    ),
    CommandSpec(
        name="quit",
        usage="robotick studio <instance> quit",
        summary="Close this Studio instance",
        shell_label="quit",
        description_lines=("Request shutdown of the targeted Studio instance.",),
        visible_in_studio_root=False,
        visible_in_bound_instance=True,
    ),
)

HUB_COMMAND_SPECS: tuple[CommandSpec, ...] = (
    CommandSpec(
        name="status",
        usage="robotick hub status [--json]",
        summary="Ensure the local Robotick hub and show hub health/capability status",
        shell_label="status",
    ),
    CommandSpec(
        name="projects",
        usage="robotick hub projects [--json]",
        summary="List workspace projects through the hub API",
        shell_label="projects",
    ),
)

LAUNCHER_COMMAND_SPECS: tuple[CommandSpec, ...] = (
    CommandSpec(
        name="status",
        usage="robotick launcher status [--json]",
        summary="Ensure launcher capability through the hub and show launcher status",
        shell_label="status",
    ),
)


def get_studio_command_spec(name: str) -> CommandSpec:
    for spec in STUDIO_COMMAND_SPECS:
        if spec.name == name:
            return spec
    raise KeyError(name)


def get_hub_command_spec(name: str) -> CommandSpec:
    for spec in HUB_COMMAND_SPECS:
        if spec.name == name:
            return spec
    raise KeyError(name)


def get_launcher_command_spec(name: str) -> CommandSpec:
    for spec in LAUNCHER_COMMAND_SPECS:
        if spec.name == name:
            return spec
    raise KeyError(name)


def studio_root_action_names() -> list[str]:
    return [spec.name for spec in STUDIO_COMMAND_SPECS if spec.visible_in_studio_root]


def bound_instance_action_names() -> list[str]:
    return [spec.name for spec in STUDIO_COMMAND_SPECS if spec.visible_in_bound_instance]


def hub_action_names() -> list[str]:
    return [spec.name for spec in HUB_COMMAND_SPECS]


def launcher_action_names() -> list[str]:
    return [spec.name for spec in LAUNCHER_COMMAND_SPECS]
