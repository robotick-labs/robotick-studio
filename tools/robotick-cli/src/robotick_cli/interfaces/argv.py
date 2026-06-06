from __future__ import annotations

import os
from pathlib import Path
import sys

from robotick_cli.app.context import AppContext
from robotick_cli.app.errors import CliError
from robotick_cli.interfaces.repl import start_interactive_shell
from robotick_cli.language.help import top_level_help_text
from robotick_cli.language.route import is_help_flag, run_command
from robotick_cli.output import writeln


def get_workspace_root() -> Path:
    return Path(os.environ.get("ROBOTICK_WORKSPACE_ROOT", os.getcwd()))


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    ctx = AppContext(workspace_root=get_workspace_root())
    try:
        if not args:
            return start_interactive_shell(ctx)
        if is_help_flag(args[0]):
            writeln(top_level_help_text())
            return 0
        result = run_command(ctx, args)
        return result.exit_code
    except CliError as error:
        writeln(str(error), stream=sys.stderr)
        return 1
