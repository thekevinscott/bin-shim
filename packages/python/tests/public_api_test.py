"""The package's public surface: everything documented in the README is
importable from the top-level ``bin_shim`` namespace."""

import bin_shim


def describe_public_api():
    def test_exports_exactly_the_documented_surface():
        assert sorted(bin_shim.__all__) == [
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
        for name in bin_shim.__all__:
            assert getattr(bin_shim, name) is not None

    def test_shutdown_codes_follow_the_128_plus_n_convention():
        assert bin_shim.SIGINT_EXIT_CODE == 130
        assert bin_shim.SIGTERM_EXIT_CODE == 143
