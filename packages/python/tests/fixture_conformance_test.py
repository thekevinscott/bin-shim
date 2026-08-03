"""Fixture tier of the process-semantics conformance spec
(spec/conformance.md at the repo root).

Unlike ``conformance_test.py``, the native side here is the real reference
crate — one Rust ``run_cli`` behind pyo3 — so these tests cover what a
pure-Python fake structurally cannot: a signal delivered into native code
*while it is running*, writes issued to file descriptor 1 by the extension
itself, and real OS threads still alive when ``run_cli`` returns.

The suite skips itself when the fixture has not been built, so
``uv run pytest .`` stays useful without a Rust toolchain. CI builds it
first (see .github/workflows/fixture-conformance.yaml).
"""

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_DIR = REPO_ROOT / "fixtures" / "native" / "dist"
FIXTURE_MODULE = FIXTURE_DIR / (
    "bin_shim_fixture.pyd" if sys.platform == "win32" else "bin_shim_fixture.so"
)
LAUNCHER = Path(__file__).parent / "fixtures" / "fixture_launcher.py"

pytestmark = pytest.mark.skipif(
    not FIXTURE_MODULE.exists(),
    reason=f"native fixture not built ({FIXTURE_MODULE}); run fixtures/native/build.sh",
)

posix_only = pytest.mark.skipif(
    sys.platform == "win32", reason="POSIX signal-death semantics"
)


