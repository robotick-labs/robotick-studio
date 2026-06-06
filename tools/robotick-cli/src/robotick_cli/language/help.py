from __future__ import annotations

from robotick_cli.app.context import ShellState
from robotick_cli.instances import format_instance_contexts, list_live_instances
from robotick_cli.language.registry import (
    CONTEXT_SHELL_BUILTINS,
    TOP_LEVEL_NAMESPACES,
    TOP_LEVEL_SHELL_BUILTINS,
    bound_instance_action_names,
    get_studio_command_spec,
    studio_root_action_names,
)


def get_prompt(state: ShellState) -> str:
    if state.namespace is None:
        return "robotick> "
    if state.namespace == "studio" and state.instance_name is not None:
        return f"robotick:studio:{state.instance_name}> "
    return f"robotick:{state.namespace}> "


def get_studio_help_text() -> str:
    root_specs = [get_studio_command_spec(name) for name in studio_root_action_names()]
    quit_spec = get_studio_command_spec("quit")
    return "\n".join(
        [
            "Usage:",
            *[f"  {spec.usage}" for spec in root_specs],
            f"  {quit_spec.usage}",
            "",
            "Commands:",
            *[f"  {spec.name:<10}{spec.summary}" for spec in root_specs],
            "",
        ]
    )


def format_shell_help(state: ShellState) -> str:
    if state.namespace is None:
        return "\n".join(
            [
                "Top-level shell commands:",
                *[f"  {spec.name:<8} {spec.summary}" for spec in TOP_LEVEL_SHELL_BUILTINS],
                *[f"  {spec.name:<8} {spec.summary}" for spec in TOP_LEVEL_NAMESPACES],
                "",
            ]
        )

    current_context = (
        f"studio/{state.instance_name}"
        if state.namespace == "studio" and state.instance_name is not None
        else state.namespace
    )

    lines = [f"Current context: {current_context}"]
    lines.extend([f"  {spec.name:<8} {spec.summary}" for spec in CONTEXT_SHELL_BUILTINS])
    if state.namespace == "studio" and state.instance_name is not None:
        quit_spec = get_studio_command_spec("quit")
        lines.append(f"  {quit_spec.name:<8} {quit_spec.summary}")
    lines.append("")
    if state.namespace == "studio":
        lines.append(get_studio_help_text())
    return "\n".join(lines)


def format_shell_context(state: ShellState, workspace_root: str) -> str:
    if state.namespace is None:
        return "\n".join(
            [
                "Available here:",
                "Contexts:",
                "- studio/",
                "Actions:",
                "- ls",
                "- cd",
                "- clear",
                "- help",
                "- exit",
                "",
            ]
        )

    if state.namespace == "studio" and state.instance_name is not None:
        studio_actions = bound_instance_action_names()
        contextual_action_names = ["ls", "cd", "clear", "help", "back"]
        return "\n".join(
            [
                f"Available in studio/{state.instance_name}:",
                "Contexts:",
                "- none",
                "Actions:",
                f"- {get_studio_command_spec('projects').shell_label or 'projects'}",
                *[f"- {name}" for name in contextual_action_names],
                *[
                    f"- {get_studio_command_spec(name).shell_label or name}"
                    for name in studio_actions
                ],
                "- exit",
                "",
            ]
        )

    instances = list_live_instances(workspace_root)
    root_actions = studio_root_action_names()
    return "\n".join(
        [
            "Available in studio:",
            "Contexts:",
            *format_instance_contexts(instances),
            "Actions:",
            *[
                f"- {get_studio_command_spec(name).shell_label or name}"
                for name in root_actions
            ],
            *[f"- {spec.name}" for spec in CONTEXT_SHELL_BUILTINS],
            "",
        ]
    )


def top_level_help_text() -> str:
    return "\n".join(
        [
            "Usage:",
            "  robotick",
            "  robotick studio <command>",
            "",
            "Interactive mode:",
            "  Running 'robotick' on its own opens a simple command shell.",
            "  Type 'ls' to list commands in the current context.",
            "  Type 'studio' to enter the Studio command context.",
            "",
            "Namespaces:",
            *[f"  {spec.name:<8} {spec.summary}" for spec in TOP_LEVEL_NAMESPACES],
            "",
            "Run 'robotick studio --help' for Studio commands.",
            "",
        ]
    )


def projects_help_text() -> str:
    spec = get_studio_command_spec("projects")
    return "\n".join(
        [
            "Usage:",
            f"  {spec.usage}",
            "",
            "Options:",
            "  --json   Print the registered project list as JSON",
            "",
        ]
    )


def instances_help_text() -> str:
    spec = get_studio_command_spec("instances")
    return "\n".join(
        [
            "Usage:",
            f"  {spec.usage}",
            "",
            "Options:",
            "  --json   Print the live Studio instance list as JSON",
            "",
        ]
    )


def create_help_text() -> str:
    spec = get_studio_command_spec("create")
    return "\n".join(
        [
            "Usage:",
            f"  {spec.usage}",
            "",
            "Description:",
            *[f"  {line}" for line in spec.description_lines],
            "",
        ]
    )


def open_help_text() -> str:
    spec = get_studio_command_spec("open")
    return "\n".join(
        [
            "Usage:",
            f"  {spec.usage}",
            "",
            "Description:",
            *[f"  {line}" for line in spec.description_lines],
            "",
        ]
    )


def instance_help_text(instance_name: str) -> str:
    spec = get_studio_command_spec("quit")
    return "\n".join(
        [
            "Usage:",
            f"  robotick studio {instance_name} quit",
            "",
            "Commands:",
            f"  {spec.name:<6} {spec.summary}",
            "",
        ]
    )


def instance_quit_help_text(instance_name: str) -> str:
    spec = get_studio_command_spec("quit")
    return "\n".join(
        [
            "Usage:",
            f"  robotick studio {instance_name} quit",
            "",
            "Description:",
            *[f"  {line}" for line in spec.description_lines],
            "",
        ]
    )
