from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from robotick.launcher.listen.routes_launch import router as build_router
from robotick.launcher.listen.routes_query import router as query_router

DEFAULT_HOST = "localhost"
DEFAULT_PORT = 7081
DEFAULT_LOG_LEVEL = "info"

# Electron dev renders from http://localhost:<vite_port> while the packaged
# renderer uses the `file://` origin, which is surfaced as the literal string
# "null" in the Origin header. Allow those origins explicitly so the
# CORSMiddleware can echo the request origin instead of falling back to "*",
# which Chromium now rejects when credentials are enabled.
DEV_ALLOWED_ORIGINS = ["null"]
DEV_ALLOWED_ORIGIN_REGEX = r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"

def create_app() -> FastAPI:
    app = FastAPI(title="Robotick Launcher | Listen", version="0.1.0")

    # 🔓 Allow everything (dev only)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=DEV_ALLOWED_ORIGINS,
        allow_origin_regex=DEV_ALLOWED_ORIGIN_REGEX,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(build_router)
    app.include_router(query_router)
    return app

def run_server(port):
    app = create_app()

    host = DEFAULT_HOST;
    actual_port = port if port > 0 else DEFAULT_PORT
    log_level = DEFAULT_LOG_LEVEL;

    uvicorn.run(app, host=host, port=actual_port, log_level=log_level)
