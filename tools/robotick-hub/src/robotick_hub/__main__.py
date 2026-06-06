from __future__ import annotations

import os
import threading
import time

import uvicorn

from robotick_hub.app import app


def build_server() -> uvicorn.Server:
    config = uvicorn.Config(
        app,
        host=os.environ.get("ROBOTICK_HUB_HOST", "127.0.0.1"),
        port=int(os.environ.get("ROBOTICK_HUB_PORT", "7090")),
        log_level=os.environ.get("ROBOTICK_HUB_LOG_LEVEL", "warning"),
    )
    return uvicorn.Server(config)


def run_headless() -> None:
    build_server().run()


def run_with_tray() -> None:
    from robotick_hub.tray import should_use_tray, start_tray

    server = build_server()
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    started_at = time.time()
    while time.time() - started_at < 8:
        if server.started:
            break
        if not server_thread.is_alive():
            raise RuntimeError("robotick-hub server exited before tray startup completed.")
        time.sleep(0.05)

    def stop_hub() -> None:
        server.should_exit = True
        server.force_exit = True

    try:
        exit_code = start_tray(stop_hub)
    except Exception:
        server_thread.join()
        return
    stop_hub()
    server_thread.join(timeout=5)
    raise SystemExit(exit_code)


def main() -> None:
    from robotick_hub.tray import should_use_tray

    if should_use_tray():
        run_with_tray()
        return
    run_headless()


if __name__ == "__main__":
    main()