def spawn_launcher(args, host_unflushed_bytes=None):
    """Start the launcher over the real fixture, returning the Popen."""
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(
        [str(FIXTURE_DIR)] + [p for p in [env.get("PYTHONPATH", "")] if p]
    )
    if host_unflushed_bytes is not None:
        env["HOST_UNFLUSHED_BYTES"] = str(host_unflushed_bytes)
    return subprocess.Popen(
        [sys.executable, str(LAUNCHER), *args],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def run_launcher(args, host_unflushed_bytes=None, timeout=30):
    proc = spawn_launcher(args, host_unflushed_bytes=host_unflushed_bytes)
    stdout, stderr = proc.communicate(timeout=timeout)
    return proc.returncode, stdout, stderr


def signal_when_ready(proc, signum, timeout=15.0):
    """Wait for the fixture's readiness line on stderr, then signal it.

    The fixture prints this only once its handlers are installed; signalling
    before that point would race and flake.
    """
    deadline = time.monotonic() + timeout
    seen = b""
    while time.monotonic() < deadline:
        line = proc.stderr.readline()
        if not line:
            break
        seen += line
        if b"fixture: ready" in seen:
            proc.send_signal(signum)
            return seen
    raise AssertionError(f"fixture never reported readiness; stderr so far: {seen!r}")


def describe_row_1_exit_code_passthrough():
    @pytest.mark.parametrize("code", [0, 1, 101, 255])
    def it_exits_with_exactly_the_code_the_real_addon_returned(code):
        returncode, _stdout, _stderr = run_launcher(["exit", str(code)])
        assert returncode == code


def describe_row_2_sigint_delivered_mid_run():
    @posix_only
    def it_produces_genuine_signal_death():
        proc = spawn_launcher(["sleep", "10000"])
        signal_when_ready(proc, signal.SIGINT)
        _stdout, rest = proc.communicate(timeout=30)
        # Negative returncode == killed by that signal (WIFSIGNALED).
        assert proc.returncode == -signal.SIGINT
        assert b"graceful shutdown" in rest


def describe_row_3_sigterm_delivered_mid_run():
    @posix_only
    def it_produces_genuine_signal_death():
        proc = spawn_launcher(["sleep", "10000"])
        signal_when_ready(proc, signal.SIGTERM)
        _stdout, rest = proc.communicate(timeout=30)
        assert proc.returncode == -signal.SIGTERM
        assert b"graceful shutdown" in rest


def describe_row_6_native_fd1_writes_interleave_correctly():
    def it_lands_host_output_ahead_of_native_output():
        # 200KB overruns the pipe buffer, so Python's buffered stdout write
        # is genuinely still draining when the extension writes to fd 1.
        size = 200_000
        returncode, stdout, _stderr = run_launcher(
            ["write-fd1", "NATIVE"], host_unflushed_bytes=size
        )
        assert returncode == 0
        assert stdout == b"h" * size + b"NATIVE"


def describe_row_7_argv_passthrough():
    def it_delivers_utf8_spaces_quotes_and_double_dash_byte_faithfully():
        payload = ["héllo wörld", '--flag="quoted value"', "--", "-x", "après"]
        returncode, stdout, _stderr = run_launcher(["echo-argv", *payload])
        assert returncode == 0
        assert json.loads(stdout.decode("utf-8")) == payload


CTRL_EVENT = FIXTURE_DIR / "ctrl-event.exe"

windows_ctrl = pytest.mark.skipif(
    sys.platform != "win32" or not CTRL_EVENT.exists(),
    reason="Windows console-control harness not available",
)


def run_with_ctrl_event(event):
    """Run the launcher on its own console and deliver a real control event.

    Windows only targets console control events at a process *group*, and
    the event reaches every process on the console — so the target has to be
    isolated onto its own console or the test runner would take the hit too.
    The fixture's `ctrl-event` helper owns both halves: `spawn` creates the
    target with CREATE_NEW_CONSOLE|CREATE_NEW_PROCESS_GROUP and reports its
    pid, `send` attaches to that console and raises the event there.
    """
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(
        [str(FIXTURE_DIR)] + [p for p in [env.get("PYTHONPATH", "")] if p]
    )
    proc = subprocess.Popen(
        [
            str(CTRL_EVENT),
            "spawn",
            sys.executable,
            str(LAUNCHER),
            "sleep",
            "10000",
        ],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    # The helper prints the target's pid before the target starts working.
    # (Popen types these as optional; PIPE above guarantees they are not.)
    assert proc.stdout is not None and proc.stderr is not None
    pid_line = proc.stdout.readline().decode("utf-8", "replace")
    assert pid_line.startswith("PID="), f"helper did not report a pid: {pid_line!r}"
    pid = pid_line.strip().removeprefix("PID=")
    # Then wait for the fixture's readiness line, so the console handler is
    # provably installed before the event is raised.
    stderr_seen = signal_when_ready_bytes(proc)
    sent = subprocess.run(
        [str(CTRL_EVENT), "send", pid, event],
        capture_output=True,
        timeout=30,
    )
    assert sent.returncode == 0, (
        f"ctrl-event send failed ({sent.returncode}): {sent.stderr!r}"
    )
    stdout, rest = proc.communicate(timeout=30)
    return proc.returncode, stdout, stderr_seen + rest


def signal_when_ready_bytes(proc, timeout=15.0):
    """Block until the fixture reports readiness, returning stderr so far."""
    deadline = time.monotonic() + timeout
    seen = b""
    while time.monotonic() < deadline:
        line = proc.stderr.readline()
        if not line:
            break
        seen += line
        if b"fixture: ready" in seen:
            return seen
    raise AssertionError(f"fixture never reported readiness; stderr: {seen!r}")


def describe_row_4_windows_ctrl_c():
    @windows_ctrl
    def it_exits_plainly_with_130_and_never_dies_by_signal():
        returncode, _stdout, stderr = run_with_ctrl_event("c")
        assert b"graceful shutdown" in stderr
        # Windows has no signal death; a plain 130 is the whole contract.
        assert returncode == 130

    @windows_ctrl
    def it_treats_ctrl_break_as_the_same_shutdown_path():
        returncode, _stdout, stderr = run_with_ctrl_event("break")
        assert b"graceful shutdown" in stderr
        assert returncode == 130


def describe_row_5_windows_keyboard_interrupt():
    @windows_ctrl
    def it_never_shows_the_user_a_traceback():
        # A CTRL_C_EVENT also makes CPython raise KeyboardInterrupt in the
        # main thread. Whichever path wins, the user must never see a
        # traceback and the code must still be 130.
        returncode, _stdout, stderr = run_with_ctrl_event("c")
        assert returncode == 130
        assert b"Traceback" not in stderr
        assert b"KeyboardInterrupt" not in stderr


def describe_row_8_prompt_exit():
    def it_does_not_let_lingering_native_threads_hold_the_process_open():
        # The fixture leaves four threads sleeping for 600s and returns 0.
        # Anything that waited on them would hang; the process must exit now.
        started = time.monotonic()
        returncode, _stdout, stderr = run_launcher(["spawn-threads", "4"], timeout=30)
        elapsed = time.monotonic() - started
        assert returncode == 0
        assert b"threads spawned" in stderr
        assert elapsed < 20, f"process took {elapsed:.1f}s to exit"
