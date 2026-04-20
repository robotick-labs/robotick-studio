__all__ = ["create_app", "main"]


def __getattr__(name):
    if name in __all__:
        from .cli import create_app, main

        return {"create_app": create_app, "main": main}[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
