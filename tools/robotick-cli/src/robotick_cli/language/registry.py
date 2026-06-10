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
        usage="robotick studio projects",
        summary="List registered Studio projects from robotick.yaml",
        shell_label="projects",
    ),
    CommandSpec(
        name="instances",
        usage="robotick studio instances",
        summary="List live Studio instances tracked in .robotick/instances",
        shell_label="instances",
    ),
    CommandSpec(
        name="create",
        usage="robotick studio create [project]",
        summary="Primitive instance creation without changing shell context",
        shell_label="create [project]",
        description_lines=(
            "Create a new Robotick Studio instance without changing shell context.",
            "By default the launch is quiet and writes logs to .robotick/logs/.",
            "Studio launch now routes through robotick-hub.",
        ),
    ),
    CommandSpec(
        name="open",
        usage="robotick studio open [project] [path...] [action]",
        summary="Convenience launch; in the immediate shell it creates then enters the instance",
        shell_label="open [project]",
        description_lines=(
            "Convenience launch command. In the immediate shell it creates a new",
            "Robotick Studio instance and enters it immediately.",
            "In one-shot CLI usage it prints a JSON launch result.",
            "Trailing path/action tokens run inside the newly opened instance.",
            "By default the launch is quiet and writes logs to .robotick/logs/.",
            "Studio launch now routes through robotick-hub.",
        ),
    ),
    CommandSpec(
        name="status",
        usage="robotick studio <instance> status",
        summary="Print the currently bound Studio resource as JSON",
        shell_label="status",
        description_lines=("Print the targeted Studio resource as JSON structured state.",),
        visible_in_studio_root=False,
        visible_in_bound_instance=True,
    ),
    CommandSpec(
        name="select-project",
        usage="robotick studio <instance> select-project <project>",
        summary="Switch the selected project inside this Studio instance",
        shell_label="select-project [project]",
        description_lines=("Ask the targeted Studio instance to switch to a registered project.",),
        visible_in_studio_root=False,
        visible_in_bound_instance=True,
    ),
    CommandSpec(
        name="activate",
        usage="robotick studio <instance> <path...> activate",
        summary="Make the current Studio resource active",
        shell_label="activate",
        description_lines=(
            "Ask the targeted Studio instance to activate the current window, workbench, layout, or panel.",
        ),
        visible_in_studio_root=False,
        visible_in_bound_instance=True,
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
        usage="robotick hub status",
        summary="Query local Robotick hub status as JSON without starting it",
        shell_label="status",
    ),
    CommandSpec(
        name="ensure",
        usage="robotick hub ensure",
        summary="Start or reuse the local Robotick hub and report the result as JSON",
        shell_label="ensure",
    ),
    CommandSpec(
        name="projects",
        usage="robotick hub projects",
        summary="List workspace projects through the hub API",
        shell_label="projects",
    ),
)

LAUNCHER_COMMAND_SPECS: tuple[CommandSpec, ...] = (
    CommandSpec(
        name="status",
        usage="robotick launcher status",
        summary="Query launcher service status as JSON without starting it",
        shell_label="status",
    ),
    CommandSpec(
        name="ensure",
        usage="robotick launcher ensure",
        summary="Start or reuse the launcher service and report the result as JSON",
        shell_label="ensure",
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
