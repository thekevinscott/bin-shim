"""Exceptions raised by bin-shim."""


class BinShimError(Exception):
    """The native module could not be resolved, or it violated the
    ``run_cli`` contract (see spec/conformance.md at the repo root)."""
