"""Unit tests for bin_shim.main.

These use the injectable seams (``run_cli`` / ``importer``) with
``platform="win32"`` or ordinary codes so no test dies by signal; the
signal-death paths are proven by the subprocess-based conformance suite.
"""

import sys
from types import ModuleType

import pytest

from bin_shim.errors import BinShimError
from bin_shim.main import main


class _FlushRecorder:
    def __init__(self, events, label):
        self._events = events
        self._label = label

    def flush(self):
        self._events.append(self._label)


def describe_main():
    def test_returns_the_run_cli_exit_code():
        assert main("mod", argv=[], run_cli=lambda argv: 5, platform="linux") == 5

    def test_passes_argv_through_as_a_list():
        seen = []

        def run_cli(argv):
            seen.append(argv)
            return 0

        main("mod", argv=("a", "b c", "--"), run_cli=run_cli, platform="linux")
        assert seen == [["a", "b c", "--"]]

    def test_defaults_argv_to_sys_argv_after_the_program_name(monkeypatch):
        seen = []

        def run_cli(argv):
            seen.append(argv)
            return 0

        monkeypatch.setattr(sys, "argv", ["prog", "x", "y"])
        main("mod", run_cli=run_cli, platform="linux")
        assert seen == [["x", "y"]]

    def test_resolves_the_entry_point_when_run_cli_is_not_injected():
        mod = ModuleType("fake_native")
        setattr(mod, "run_cli", lambda argv: 9)
        result = main(
            "fake_native", argv=[], importer=lambda name: mod, platform="linux"
        )
        assert result == 9

    def test_flushes_host_stdio_before_invoking_run_cli(monkeypatch):
        events = []
        monkeypatch.setattr(sys, "stdout", _FlushRecorder(events, "flush_stdout"))
        monkeypatch.setattr(sys, "stderr", _FlushRecorder(events, "flush_stderr"))

        def run_cli(argv):
            events.append("run_cli")
            return 0

        main("mod", argv=[], run_cli=run_cli, platform="linux")
        assert events == ["flush_stdout", "flush_stderr", "run_cli"]

    def test_treats_keyboard_interrupt_as_the_sigint_shutdown_code():
        def run_cli(argv):
            raise KeyboardInterrupt

        # win32 so the 130 comes back as a plain return instead of a re-raise.
        assert main("mod", argv=[], run_cli=run_cli, platform="win32") == 130

    def test_applies_exit_semantics_to_the_returned_code():
        # 130 on win32 passes through untranslated (conformance row 4).
        assert main("mod", argv=[], run_cli=lambda argv: 130, platform="win32") == 130

    @pytest.mark.parametrize("bad", [None, "0", 1.5])
    def test_rejects_a_non_int_return_value(bad):
        with pytest.raises(BinShimError, match="must return an int exit code"):
            main("mod", argv=[], run_cli=lambda argv: bad, platform="linux")

    def test_rejects_a_bool_return_value():
        with pytest.raises(BinShimError, match="must return an int exit code"):
            main("mod", argv=[], run_cli=lambda argv: True, platform="linux")
