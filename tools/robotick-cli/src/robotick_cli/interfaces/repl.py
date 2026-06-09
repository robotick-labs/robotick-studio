from __future__ import annotations

from robotick_cli.app.context import AppContext, ShellState
from robotick_cli.app.errors import CliError
from robotick_cli.command_result import CommandResult
from robotick_cli.hub_client import ensure_hub
from robotick_cli.interfaces.completion import install_readline_completion
from robotick_cli.instances import get_live_instance, normalize_instance_specifier, reconcile_bound_instance
from robotick_cli.language.help import format_shell_context, format_shell_help, get_prompt
from robotick_cli.language.parse import tokenize
from robotick_cli.language.registry import TOP_LEVEL_NAMESPACES
from robotick_cli.language.route import run_command
from robotick_cli.output import write, writeln
from robotick_cli.studio import run_studio_command
from robotick_cli.studio_tree import fetch_instance_status, list_child_contexts, resolve_studio_node


def step_back(state: ShellState) -> ShellState:
    if state.namespace == "studio" and state.instance_name is not None and state.studio_path:
        return ShellState(
            namespace=state.namespace,
            instance_name=state.instance_name,
            studio_path=state.studio_path[:-1],
        )
    if state.instance_name is not None:
        return ShellState(namespace=state.namespace, instance_name=None, studio_path=())
    if state.namespace is not None:
        return ShellState(namespace=None, instance_name=None)
    return ShellState(namespace=state.namespace, instance_name=state.instance_name)


def bind_opened_instance_to_state(state: ShellState, result: CommandResult) -> None:
    if state.namespace == "studio" and state.instance_name is None and result.opened_instance_name:
        state.instance_name = result.opened_instance_name
        state.studio_path = ()


def bind_top_level_studio_open_to_state(state: ShellState, tokens: list[str], result: CommandResult) -> None:
    if state.namespace is not None or not result.opened_instance_name:
        return
    if len(tokens) < 2 or tokens[0] != "studio" or tokens[1] != "open":
        return
    state.namespace = "studio"
    state.instance_name = result.opened_instance_name
    state.studio_path = ()


def try_handle_top_level_studio_open(
    ctx: AppContext,
    state: ShellState,
    tokens: list[str],
) -> bool:
    if state.namespace is not None:
        return False
    if len(tokens) < 2 or tokens[0] != "studio" or tokens[1] != "open":
        return False
    result = run_studio_command(ctx, tokens[1:])
    bind_top_level_studio_open_to_state(state, tokens, result)
    return True


def handle_bound_instance_quit(ctx: AppContext, state: ShellState) -> None:
    if state.namespace != "studio" or state.instance_name is None:
        writeln("No open Studio instance is currently bound.")
        return
    try:
        result = run_studio_command(ctx, [state.instance_name, "quit"])
    except CliError as error:
        stale_message = reconcile_bound_instance(ctx.workspace_root, state)
        if stale_message:
            writeln(stale_message)
            return
        writeln(str(error), stream=__import__("sys").stderr)
        return

    if result.exit_code == 0:
        state.instance_name = None


def try_enter_context_directly(
    ctx: AppContext,
    state: ShellState,
    tokens: list[str],
) -> bool:
    if len(tokens) != 1:
        return False
    if state.namespace is None and tokens[0] in {spec.name for spec in TOP_LEVEL_NAMESPACES}:
        state.namespace = tokens[0]  # type: ignore[assignment]
        return True
    if state.namespace == "studio" and state.instance_name is None:
        instance_name = normalize_instance_specifier(tokens[0])
        instance = get_live_instance(ctx.workspace_root, instance_name)
        if instance is None:
            return False
        state.instance_name = instance.name
        state.studio_path = ()
        return True
    if state.namespace == "studio" and state.instance_name is not None:
        if len(tokens) != 1:
            return False
        payload = fetch_instance_status(ctx.workspace_root, state.instance_name)
        node = resolve_studio_node(payload, state.studio_path)
        child_names = {
            name[:-1]
            for name in list_child_contexts(node)
            if name.endswith("/")
        }
        if tokens[0] not in child_names:
            return False
        state.studio_path = (*state.studio_path, tokens[0])
        return True
    return False


