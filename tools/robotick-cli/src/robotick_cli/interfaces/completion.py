from __future__ import annotations

from collections.abc import Callable

from robotick_cli.app.context import AppContext, ShellState
from robotick_cli.instances import list_live_instances, normalize_instance_specifier
from robotick_cli.language.registry import (
    CONTEXT_SHELL_BUILTINS,
    TOP_LEVEL_NAMESPACES,
    TOP_LEVEL_SHELL_BUILTINS,
    bound_instance_action_names,
    hub_action_names,
    launcher_action_names,
    studio_root_action_names,
)


def _namespace_names() -> list[str]:
    return [spec.name for spec in TOP_LEVEL_NAMESPACES]


def _top_level_builtin_names() -> list[str]:
    return [spec.name for spec in TOP_LEVEL_SHELL_BUILTINS]


def _context_builtin_names() -> list[str]:
    return [spec.name for spec in CONTEXT_SHELL_BUILTINS]


def _studio_instance_names(workspace_root: str) -> list[str]:
    return [instance.name for instance in list_live_instances(workspace_root)]


def _studio_instance_context_names(workspace_root: str) -> list[str]:
    return [f"{name}/" for name in _studio_instance_names(workspace_root)]


def _current_context_first_tokens(ctx: AppContext, state: ShellState) -> list[str]:
    names = _namespace_names()
    if state.namespace is None:
        names.extend(_top_level_builtin_names())
        return sorted(set(names))
    if state.namespace == "studio" and state.instance_name is None:
        names.extend(_context_builtin_names())
        names.extend(studio_root_action_names())
        names.extend(_studio_instance_names(str(ctx.workspace_root)))
        return sorted(set(names))
    if state.namespace == "studio" and state.instance_name is not None:
        names.extend(_context_builtin_names())
        names.extend(["projects", *bound_instance_action_names()])
        return sorted(set(names))
    if state.namespace == "hub":
        names.extend(_context_builtin_names())
        names.extend(hub_action_names())
        return sorted(set(names))
    if state.namespace == "launcher":
        names.extend(_context_builtin_names())
        names.extend(launcher_action_names())
        return sorted(set(names))
    return sorted(set(names))


def _cd_targets(ctx: AppContext, state: ShellState) -> list[str]:
    if state.namespace is None:
        return sorted(_namespace_names())
    if state.namespace == "studio" and state.instance_name is None:
        return sorted(["..", *_studio_instance_context_names(str(ctx.workspace_root))])
    return [".."]


def _studio_subcommand_tokens(ctx: AppContext, prior_tokens: list[str]) -> list[str]:
    if len(prior_tokens) <= 1:
        return sorted(set([*studio_root_action_names(), *_studio_instance_names(str(ctx.workspace_root))]))
    instance_name = normalize_instance_specifier(prior_tokens[1])
    if instance_name in _studio_instance_names(str(ctx.workspace_root)):
        if len(prior_tokens) == 2:
            return sorted(bound_instance_action_names())
    return []


def _hub_subcommand_tokens(_ctx: AppContext, prior_tokens: list[str]) -> list[str]:
    if len(prior_tokens) <= 1:
        return sorted(hub_action_names())
    return []


def _launcher_subcommand_tokens(_ctx: AppContext, prior_tokens: list[str]) -> list[str]:
    if len(prior_tokens) <= 1:
        return sorted(launcher_action_names())
    return []


def get_completion_matches(
    ctx: AppContext,
    state: ShellState,
    line_buffer: str,
    begidx: int,
    endidx: int,
) -> list[str]:
    prefix = line_buffer[begidx:endidx]
    prior_tokens = line_buffer[:begidx].split()

    if not prior_tokens:
        candidates = _current_context_first_tokens(ctx, state)
        return [candidate for candidate in candidates if candidate.startswith(prefix)]

    if prior_tokens[0] == "cd":
        if len(prior_tokens) == 1:
            candidates = _cd_targets(ctx, state)
            return [candidate for candidate in candidates if candidate.startswith(prefix)]
        return []

    if prior_tokens[0] == "studio":
        candidates = _studio_subcommand_tokens(ctx, prior_tokens)
        return [candidate for candidate in candidates if candidate.startswith(prefix)]

    if prior_tokens[0] == "hub":
        candidates = _hub_subcommand_tokens(ctx, prior_tokens)
        return [candidate for candidate in candidates if candidate.startswith(prefix)]

    if prior_tokens[0] == "launcher":
        candidates = _launcher_subcommand_tokens(ctx, prior_tokens)
        return [candidate for candidate in candidates if candidate.startswith(prefix)]

    if state.namespace == "studio" and state.instance_name is None:
        instance_name = normalize_instance_specifier(prior_tokens[0])
        if instance_name in _studio_instance_names(str(ctx.workspace_root)):
            if len(prior_tokens) == 1:
                return [
                    candidate
                    for candidate in sorted(bound_instance_action_names())
                    if candidate.startswith(prefix)
                ]

    return []


def install_readline_completion(
    ctx: AppContext,
    state: ShellState,
) -> Callable[[], None]:
    try:
        import readline
    except ImportError:
        return lambda: None

    def completer(text: str, match_index: int) -> str | None:
        line_buffer = readline.get_line_buffer()
        matches = get_completion_matches(
            ctx,
            state,
            line_buffer,
            readline.get_begidx(),
            readline.get_endidx(),
        )
        if match_index >= len(matches):
            return None
        return matches[match_index]

    previous_completer = readline.get_completer()
    readline.set_completer_delims(" \t\n")
    readline.parse_and_bind("tab: menu-complete")
    readline.set_completer(completer)

    def cleanup() -> None:
        readline.set_completer(previous_completer)

    return cleanup
