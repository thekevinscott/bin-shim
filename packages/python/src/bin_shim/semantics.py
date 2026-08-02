"""Translate ``run_cli`` return codes into observable process semantics.

The native core owns graceful shutdown and reports it via ``128 + N`` return
codes; this module owns making the *process* observable to its parent the
same way a spawned child would be. On POSIX that means genuine signal death
(``WIFSIGNALED``), not a plain exit — see rows 2–4 of spec/conformance.md.
"""

import os
import signal
import sys
from typing import NoReturn

SIGINT_EXIT_CODE = 130
SIGTERM_EXIT_CODE = 143


def apply_exit_semantics(code: int, *, platform: str | None = None) -> int:
    """Return the exit code the caller should pass to ``sys.exit`` — or, for
    the signal-shutdown codes on POSIX, re-raise the signal and never return.

    ``platform`` defaults to ``sys.platform``; it is injectable so unit tests
    can exercise both branches from any host.
    """
    plat = sys.platform if platform is None else platform
    if plat == "win32":
        # No re-raise on Windows (conformance row 4): plain exit codes only.
        return code
    if code == SIGINT_EXIT_CODE:
        _die_by_signal(signal.SIGINT)
    if code == SIGTERM_EXIT_CODE:
        _die_by_signal(signal.SIGTERM)
    return code


def _die_by_signal(signum: signal.Signals) -> NoReturn:
    """Restore the default handler and re-raise ``signum`` at ourselves, so
    the parent observes genuine signal death and shell job control works.
    """
    signal.signal(signum, signal.SIG_DFL)
    # The signal kills us before any atexit/io teardown runs; flush now so
    # buffered output isn't lost.
    sys.stdout.flush()
    sys.stderr.flush()
    os.kill(os.getpid(), signum)
    # POSIX delivers the pending signal before kill() returns, so this line is
    # unreachable in production; it guards against a mocked or exotic kill.
    raise SystemExit(128 + int(signum))
