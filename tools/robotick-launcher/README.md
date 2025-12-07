# Robotick Launcher

Two entry points:

- `robotick-launcher` — CLI wrapper for build/run/deploy tasks
- `robotick-conductor` — REST API daemon on **http://localhost:7081**

## Quickstart

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .

robotick-conductor
curl http://localhost:7081/health
robotick-launcher --help
```

## License

Apache 2.0
