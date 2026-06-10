from __future__ import annotations

from robotick_cli.app.context import ShellState
from robotick_cli.instances import format_instance_contexts, list_live_instances
from robotick_cli.studio_tree import fetch_studio_node_status, list_child_contexts
from robotick_cli.language.registry import (
    CONTEXT_SHELL_BUILTINS,
    TOP_LEVEL_NAMESPACES,
    TOP_LEVEL_SHELL_BUILTINS,
    bound_instance_action_names,
    get_hub_command_spec,
    get_launcher_command_spec,
    get_studio_command_spec,
    hub_action_names,
    launcher_action_names,
    studio_root_action_names,
)


RESET = "\x1b[0m"
BOLD = "\x1b[1m"
DIM = "\x1b[2m"
CYAN = "\x1b[36m"
GREEN = "\x1b[32m"
YELLOW = "\x1b[33m"


def _paint(text: str, *codes: str, enabled: bool = False) -> str:
    if not enabled or not codes:
        return text
    return f"{''.join(codes)}{text}{RESET}"


def _section(title: str, *, color: bool = False) -> str:
    return _paint(title, BOLD, enabled=color)


def _heading(title: str, *, color: bool = False) -> str:
    return _paint(title, enabled=color)


def get_prompt(state: ShellState, *, color: bool = False) -> str:
    if state.namespace is None:
        return f"{_paint('robotick', BOLD, CYAN, enabled=color)}{_paint('> ', DIM, enabled=color)}"
    if state.namespace == "studio" and state.instance_name is not None:
        suffix = "".join(f":{segment}" for segment in state.studio_path)
        return (
            f"{_paint('robotick', BOLD, CYAN, enabled=color)}"
            f"{_paint(':studio', BOLD, GREEN, enabled=color)}"
            f"{_paint(f':{state.instance_name}{suffix}', BOLD, enabled=color)}"
            f"{_paint('> ', DIM, enabled=color)}"
        )
    return (
        f"{_paint('robotick', BOLD, CYAN, enabled=color)}"
        f"{_paint(f':{state.namespace}', BOLD, GREEN, enabled=color)}"
        f"{_paint('> ', DIM, enabled=color)}"
    )


def get_studio_help_text() -> str:
    root_specs = [get_studio_command_spec(name) for name in studio_root_action_names()]
    status_spec = get_studio_command_spec("status")
    quit_spec = get_studio_command_spec("quit")
    return "\n".join(
        [
            "Current context: studio",
            "",
            "Commands:",
            *[f"  {spec.shell_label or spec.name:<16}{spec.summary}" for spec in root_specs],
            "",
            "Output:",
            "  Query commands return JSON and do not launch or bind Studio instances.",
            "  open and create return JSON in one-shot CLI usage.",
            "",
            "Bound instance commands:",
            f"  {status_spec.shell_label or status_spec.name:<16}{status_spec.summary}",
            f"  {quit_spec.shell_label or quit_spec.name:<16}{quit_spec.summary}",
            "",
            "Examples:",
            "  robotick studio projects",
            "  robotick studio instances",
            "  robotick studio open barr-e",
            "",
        ]
    )


def get_hub_help_text() -> str:
    status_spec = get_hub_command_spec("status")
    ensure_spec = get_hub_command_spec("ensure")
    projects_spec = get_hub_command_spec("projects")
    return "\n".join(
        [
            "Current context: hub",
            "",
            "Commands:",
            f"  {status_spec.shell_label or status_spec.name:<10}{status_spec.summary}",
            f"  {ensure_spec.shell_label or ensure_spec.name:<10}{ensure_spec.summary}",
            f"  {projects_spec.shell_label or projects_spec.name:<10}{projects_spec.summary}",
            "",
            "Output:",
            "  status returns JSON and never starts the hub.",
            "  ensure returns JSON describing whether the hub was started, reused, or restarted.",
            "",
            "Examples:",
            "  robotick hub status",
            "  robotick hub ensure",
            "  robotick hub projects",
            "",
        ]
    )


def get_launcher_help_text() -> str:
    status_spec = get_launcher_command_spec("status")
    ensure_spec = get_launcher_command_spec("ensure")
    return "\n".join(
        [
            "Current context: launcher",
            "",
            "Commands:",
            f"  {status_spec.shell_label or status_spec.name:<10}{status_spec.summary}",
            f"  {ensure_spec.shell_label or ensure_spec.name:<10}{ensure_spec.summary}",
            "",
            "Output:",
            "  status returns JSON and never starts the launcher service.",
            "  ensure returns JSON describing whether the service was started, reused, or restarted.",
            "",
            "Examples:",
            "  robotick launcher status",
            "  robotick launcher ensure",
            "",
        ]
    )


