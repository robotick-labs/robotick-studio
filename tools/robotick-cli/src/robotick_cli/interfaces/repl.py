from __future__ import annotations

from robotick_cli.app.context import AppContext, ShellState
from robotick_cli.app.errors import CliError
from robotick_cli.command_result import CommandResult
from robotick_cli.hub_client import ensure_hub
from robotick_cli.instances import get_live_instance, normalize_instance_specifier, reconcile_bound_instance
from robotick_cli.language.help import format_shell_context, format_shell_help, get_prompt
from robotick_cli.language.parse import tokenize
from robotick_cli.language.route import run_command
from robotick_cli.output import write, writeln
from robotick_cli.studio import run_studio_command


def step_back(state: ShellState) -> ShellState:
    if state.instance_name is not None:
        return ShellState(namespace=state.namespace, instance_name=None)
    if state.namespace is not None:
        return ShellState(namespace=None, instance_name=None)
    return ShellState(namespace=state.namespace, instance_name=state.instance_name)


def bind_opened_instance_to_state(state: ShellState, result: CommandResult) -> None:
    if state.namespace == "studio" and state.instance_name is None and result.opened_instance_name:
        state.instance_name = result.opened_instance_name


def apply_cd(ctx: AppContext, state: ShellState, args: list[str]) -> None:
    if not args:
        raise CliError("Usage: cd <context> or cd ..")
    if len(args) == 1 and args[0] == "..":
        next_state = step_back(state)
        state.namespace = next_state.namespace
        state.instance_name = next_state.instance_name
        return
    if state.namespace is None:
        if len(args) == 1 and args[0] in {"studio", "hub"}:
            state.namespace = "studio"
            if args[0] == "hub":
                state.namespace = "hub"
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
        return
    raise CliError(f"No child contexts are currently available for {get_prompt(state).strip()}")


def start_interactive_shell(ctx: AppContext) -> int:
    write("Welcome to Robotick™\nType 'help' for commands or 'exit' to leave.\n\n")
    ensure_hub(ctx.workspace_root)
    state = ShellState()

    while True:
        stale_message = reconcile_bound_instance(ctx.workspace_root, state)
        if stale_message:
            writeln(stale_message)

        try:
            raw_line = input(get_prompt(state))
        except EOFError:
            return 0

        line = raw_line.strip()
        if not line:
            continue

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
            if state.namespace == "studio" and state.instance_name is not None:
                result = run_studio_command(ctx, [state.instance_name, "quit"])
                if result.exit_code == 0:
                    state.instance_name = None
            else:
                writeln("No open Studio instance is currently bound.")
            continue
        if line == "studio" and state.namespace is None:
            state.namespace = "studio"
            continue
        if line == "hub" and state.namespace is None:
            state.namespace = "hub"
            continue

        try:
            tokens = tokenize(line)
            if tokens and tokens[0] == "cd":
                apply_cd(ctx, state, tokens[1:])
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
