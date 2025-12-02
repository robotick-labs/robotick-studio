from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from robotick.launcher.listen.routes_launch import router as build_router
from robotick.launcher.listen.routes_query import router as query_router

DEFAULT_HOST = "localhost"
DEFAULT_PORT = 7081
DEFAULT_LOG_LEVEL = "info"

def create_app() -> FastAPI:
    app = FastAPI(title="Robotick Launcher | Listen", version="0.1.0")

    # 🔓 Allow everything (dev only)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
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