def format_shell_help(state: ShellState, *, color: bool = False) -> str:
    if state.namespace is None:
        return "\n".join(
            [
                _heading("Current context: top level", color=color),
                "",
                _section("Namespaces:", color=color),
                *_format_spec_lines(
                    [(spec.name, spec.summary) for spec in TOP_LEVEL_NAMESPACES],
                    color=color,
                    label_color=CYAN,
                ),
                "",
                _section("Shell commands:", color=color),
                *_format_spec_lines(
                    [(spec.name, spec.summary) for spec in TOP_LEVEL_SHELL_BUILTINS],
                    color=color,
                    label_color=GREEN,
                ),
                "",
                _section("Notes:", color=color),
                "  Query commands return JSON and do not start dependencies.",
                "  Action commands may ensure dependencies internally.",
                "",
                _section("Examples:", color=color),
                "  robotick hub status",
                "  robotick hub ensure",
                "  robotick launcher status",
                "  robotick studio open barr-e",
                "",
            ]
        )

    current_context = (
        f"studio/{state.instance_name}{''.join(f'/{segment}' for segment in state.studio_path)}"
        if state.namespace == "studio" and state.instance_name is not None
        else state.namespace
    )

    lines = [_heading(f"Current context: {current_context}", color=color), ""]
    if state.namespace == "studio" and state.instance_name is not None:
        status_spec = get_studio_command_spec("status")
        activate_spec = get_studio_command_spec("activate")
        quit_spec = get_studio_command_spec("quit")
        lines.extend(
            [
                _section("Commands:", color=color),
                *_format_spec_lines(
                    [
                        (status_spec.name, status_spec.summary),
                        (activate_spec.name, activate_spec.summary),
                        (quit_spec.name, quit_spec.summary),
                    ],
                    color=color,
                    label_color=GREEN,
                ),
                "",
                _section("Navigation:", color=color),
                "  Use ls to discover child contexts.",
                "  Use cd <context> to enter child contexts.",
                "  Use back to move up one level.",
                "",
                _section("Output:", color=color),
                "  status returns JSON for the currently bound Studio node.",
                "  Some fields may be config-derived until live Studio state is available.",
                "",
                _section("Examples:", color=color),
                "  status",
                "  cd windows",
                "  cd main",
                "  cd workbenches",
                "",
            ]
        )
        return "\n".join(lines)

    if state.namespace == "launcher":
        status_spec = get_launcher_command_spec("status")
        ensure_spec = get_launcher_command_spec("ensure")
        lines.extend(
            [
                _section("Commands:", color=color),
                *_format_spec_lines(
                    [
                        (status_spec.name, status_spec.summary),
                        (ensure_spec.name, ensure_spec.summary),
                    ],
                    color=color,
                    label_color=GREEN,
                ),
                "",
                _section("Shell commands:", color=color),
                *_format_spec_lines(
                    [(spec.name, spec.summary) for spec in CONTEXT_SHELL_BUILTINS],
                    color=color,
                    label_color=GREEN,
                ),
                "",
                _section("Output:", color=color),
                "  status returns launcher service state and runtime state as JSON.",
                "  ensure returns the action taken: started, reused, or restarted.",
                "",
                _section("Examples:", color=color),
                "  robotick launcher status",
                "  robotick launcher ensure",
                "",
            ]
        )
        return "\n".join(lines)

    if state.namespace == "hub":
        status_spec = get_hub_command_spec("status")
        ensure_spec = get_hub_command_spec("ensure")
        projects_spec = get_hub_command_spec("projects")
        lines.extend(
            [
                _section("Commands:", color=color),
                *_format_spec_lines(
                    [
                        (status_spec.name, status_spec.summary),
                        (ensure_spec.name, ensure_spec.summary),
                        (projects_spec.name, projects_spec.summary),
                    ],
                    color=color,
                    label_color=GREEN,
                ),
                "",
                _section("Shell commands:", color=color),
                *_format_spec_lines(
                    [(spec.name, spec.summary) for spec in CONTEXT_SHELL_BUILTINS],
                    color=color,
                    label_color=GREEN,
                ),
                "",
                _section("Output:", color=color),
                "  status returns hub process state and capabilities as JSON.",
                "  ensure returns the action taken: started, reused, or restarted.",
                "",
                _section("Examples:", color=color),
                "  robotick hub status",
                "  robotick hub ensure",
                "  robotick hub projects --json",
                "",
            ]
        )
        return "\n".join(lines)

    lines.extend(
        [
            _section("Commands:", color=color),
            *_format_spec_lines(
                [
                    (
                        get_studio_command_spec(name).shell_label or name,
                        get_studio_command_spec(name).summary,
                    )
                    for name in studio_root_action_names()
                ],
                color=color,
                label_color=GREEN,
            ),
            "",
            _section("Shell commands:", color=color),
            *_format_spec_lines(
                [(spec.name, spec.summary) for spec in CONTEXT_SHELL_BUILTINS],
                color=color,
                label_color=GREEN,
            ),
            "",
            _section("Output:", color=color),
            "  open prints a JSON launch result in one-shot CLI usage.",
            "  instances returns JSON and does not launch Studio.",
            "",
            _section("Examples:", color=color),
            "  open barr-e",
            "  instances",
            "  cd studio-12345",
            "",
        ]
    )
    return "\n".join(lines)


