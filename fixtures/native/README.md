# Native conformance fixture

The reference `run_cli` implementation backing the **fixture tier** of
[`spec/conformance.md`](../../spec/conformance.md). One Rust core, exposed to
Node through napi and to Python through pyo3, so both launchers are tested
against the same native side a real consumer would have.

This crate is never published. It exists solely to be loaded by the two
conformance suites.

```
crates/core/   the run_cli contract implementation (all the behavior)
crates/napi/   napi binding   -> dist/fixture.node          (Node)
crates/pyo3/   pyo3 binding   -> dist/bin_shim_fixture.so   (Python)
```

## Build

```sh
./build.sh
```

Cargo names cdylibs per-platform (`lib*.so` / `lib*.dylib` / `*.dll`) and
neither runtime accepts those names as-is — Node wants a `.node` suffix,
Python wants the module's import name. `build.sh` does that rename into
`dist/`, so the suites can look for one fixed path.

Both conformance suites **skip themselves** when `dist/` is missing, so the
normal test commands work without a Rust toolchain. CI builds the fixture in
`.github/workflows/fixture-conformance.yaml` and fails loudly if the suites
end up skipped.

## Behavior

`run_cli` selects behavior from `argv[0]`:

| argv | behavior | row |
|------|----------|-----|
| `exit <n>` | return `n` | 1 |
| `sleep <ms>` | install handlers, announce readiness on fd 2, sleep; return 130/143 if signalled | 2, 3 |
| `write-fd1 <text>` | write `text` straight to fd 1 | 6 |
| `echo-argv <args…>` | write the remaining argv to fd 1 as JSON | 7 |
| `spawn-threads <n>` | leave `n` threads sleeping 600s, return 0 | 8 |

Anything else returns 64 (`EX_USAGE`).

The `sleep` mode prints `fixture: ready` to fd 2 *after* its handlers are
installed. The suites wait for that line before sending a signal; without it
the delivery races handler installation and rows 2–3 flake.

## A note on `sigaction`

`crates/core` saves and restores the host's signal dispositions with
`sigaction`, never `signal()`. This is load-bearing: Node and CPython install
their handlers with `SA_SIGINFO` and friends, and a `signal()` round trip
silently drops those flags, leaving the host's handler broken so that the
signal the launcher re-raises is swallowed — hanging the launcher forever.

The fixture was written the naive way first and rows 2–3 hung, which is what
prompted contract point 4 in the spec. Consider that a warning worth
inheriting if you are writing a real core.
