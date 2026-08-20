"""The package's public surface: everything documented in the README is
importable from the top-level ``bin_shim`` namespace."""

from . import (
    SIGINT_EXIT_CODE,
    SIGTERM_EXIT_CODE,
    BinShimError,
    Importer,
    RunCli,
    __all__,
    apply_exit_semantics,
    main,
    resolve_run_cli,
)


def describe_public_api():
    def test_exports_exactly_the_documented_surface():
        assert sorted(__all__) == [
            "BinShimError",
            "Importer",
            "RunCli",
            "SIGINT_EXIT_CODE",
            "SIGTERM_EXIT_CODE",
            "apply_exit_semantics",
            "main",
            "resolve_run_cli",
        ]

    def test_every_export_resolves():
        exports = [
            BinShimError,
            Importer,
            RunCli,
            SIGINT_EXIT_CODE,
            SIGTERM_EXIT_CODE,
            apply_exit_semantics,
            main,
            resolve_run_cli,
        ]
        for export in exports:
            assert export is not None

    def test_shutdown_codes_follow_the_128_plus_n_convention():
        assert SIGINT_EXIT_CODE == 130
        assert SIGTERM_EXIT_CODE == 143
