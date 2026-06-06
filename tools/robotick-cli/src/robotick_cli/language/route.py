from __future__ import annotations

from robotick_cli.app.context import AppContext
from robotick_cli.app.errors import CliError
from robotick_cli.hub import run_hub_command
from robotick_cli.language.help import get_studio_help_text
from robotick_cli.studio import CommandResult, run_studio_command


def is_help_flag(value: str) -> bool:
    return value in {"--help", "-h", "help"}


def run_command(ctx: AppContext, args: list[str]) -> CommandResult:
    namespace, *rest = args
    if namespace == "hub":
        return run_hub_command(ctx, rest)
    if namespace != "studio":
        raise CliError(f"Unknown namespace: {namespace}")
    return run_studio_command(ctx, rest)


def top_level_help() -> str:
    from robotick_cli.language.help import top_level_help_text

    return top_level_help_text()


def studio_help() -> str:
    return get_studio_help_text()
