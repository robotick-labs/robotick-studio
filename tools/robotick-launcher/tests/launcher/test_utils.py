import subprocess

from robotick.launcher import utils


def test_run_subprocess_wait_uses_communicate_for_piped_output(monkeypatch):
    calls: list[str] = []

    class FakeProcess:
        returncode = 0

        def communicate(self):
            calls.append("communicate")
            return b"", b""

        def wait(self):
            calls.append("wait")
            return 0

    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProcess())

    utils.run_subprocess(["robotick-test-command"], stdout=subprocess.PIPE)

    assert calls == ["communicate"]


def test_run_subprocess_wait_uses_wait_without_piped_output(monkeypatch):
    calls: list[str] = []

    class FakeProcess:
        returncode = 0

        def communicate(self):
            calls.append("communicate")
            return b"", b""

        def wait(self):
            calls.append("wait")
            return 0

    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProcess())

    utils.run_subprocess(["robotick-test-command"])

    assert calls == ["wait"]
