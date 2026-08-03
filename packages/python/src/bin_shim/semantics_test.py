"""Unit tests for bin_shim.semantics.

The re-raise path is exercised here with ``signal.signal`` and ``os.kill``
mocked out (recording call order instead of dying); genuine signal death is
proven by the subprocess-based conformance suite in tests/.
"""

import os
import signal
import sys
from types import SimpleNamespace

import pytest

import bin_shim.semantics as semantics_module
from bin_shim.semantics import (
    SIGINT_EXIT_CODE,
    SIGTERM_EXIT_CODE,
    apply_exit_semantics,
)


class _FakeStream:
    def __init__(self, events, label):
        self._events = events
        self._label = label

    def flush(self):
        self._events.append(self._label)


@pytest.fixture()
def recorded(monkeypatch):
    """Mock the process-killing collaborators, recording call order.

    The streams are patched via the module's ``sys`` binding (not the global
    ``sys.stdout``) because pytest's capture plugin re-binds the global
    streams when it resumes capturing after fixture setup.
    """
    events = []
    monkeypatch.setattr(
        signal, "signal", lambda signum, handler: events.append(("signal", signum, handler))
    )
    monkeypatch.setattr(os, "kill", lambda pid, signum: events.append(("kill", pid, signum)))
    fake_sys = SimpleNamespace(
        platform=sys.platform,
        stdout=_FakeStream(events, "flush_stdout"),
        stderr=_FakeStream(events, "flush_stderr"),
    )
    monkeypatch.setattr(semantics_module, "sys", fake_sys)
    return events


def describe_apply_exit_semantics():
    def describe_on_posix():
        @pytest.mark.parametrize("code", [0, 1, 101, 255])
        def test_passes_ordinary_codes_through(code):
            assert apply_exit_semantics(code, platform="linux") == code

        def test_reraises_sigint_for_130(recorded):
            with pytest.raises(SystemExit) as excinfo:
                apply_exit_semantics(SIGINT_EXIT_CODE, platform="linux")
            # The SystemExit fallback only fires because os.kill is mocked;
            # for real it dies inside kill. 128 + SIGINT = 130.
            assert excinfo.value.code == 130
            assert recorded == [
                ("signal", signal.SIGINT, signal.SIG_DFL),
                "flush_stdout",
                "flush_stderr",
                ("kill", os.getpid(), signal.SIGINT),
            ]

        def test_reraises_sigterm_for_143(recorded):
            with pytest.raises(SystemExit) as excinfo:
                apply_exit_semantics(SIGTERM_EXIT_CODE, platform="linux")
            assert excinfo.value.code == 143
            assert recorded == [
                ("signal", signal.SIGTERM, signal.SIG_DFL),
                "flush_stdout",
                "flush_stderr",
                ("kill", os.getpid(), signal.SIGTERM),
            ]

    def describe_on_windows():
        @pytest.mark.parametrize("code", [0, 1, SIGINT_EXIT_CODE, SIGTERM_EXIT_CODE, 255])
        def test_passes_every_code_through_without_reraise(code, recorded):
            assert apply_exit_semantics(code, platform="win32") == code
            assert recorded == []

    def test_defaults_platform_to_the_running_interpreter():
        # 7 is not a shutdown code, so the result is identical on every
        # platform; this pins the sys.platform default branch.
        assert apply_exit_semantics(7) == 7
