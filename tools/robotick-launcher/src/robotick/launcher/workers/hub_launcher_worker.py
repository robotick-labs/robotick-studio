from __future__ import annotations

import argparse
import sys

from robotick.launcher.hub_ability.ability import _json_store, _stop_session_runtime


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m robotick.launcher.workers.hub_launcher_worker")
    subparsers = parser.add_subparsers(dest="command", required=True)

    stop_session = subparsers.add_parser("stop-session")
    stop_session.add_argument("--workspace-root", required=True)
    stop_session.add_argument("--session-id", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "stop-session":
        store = _json_store(args.workspace_root)
        session = store.get_session(args.session_id)
        if session is None:
            parser.error(f"Unknown model session: {args.session_id}")
        _stop_session_runtime(args.workspace_root, session.model_dump(mode="json"))
        return 0

    parser.error(f"Unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