def _format_bullet_rows(
    items: list[tuple[str, str]],
    *,
    color: bool = False,
    label_color: str = GREEN,
) -> list[str]:
    if not items:
        return ["- none"]
    width = max(len(label) for label, _ in items)
    return [
        f"{_paint('-', DIM, enabled=color)} {_paint(f'{label:<{width}}', BOLD, label_color, enabled=color)}  {summary}"
        for label, summary in items
    ]


def _format_spec_lines(
    items: list[tuple[str, str]],
    *,
    color: bool = False,
    label_color: str = GREEN,
) -> list[str]:
    if not items:
        return ["  none"]
    width = max(len(label) for label, _ in items)
    return [
        f"  {_paint(f'{label:<{width}}', BOLD, label_color, enabled=color)}  {summary}"
        for label, summary in items
    ]


def _format_context_lines(items: list[str], *, color: bool = False) -> list[str]:
    if not items:
        return [f"{_paint('-', DIM, enabled=color)} none"]
    lines: list[str] = []
    for item in items:
        if item == "- none":
            lines.append(f"{_paint('-', DIM, enabled=color)} none")
            continue
        label = item[2:] if item.startswith("- ") else item
        lines.append(f"{_paint('-', DIM, enabled=color)} {_paint(label, BOLD, CYAN, enabled=color)}")
    return lines


def format_shell_context(state: ShellState, workspace_root: str, *, color: bool = False) -> str:
    if state.namespace is None:
        return "\n".join(
            [
                _heading("Available here:", color=color),
                _section("Contexts:", color=color),
                *_format_bullet_rows(
                    [(f"{spec.name}/", spec.summary) for spec in TOP_LEVEL_NAMESPACES],
                    color=color,
                    label_color=CYAN,
                ),
                _section("Actions:", color=color),
                *_format_bullet_rows(
                    [(spec.name, spec.summary) for spec in TOP_LEVEL_SHELL_BUILTINS],
                    color=color,
                    label_color=GREEN,
                ),
                "",
            ]
        )

    if state.namespace == "studio" and state.instance_name is not None:
        try:
            node = fetch_studio_node_status(workspace_root, state.instance_name, state.studio_path)
            child_contexts = (
                [f"- {name}" for name in list_child_contexts(node)]
                or ["- none"]
            )
        except Exception:
            node = None
            child_contexts = ["- none"]
        contextual_actions = [
            (
                get_studio_command_spec("status").shell_label or "status",
                get_studio_command_spec("status").summary,
            ),
        ]
        if isinstance(node, dict) and isinstance(node.get("activation_target_path"), list):
            contextual_actions.append(
                (
                    get_studio_command_spec("activate").shell_label or "activate",
                    get_studio_command_spec("activate").summary,
                )
            )
        contextual_actions.append(
            (
                get_studio_command_spec("select-project").shell_label or "select-project",
                get_studio_command_spec("select-project").summary,
            )
        )
        contextual_action_names = ["ls", "cd", "clear", "help", "back"]
        return "\n".join(
            [
                _heading(
                    f"Available in studio/{state.instance_name}{''.join(f'/{segment}' for segment in state.studio_path)}:",
                    color=color,
                ),
                _section("Contexts:", color=color),
                *_format_context_lines(child_contexts, color=color),
                _section("Actions:", color=color),
                *_format_bullet_rows(
                    [
                        *contextual_actions,
                        *[
                            (
                                name,
                                next(spec.summary for spec in CONTEXT_SHELL_BUILTINS if spec.name == name),
                            )
                            for name in contextual_action_names
                        ],
                        (
                            get_studio_command_spec("quit").shell_label or "quit",
                            get_studio_command_spec("quit").summary,
                        ),
                        (
                            "exit",
                            next(spec.summary for spec in CONTEXT_SHELL_BUILTINS if spec.name == "exit"),
                        ),
                    ],
                    color=color,
                    label_color=GREEN,
                ),
                "",
            ]
        )

    if state.namespace == "hub":
        return "\n".join(
            [
                _heading("Available in hub:", color=color),
                _section("Contexts:", color=color),
                *_format_context_lines(["- none"], color=color),
                _section("Actions:", color=color),
                *_format_bullet_rows(
                    [
                        (
                            get_hub_command_spec(name).shell_label or name,
                            get_hub_command_spec(name).summary,
                        )
                        for name in hub_action_names()
                    ]
                    + [(spec.name, spec.summary) for spec in CONTEXT_SHELL_BUILTINS],
                    color=color,
                    label_color=GREEN,
                ),
                "",
            ]
        )

    if state.namespace == "launcher":
        return "\n".join(
            [
                _heading("Available in launcher:", color=color),
                _section("Contexts:", color=color),
                *_format_context_lines(["- none"], color=color),
                _section("Actions:", color=color),
                *_format_bullet_rows(
                    [
                        (
                            get_launcher_command_spec(name).shell_label or name,
                            get_launcher_command_spec(name).summary,
                        )
                        for name in launcher_action_names()
                    ]
                    + [(spec.name, spec.summary) for spec in CONTEXT_SHELL_BUILTINS],
                    color=color,
                    label_color=GREEN,
                ),
                "",
            ]
        )

    instances = list_live_instances(workspace_root)
    root_actions = studio_root_action_names()
    return "\n".join(
        [
            _heading("Available in studio:", color=color),
            _section("Contexts:", color=color),
            *_format_context_lines(format_instance_contexts(instances), color=color),
            _section("Actions:", color=color),
            *_format_bullet_rows(
                [
                    (
                        get_studio_command_spec(name).shell_label or name,
                        get_studio_command_spec(name).summary,
                    )
                    for name in root_actions
                ]
                + [(spec.name, spec.summary) for spec in CONTEXT_SHELL_BUILTINS],
                color=color,
                label_color=GREEN,
            ),
            "",
        ]
    )


