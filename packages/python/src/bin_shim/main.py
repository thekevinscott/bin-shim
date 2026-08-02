"""The in-process launcher: import the native module, call ``run_cli``,
translate the result into process semantics.

The Python mirror of the JS package's ``main``: the caller stays responsible
for exiting (``sys.exit(main(...))``), which keeps the seam testable.
"""

import sys
from collections.abc import Sequence

from .errors import BinShimError
from .resolve import Importer, RunCli, resolve_run_cli
from .semantics import SIGINT_EXIT_CODE, apply_exit_semantics


def main(
    module: str,
    argv: Sequence[str] | None = None,
    *,
    entry_point: str = "run_cli",
    importer: Importer | None = None,
    run_cli: RunCli | None = None,
    platform: str | None = None,
) -> int:
    """Resolve ``module``'s ``entry_point``, invoke it with ``argv`` (default
    ``sys.argv[1:]``), and return the exit code to pass to ``sys.exit`` — or
    die by re-raised signal for the 130/143 shutdown codes on POSIX.

    ``importer`` and ``run_cli`` are injectable seams (mirroring the JS
    package's ``resolveBin``/``spawn``) so tests can substitute the native
    module.
    """
    args = list(sys.argv[1:] if argv is None else argv)
    entry = (
        resolve_run_cli(module, entry_point=entry_point, importer=importer)
        if run_cli is None
        else run_cli
    )
    # The native side writes to fds 1/2 directly; flush host buffers first so
    # earlier host output cannot land after native output (conformance row 6).
    sys.stdout.flush()
    sys.stderr.flush()
    try:
        code = entry(args)
    except KeyboardInterrupt:
        # An interrupt that escaped around the native call is the
        # SIGINT-shutdown path; the user must never see a traceback, and
        # catching it clears the pending interrupt (conformance row 5).
        code = SIGINT_EXIT_CODE
    if isinstance(code, bool) or not isinstance(code, int):
        raise BinShimError(
            f"'{module}.{entry_point}' must return an int exit code; got "
            f"{code!r}. The module does not implement the run_cli contract."
        )
    return apply_exit_semantics(code, platform=platform)
