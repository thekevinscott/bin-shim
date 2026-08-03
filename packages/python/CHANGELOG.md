# Changelog

All notable changes to the PyPI `bin-shim` package are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Initial release: `main`, `resolve_run_cli`, `apply_exit_semantics`,
  `BinShimError`, `SIGINT_EXIT_CODE`/`SIGTERM_EXIT_CODE`, and the
  `RunCli`/`Importer` types — the in-process launcher for native CLIs
  exposed as `run_cli(argv) -> int`, implementing the process-semantics
  conformance spec (exit-code passthrough, POSIX signal re-raise for
  130/143, Windows plain exit, `KeyboardInterrupt` handling, host-stdio
  flushing, byte-faithful argv).