def top_level_help_text() -> str:
    return "\n".join(
        [
            "Current context: top level",
            "",
            "Entry points:",
            "  robotick",
            "  robotick hub <command>",
            "  robotick launcher <command>",
            "  robotick studio <command>",
            "",
            "Namespaces:",
            *_format_spec_lines([(f"{spec.name}/", spec.summary) for spec in TOP_LEVEL_NAMESPACES]),
            "",
            "Shell commands:",
            *_format_spec_lines([(spec.name, spec.summary) for spec in TOP_LEVEL_SHELL_BUILTINS]),
            "",
            "Notes:",
            "  Query commands return JSON and do not start dependencies.",
            "  Ensure and open commands may start dependencies as part of their action.",
            "",
            "Examples:",
            "  robotick hub status",
            "  robotick hub ensure",
            "  robotick launcher status",
            "  robotick studio open barr-e",
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
            "Output:",
            "  JSON Studio instance list. This command does not launch Studio.",
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
            "Output:",
            "  JSON Studio launch result in one-shot CLI usage.",
            "",
        ]
    )


def instance_help_text(instance_name: str) -> str:
    status_spec = get_studio_command_spec("status")
    select_project_spec = get_studio_command_spec("select-project")
    activate_spec = get_studio_command_spec("activate")
    quit_spec = get_studio_command_spec("quit")
    return "\n".join(
        [
            "Usage:",
            f"  robotick studio {instance_name} status",
            f"  robotick studio {instance_name} <path...> activate",
            f"  robotick studio {instance_name} select-project <project>",
            f"  robotick studio {instance_name} quit",
            f"  robotick studio {instance_name} windows",
            "",
            "Commands:",
            f"  {status_spec.name:<14} {status_spec.summary}",
            f"  {activate_spec.name:<14} {activate_spec.summary}",
            f"  {select_project_spec.name:<14} {select_project_spec.summary}",
            f"  {quit_spec.name:<14} {quit_spec.summary}",
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


def instance_select_project_help_text(instance_name: str) -> str:
    spec = get_studio_command_spec("select-project")
    return "\n".join(
        [
            "Usage:",
            f"  robotick studio {instance_name} select-project <project>",
            "",
            "Description:",
            *[f"  {line}" for line in spec.description_lines],
            "",
            "Output:",
            "  JSON project-selection result from the Studio instance.",
            "",
        ]
    )


def launcher_status_help_text() -> str:
    spec = get_launcher_command_spec("status")
    return "\n".join(
        [
            "Usage:",
            f"  {spec.usage}",
            "",
            "Output:",
            "  JSON launcher service status. This command does not start the launcher.",
            "",
        ]
    )


def hub_status_help_text() -> str:
    spec = get_hub_command_spec("status")
    return "\n".join(
        [
            "Usage:",
            f"  {spec.usage}",
            "",
            "Output:",
            "  JSON hub status. This command does not start the hub.",
            "",
        ]
    )


def hub_projects_help_text() -> str:
    spec = get_hub_command_spec("projects")
    return "\n".join(
        [
            "Usage:",
            f"  {spec.usage}",
            "",
            "Options:",
            "  --json   Print the hub-backed project list as JSON",
            "",
        ]
    )
