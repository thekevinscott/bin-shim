"""Integration tier of the process-semantics conformance spec
(spec/conformance.md at the repo root), fake-tier native module.

Each describe block names the spec row it executes. Every test spawns the
consumer-shaped launcher (tests/fixtures/launcher.py) as a real subprocess so
exit codes and signal death are observed exactly as a shell would observe
them: ``returncode == -N`` from the subprocess module is ``WIFSIGNALED`` with
signal N on POSIX.
"""

import json
import os
import signal
import subprocess
import sys
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent.parent / "fixtures"
LAUNCHER = FIXTURES / "launcher.py"

posix_only = pytest.mark.skipif(
    sys.platform == "win32", reason="POSIX signal-death semantics"
)
windows_only = pytest.mark.skipif(
    sys.platform != "win32", reason="Windows plain-exit semantics"
)


def run_launcher(args=(), mode=None, code=None, host_write=None):
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(
        [str(FIXTURES)] + env.get("PYTHONPATH", "").split(os.pathsep)
    ).rstrip(os.pathsep)
    if mode is not None:
        env["FAKE_NATIVE_MODE"] = mode
    if code is not None:
        env["FAKE_NATIVE_CODE"] = str(code)
    if host_write is not None:
        env["HOST_UNFLUSHED_WRITE"] = host_write
    return subprocess.run(
        [sys.executable, str(LAUNCHER), *args],
        env=env,
        capture_output=True,
        timeout=30,
    )


def describe_row_1_exit_code_passthrough():
    @pytest.mark.parametrize("code", [0, 1, 101, 255])
    def test_process_exits_with_exactly_the_returned_code(code):
        result = run_launcher(code=code)
        assert result.returncode == code
        assert result.stderr == b""


def describe_row_2_sigint_shutdown_posix():
    @posix_only
    def test_130_becomes_genuine_signal_death_by_sigint():
        result = run_launcher(code=130)
        # Negative returncode from subprocess == killed by that signal
        # (WIFSIGNALED), not a plain exit(130).
        assert result.returncode == -signal.SIGINT


def describe_row_3_sigterm_shutdown_posix():
    @posix_only
    def test_143_becomes_genuine_signal_death_by_sigterm():
        result = run_launcher(code=143)
        assert result.returncode == -signal.SIGTERM


def describe_row_4_windows_plain_exit():
    @windows_only
    def test_130_exits_plainly_with_130():
        result = run_launcher(code=130)
        assert result.returncode == 130


def describe_row_5_keyboard_interrupt():
    @posix_only
    def test_is_treated_as_the_sigint_shutdown_path():
        result = run_launcher(mode="raise-keyboard-interrupt")
        assert result.returncode == -signal.SIGINT

    @windows_only
    def test_exits_plainly_with_130_on_windows():
        result = run_launcher(mode="raise-keyboard-interrupt")
        assert result.returncode == 130

    def test_no_traceback_reaches_the_user():
        result = run_launcher(mode="raise-keyboard-interrupt")
        assert b"Traceback" not in result.stderr
        assert b"KeyboardInterrupt" not in result.stderr


def describe_row_6_host_stdio_flushed_before_native_call():
    def test_buffered_host_output_lands_ahead_of_native_fd1_writes():
        # The launcher leaves "host:" in Python's buffered stdout; the fake
        # native module then writes "native" straight to fd 1. Without the
        # flush in main(), "host:" would drain at interpreter exit and land
        # after "native".
        result = run_launcher(mode="write-fd1", host_write="host:")
        assert result.stdout == b"host:native"
        assert result.returncode == 0


def describe_row_7_argv_passthrough():
    def test_utf8_spaces_quotes_and_double_dash_arrive_byte_faithfully():
        args = ["héllo wörld", '--flag="quoted value"', "--", "-x", "", "après --"]
        result = run_launcher(args=args, mode="echo-argv")
        assert result.returncode == 0
        assert json.loads(result.stdout.decode("utf-8")) == args
