# bin-shim (Python)

Runtime shim for native CLIs exposed **in-process** as `run_cli(argv) -> int`.

The pattern: your Rust (or C, or Zig) CLI is compiled once as a library and
exposed through Python bindings (e.g. pyo3) as a function that takes argv and
returns an exit code. Your PyPI package's console script then needs to make
the *process* behave exactly as if the binary had been run directly — exit
codes, signals, stdio ordering. `bin-shim` owns those process semantics so
your launcher reduces to one line.

The npm sibling package (same repo) covers the spawn pattern for
Node; both implementations execute the same
[process-semantics conformance spec](https://github.com/thekevinscott/bin-shim/blob/main/spec/conformance.md).

## Install

```sh
uv add bin-shim
```

## Quickstart

Your package ships a native bindings module (say `yourpkg._native`) exposing
`run_cli`. Point a console script at a two-line entry:

```python
# yourpkg/cli.py
import sys
from bin_shim import main

def entry() -> None:
    sys.exit(main("yourpkg._native"))
```

```toml
# pyproject.toml
[project.scripts]
yourcli = "yourpkg.cli:entry"
```

## What `main` does

1. Flushes host stdio, so the native side's direct fd-1/fd-2 writes can't
   land ahead of earlier buffered Python output.
2. Imports the native module and looks up `run_cli` (helpful `BinShimError`
   if the wheel for this platform is missing).
3. Calls `run_cli(argv)` (default `sys.argv[1:]`), passing argv through
   byte-faithfully — no shell interpretation.
4. Translates the returned code into process semantics:
   - ordinary codes are returned for you to `sys.exit` with;
   - on POSIX, `130`/`143` (the core's graceful-shutdown codes for
     SIGINT/SIGTERM) restore the default handler and re-raise the signal, so
     the parent shell observes genuine signal death and job control works;
   - on Windows there is no re-raise — `130` exits plainly as `130`;
   - a `KeyboardInterrupt` escaping the native call is treated as the
     SIGINT-shutdown path, and no traceback ever reaches the user.

## API

### `main(module, argv=None, *, entry_point="run_cli", importer=None, run_cli=None, platform=None) -> int`

Resolve and invoke the native entry point, apply exit semantics, and return
the code to pass to `sys.exit`. For the POSIX signal-shutdown codes it does
not return (the process dies by re-raised signal). `importer` and `run_cli`
are injectable seams for testing; `platform` defaults to `sys.platform`.

### `resolve_run_cli(module, *, entry_point="run_cli", importer=None) -> RunCli`

Import `module` and return its `entry_point` callable, or raise
`BinShimError` with an installation hint.

### `apply_exit_semantics(code, *, platform=None) -> int`

The translation step alone: passthrough for ordinary codes, signal re-raise
for `130`/`143` on POSIX, plain passthrough on Windows.

### Constants and types

- `SIGINT_EXIT_CODE = 130`, `SIGTERM_EXIT_CODE = 143` (the `128 + N`
  POSIX convention)
- `RunCli = Callable[[list[str]], int]`
- `Importer = Callable[[str], ModuleType]`
- `BinShimError` — resolution failures and contract violations

## The `run_cli` contract

What this library requires of the native side:

1. `run_cli(argv) -> int` **always returns**; it never terminates the
   process.
2. It registers its own SIGINT/SIGTERM (POSIX) / ctrl-c (Windows) handling
   for the duration of the run; on receipt it performs graceful shutdown and
   returns 130/143. Shutdown logic lives in the core, once — launchers only
   translate.
3. It writes only to file descriptors 1/2; it never touches host-language
   stdio objects.

## What `bin-shim` does not do

- **Build or package the native module.** That's your build backend
  (maturin, setuptools-rust, …).
- **Argv middleware.** Preprocess argv yourself and pass the result to
  `main`.
- **Spawn anything.** This is the in-process strategy; nothing is executed
  as a child process.

## License

MIT
