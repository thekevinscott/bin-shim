"""bin-shim: runtime shim for native CLIs exposed in-process as
``run_cli(argv) -> int``.

A consumer's console-script entry point reduces to::

    import sys
    from bin_shim import main

    def entry() -> None:
        sys.exit(main("yourpkg._native"))
"""

from .errors import BinShimError
from .main import main
from .resolve import Importer, RunCli, resolve_run_cli
from .semantics import (
    SIGINT_EXIT_CODE,
    SIGTERM_EXIT_CODE,
    apply_exit_semantics,
)

__all__ = [
    "BinShimError",
    "Importer",
    "RunCli",
    "SIGINT_EXIT_CODE",
    "SIGTERM_EXIT_CODE",
    "apply_exit_semantics",
    "main",
    "resolve_run_cli",
]
