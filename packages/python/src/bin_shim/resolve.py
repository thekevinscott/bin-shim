"""Resolve the native module's ``run_cli`` entry point.

The Python mirror of the JS package's ``resolveBinary``: locate the thing to
invoke, with a helpful error when it isn't there. In-process, "locating"
means importing the bindings module and looking up its entry point.
"""

from collections.abc import Callable
from importlib import import_module
from types import ModuleType

from .errors import BinShimError

RunCli = Callable[[list[str]], int]
"""The native entry point: ``run_cli(argv) -> int``. It must always return —
never terminate the process — and write only to file descriptors 1/2."""

Importer = Callable[[str], ModuleType]


def resolve_run_cli(
    module: str,
    *,
    entry_point: str = "run_cli",
    importer: Importer | None = None,
) -> RunCli:
    """Import ``module`` and return its ``entry_point`` callable.

    Raises ``BinShimError`` with an installation hint when the module is
    missing (typically: no prebuilt wheel matched this platform), or when the
    module does not expose a callable ``entry_point``.
    """
    do_import = import_module if importer is None else importer
    try:
        mod = do_import(module)
    except ImportError as err:
        raise BinShimError(
            f"Failed to import native module '{module}': {err}\n"
            "This usually means no prebuilt wheel matched this platform, or "
            "the package was installed without its native dependency. "
            "Reinstall the package, or use a language-native install path "
            "(cargo install, brew install, a direct release download) "
            "instead."
        ) from err
    entry = getattr(mod, entry_point, None)
    if entry is None:
        raise BinShimError(
            f"Native module '{module}' has no attribute '{entry_point}'; "
            "it does not implement the run_cli contract."
        )
    if not callable(entry):
        raise BinShimError(
            f"'{module}.{entry_point}' is not callable "
            f"(got {type(entry).__name__}); "
            "it does not implement the run_cli contract."
        )
    return entry
