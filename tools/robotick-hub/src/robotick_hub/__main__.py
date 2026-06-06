from __future__ import annotations

import os

import uvicorn

from robotick_hub.app import app


def main() -> None:
    uvicorn.run(
        app,
        host=os.environ.get("ROBOTICK_HUB_HOST", "127.0.0.1"),
        port=int(os.environ.get("ROBOTICK_HUB_PORT", "7090")),
        log_level=os.environ.get("ROBOTICK_HUB_LOG_LEVEL", "warning"),
    )


if __name__ == "__main__":
    main()
