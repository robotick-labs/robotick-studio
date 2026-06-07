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
    from robotick_hub.tray import start_tray

    os.environ["ROBOTICK_HUB_EXPECT_TRAY"] = "1"
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
    if not server.started:
        raise RuntimeError("robotick-hub server did not become ready before tray startup.")

    def stop_hub() -> None:
        server.should_exit = True
        server.force_exit = True

    try:
        os.environ["ROBOTICK_HUB_TRAY_ACTIVE"] = "1"
        exit_code = start_tray(stop_hub)
    except Exception:
        os.environ["ROBOTICK_HUB_TRAY_ACTIVE"] = "0"
        stop_hub()
        server_thread.join(timeout=5)
        raise
    stop_hub()
    server_thread.join(timeout=5)
    raise SystemExit(exit_code)


def main() -> None:
    from robotick_hub.tray import should_use_tray

    os.environ.setdefault("ROBOTICK_HUB_EXPECT_TRAY", "0")
    os.environ.setdefault("ROBOTICK_HUB_TRAY_ACTIVE", "0")
    if should_use_tray():
        run_with_tray()
        return
    run_headless()


if __name__ == "__main__":
    main()
