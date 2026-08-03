# Process-Semantics Conformance Spec

This is the language-agnostic contract every bin-shim launcher implements.
A CLI launched through any bin-shim strategy must be observably identical —
to the invoking shell, to job control, to pipes — to running the native
binary directly. Each implementation's test suite executes the rows below
and records its mapping in the tables at the bottom.

Process rule (from `AGENTS.md`): any semantics change lands here as a row
**before** the behavior ships.

## Tiers

- **Fake tier** — the native side is a per-language fake (a pure-Python /
  pure-JS module implementing the contract). Proves the *launcher's*
  behavior, including genuine signal death, via subprocess-based tests.
- **Fixture tier** — the native side is the real reference fixture crate
  (napi + pyo3 over one Rust `run_cli`; issue
  [#14](https://github.com/thekevinscott/bin-shim/issues/14)). Proves the
  end-to-end behaviors a fake cannot: actual mid-run signal delivery into
  native code, fd interleaving with a real native writer, runtime-thread
  shutdown.

## Behavior rows

| # | Behavior | Tier needed |
|---|----------|-------------|
| 1 | **Exit-code passthrough**: `run_cli` returns 0 / 1 / 101 / 255 → process exits with exactly that code | fake |
| 2 | **SIGINT mid-run (POSIX)**: core shuts down gracefully, `run_cli` returns 130 → launcher restores `SIG_DFL` and re-raises SIGINT to itself, so the parent observes genuine signal death (`WIFSIGNALED`), not a plain exit | fake (return-code path); fixture (real mid-run delivery) |
| 3 | **SIGTERM mid-run (POSIX)**: same shape, code 143, re-raise SIGTERM | fake (return-code path); fixture (real mid-run delivery) |
| 4 | **Ctrl-C on Windows**: `run_cli` returns 130 → plain `exit(130)` (no re-raise on Windows) | fake; real `CTRL_C_EVENT` validation tracked in [#15](https://github.com/thekevinscott/bin-shim/issues/15) |
| 5 | **Python only**: a `KeyboardInterrupt` raised around the native call is treated as the SIGINT-shutdown path (row 2), and no traceback ever reaches the user; pending interrupts are cleared before the launcher acts on the return code | fake |
| 6 | **Host stdio flushed** before invoking `run_cli` (the native side writes fds 1/2 directly; unflushed host buffers must not interleave out of order) | fake; fixture for a real native writer |
| 7 | **argv passthrough**: UTF-8, embedded spaces, quotes, `--` — delivered to `run_cli` byte-faithfully, no shell interpretation | fake |
| 8 | **Prompt exit**: after `run_cli` returns, the process exits without lingering runtime threads holding it open | fixture only (a fake has no native runtime threads) |

### Rationale for rows 2–4

`128 + N` is the POSIX convention for signal-caused exits; the re-raise
preserves shell job-control semantics and is exactly what a spawn-based
launcher already produces (a child killed by SIGINT reports `WIFSIGNALED`
to the wrapper's parent). Switching spawn → in-process is therefore
observably behavior-preserving.

## The `run_cli` contract (what bin-shim requires of the native side)

1. `run_cli(argv) -> i32` **always returns**; it never terminates the
   process.
2. It registers its own SIGINT/SIGTERM (POSIX) / ctrl-c (Windows) handling
   for the duration of the run; on receipt it performs graceful shutdown and
   returns 130/143. Shutdown logic lives in the core, once — launchers only
   translate.
3. It writes only to file descriptors 1/2; it never touches host-language
   stdio objects.

## Implementation mappings

Test IDs are stable pytest/vitest node names; a row is *covered* when at
least one listed test executes it at the required tier.

### Python (`packages/python`, in-process strategy) — fake tier

Suite: `tests/conformance_test.py` (subprocess-based; POSIX rows assert
`returncode == -N`, i.e. `WIFSIGNALED`). Launcher-internal steps are
additionally pinned by the colocated unit suites (`src/bin_shim/*_test.py`).

| Row | Test |
|-----|------|
| 1 | `describe_row_1_exit_code_passthrough::test_process_exits_with_exactly_the_returned_code[0/1/101/255]` |
| 2 | `describe_row_2_sigint_shutdown_posix::test_130_becomes_genuine_signal_death_by_sigint` |
| 3 | `describe_row_3_sigterm_shutdown_posix::test_143_becomes_genuine_signal_death_by_sigterm` |
| 4 | `describe_row_4_windows_plain_exit::test_130_exits_plainly_with_130` (Windows CI) |
| 5 | `describe_row_5_keyboard_interrupt::*` |
| 6 | `describe_row_6_host_stdio_flushed_before_native_call::test_buffered_host_output_lands_ahead_of_native_fd1_writes` |
| 7 | `describe_row_7_argv_passthrough::test_utf8_spaces_quotes_and_double_dash_arrive_byte_faithfully` |
| 8 | — fixture tier, pending [#14](https://github.com/thekevinscott/bin-shim/issues/14) |

### JavaScript (`packages/javascript`, in-process strategy) — fake tier

Suite: `src/conformance.test.ts` (subprocess-based; the launcher is written
to a real file rather than run via `node -e`, so `process.argv.slice(2)` has
production semantics. POSIX rows assert `signal === 'SIG…'` with a null exit
code, i.e. `WIFSIGNALED`). Launcher-internal steps are additionally pinned by
the colocated unit suites (`src/**/*.test.ts`).

| Row | Test |
|-----|------|
| 1 | `row 1: exit-code passthrough > process exits with exactly the returned code 0/1/101/255` |
| 2 | `row 2: SIGINT shutdown (POSIX) > 130 becomes genuine signal death by SIGINT` |
| 3 | `row 3: SIGTERM shutdown (POSIX) > 143 becomes genuine signal death by SIGTERM` |
| 4 | `row 4: Windows plain exit > 130 exits plainly with 130, with no re-raise` (Windows CI) |
| 5 | — Python-only row |
| 6 | `row 6: host stdio flushed before the native call > buffered host output lands ahead of native fd-1 writes` |
| 7 | `row 7: argv passthrough > UTF-8, spaces, quotes and -- arrive byte-faithfully` |
| 8 | — fixture tier, pending [#14](https://github.com/thekevinscott/bin-shim/issues/14) |

### JavaScript (`packages/javascript`, spawn strategy)

The spawn strategy delegates process semantics to the OS — the child *is* the
native process — so rows 2–4 hold by construction rather than by translation.

| Row | Test |
|-----|------|
| 1 | `src/cli/main.test.ts`, `src/defaults/spawner.test.ts`, `src/integration.test.ts` |
| 2–8 | N/A — owned by the OS, not by the launcher |

### Fixture tier

Pending [#14](https://github.com/thekevinscott/bin-shim/issues/14) (reference
napi + pyo3 crate); Windows ctrl-c validation pending
[#15](https://github.com/thekevinscott/bin-shim/issues/15).