def apply_cd(ctx: AppContext, state: ShellState, args: list[str]) -> None:
    if not args:
        raise CliError("Usage: cd <context> or cd ..")
    if len(args) == 1 and args[0] == "..":
        next_state = step_back(state)
        state.namespace = next_state.namespace
        state.instance_name = next_state.instance_name
        return
    if len(args) == 1 and args[0].startswith("../"):
        sibling_target = args[0][3:]
        if not sibling_target:
            raise CliError("Usage: cd ../<context>")
        next_state = step_back(state)
        state.namespace = next_state.namespace
        state.instance_name = next_state.instance_name
        if not try_enter_context_directly(ctx, state, [sibling_target]):
            raise CliError(f"Unknown context: {args[0]}")
        return
    if state.namespace is None:
        if len(args) == 1 and args[0] in {spec.name for spec in TOP_LEVEL_NAMESPACES}:
            state.namespace = args[0]  # type: ignore[assignment]
            return
        raise CliError(f"Unknown top-level context: {' '.join(args)}")
    if state.namespace == "studio" and state.instance_name is None:
        if len(args) != 1:
            raise CliError("Use 'cd <instance>' from the Studio context.")
        instance_name = normalize_instance_specifier(args[0])
        instance = get_live_instance(ctx.workspace_root, instance_name)
        if instance is None:
            raise CliError(f"Unknown Studio instance: {args[0]}")
        state.instance_name = instance.name
        state.studio_path = ()
        return
    if state.namespace == "studio" and state.instance_name is not None:
        if len(args) != 1:
            raise CliError("Use 'cd <context>' from the bound Studio context.")
        payload = fetch_instance_status(ctx.workspace_root, state.instance_name)
        node = resolve_studio_node(payload, state.studio_path)
        child_names = {
            name[:-1]
            for name in list_child_contexts(node)
            if name.endswith("/")
        }
        if args[0] not in child_names:
            raise CliError(f"Unknown Studio context: {args[0]}")
        state.studio_path = (*state.studio_path, args[0])
        return
    raise CliError(f"No child contexts are currently available for {get_prompt(state).strip()}")


def start_interactive_shell(ctx: AppContext) -> int:
    write("Welcome to Robotick™\nType 'help' for commands or 'exit' to leave.\n\n")
    ensure_hub(ctx.workspace_root)
    state = ShellState()
    cleanup_completion = install_readline_completion(ctx, state)

    try:
        while True:
            stale_message = reconcile_bound_instance(ctx.workspace_root, state)
            if stale_message:
                writeln(stale_message)

            try:
                raw_line = input(get_prompt(state))
            except KeyboardInterrupt:
                writeln("\nKeyboardInterrupt")
                writeln("Use 'exit' to leave Robotick.")
                continue
            except EOFError:
                writeln("\nUse 'exit' to leave Robotick.")
                continue

            line = raw_line.strip()
            if not line:
                continue

            try:
                if line == "exit":
                    return 0
                if line == "help":
                    writeln(format_shell_help(state))
                    continue
                if line == "ls":
                    writeln(format_shell_context(state, str(ctx.workspace_root)))
                    continue
                if line == "clear":
                    write("\x1bc")
                    continue
                if line == "back":
                    if state.namespace is None and state.instance_name is None:
                        writeln("Already at top level.")
                    else:
                        next_state = step_back(state)
                        state.namespace = next_state.namespace
                        state.instance_name = next_state.instance_name
                    continue
                if line == "quit":
                    handle_bound_instance_quit(ctx, state)
                    continue
                if (
                    state.namespace == "studio"
                    and state.instance_name is not None
                    and line == "status"
                ):
                    run_studio_command(
                        ctx,
                        [state.instance_name, *state.studio_path, "status"],
                    )
                    continue
                if try_enter_context_directly(ctx, state, [line]):
                    continue

                tokens = tokenize(line)
                if tokens and tokens[0] == "cd":
                    apply_cd(ctx, state, tokens[1:])
                    continue
                if try_enter_context_directly(ctx, state, tokens):
                    continue
                if try_handle_top_level_studio_open(ctx, state, tokens):
                    continue
                if tokens and tokens[0] in {spec.name for spec in TOP_LEVEL_NAMESPACES}:
                    result = run_command(ctx, tokens)
                    bind_top_level_studio_open_to_state(state, tokens, result)
                    continue
                if state.namespace == "studio" and state.instance_name is None and tokens and tokens[0] == "open":
                    result = run_studio_command(ctx, tokens)
                    bind_opened_instance_to_state(state, result)
                    continue
                if state.namespace is not None:
                    run_command(ctx, [state.namespace, *tokens])
                else:
                    run_command(ctx, tokens)
            except CliError as error:
                writeln(str(error), stream=__import__("sys").stderr)
            except Exception as error:
                writeln(
                    "Robotick hit an unexpected error while handling that command. The session is still running.",
                    stream=__import__("sys").stderr,
                )
                writeln(str(error), stream=__import__("sys").stderr)
    finally:
        cleanup_completion()
