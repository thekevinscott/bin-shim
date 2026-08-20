"""Unit tests for bin_shim.resolve."""

import sys
from types import ModuleType

import pytest

from bin_shim.resolve import BinShimError, resolve_run_cli


def _module_with(**attrs) -> ModuleType:
    mod = ModuleType("fake_native")
    for name, value in attrs.items():
        setattr(mod, name, value)
    return mod


def describe_resolve_run_cli():
    def test_returns_the_entry_point_from_an_injected_importer():
        def run_cli(argv):
            return 0

        mod = _module_with(run_cli=run_cli)
        assert resolve_run_cli("fake_native", importer=lambda name: mod) is run_cli

    def test_passes_the_module_name_to_the_importer():
        seen = []

        def importer(name):
            seen.append(name)
            return _module_with(run_cli=lambda argv: 0)

        resolve_run_cli("yourpkg._native", importer=importer)
        assert seen == ["yourpkg._native"]

    def test_defaults_to_importlib_when_no_importer_is_given(monkeypatch):
        mod = _module_with(run_cli=lambda argv: 0)
        monkeypatch.setitem(sys.modules, "bin_shim_fake_native", mod)
        assert resolve_run_cli("bin_shim_fake_native")(["x"]) == 0

    def test_honors_a_custom_entry_point_name():
        def other(argv):
            return 3

        mod = _module_with(other=other)
        entry = resolve_run_cli("fake_native", entry_point="other", importer=lambda name: mod)
        assert entry is other

    def test_wraps_import_failure_with_an_installation_hint():
        def importer(name):
            raise ImportError("No module named 'fake_native'")

        with pytest.raises(BinShimError, match="prebuilt wheel") as excinfo:
            resolve_run_cli("fake_native", importer=importer)
        assert isinstance(excinfo.value.__cause__, ImportError)

    def test_rejects_a_module_without_the_entry_point():
        mod = _module_with()
        with pytest.raises(BinShimError, match="has no attribute 'run_cli'"):
            resolve_run_cli("fake_native", importer=lambda name: mod)

    def test_rejects_a_non_callable_entry_point():
        mod = _module_with(run_cli=42)
        with pytest.raises(BinShimError, match="is not callable"):
            resolve_run_cli("fake_native", importer=lambda name: mod)
