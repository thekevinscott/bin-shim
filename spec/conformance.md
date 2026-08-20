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
- **Fixture tier** — the native side is the real reference crate in
  `fixtures/native/`: one Rust `run_cli` exposed through both napi and pyo3,
  so both launchers meet the same native side a consumer would have. Proves
  the end-to-end behaviors a fake cannot: actual mid-run signal delivery into
  native code, fd interleaving with a real native writer, and lingering
  runtime threads. Build it with `fixtures/native/build.sh`; both suites skip
  themselves when it is absent, and CI builds it in
  `.github/workflows/fixture-conformance.yaml`.

## Behavior rows

| # | Behavior | Tier needed |
|---|----------|-------------|
| 1 | **Exit-code passthrough**: `run_cli` returns 0 / 1 / 101 / 255 → process exits with exactly that code | fake |
| 2 | **SIGINT mid-run (POSIX)**: core shuts down gracefully, `run_cli` returns 130 → launcher restores `SIG_DFL` and re-raises SIGINT to itself, so the parent observes genuine signal death (`WIFSIGNALED`), not a plain exit | fake (return-code path); fixture (real mid-run delivery) |
| 3 | **SIGTERM mid-run (POSIX)**: same shape, code 143, re-raise SIGTERM | fake (return-code path); fixture (real mid-run delivery) |
| 4 | **Ctrl-C on Windows**: `run_cli` returns 130 → plain `exit(130)` (no re-raise on Windows) | fake; **validated** against a real `CTRL_C_EVENT` at the fixture tier |
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
4. When it returns a shutdown code, it leaves the signal's disposition in a
   state where re-raising that signal **terminates the process** — either by
   restoring the host's prior disposition *faithfully* or by setting
   `SIG_DFL`. See below; this one is easy to violate by accident.

### Why contract point 4 exists

Both Node and CPython install their signal handlers with `sigaction` and
meaningful `sa_flags` (including `SA_SIGINFO`). A core that saves and
restores around its own handler using `signal()` gets back only the
`sa_handler` field, and reinstalls the host's handler as a plain
one-argument handler with its flags dropped. The host handler is then
silently broken: the signal the launcher re-raises afterwards is swallowed
rather than terminating the process, and **the launcher hangs forever**.

This is not hypothetical — the reference fixture was written this way first,
and rows 2–3 hung until it was changed to a full `sigaction` round trip. It
is precisely the class of defect the fixture tier exists to surface: a
per-language fake installs no handlers, so the fake tier passes either way.

Note the asymmetry in how much protection each launcher can offer. Python's
launcher calls `signal.signal(signum, SIG_DFL)` before re-raising, so it
forces the default disposition itself and is robust to a core that leaves a
handler installed. Node exposes no equivalent — `process.removeAllListeners`
only drops JavaScript listeners and cannot touch a disposition installed by
native code — so on the npm side the guarantee genuinely depends on the core
honoring point 4.

## Implementation mappings

Test IDs are stable pytest/vitest node names; a row is *covered* when at
least one listed test executes it at the required tier.

### Python (`packages/python`, in-process strategy) — fake tier

Suite: `tests/integration/conformance_test.py` (subprocess-based; POSIX rows assert
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
| 8 | — fixture tier only (see below) |

### JavaScript (`packages/javascript`, in-process strategy) — fake tier

Suite: `tests/integration/conformance.test.ts` (subprocess-based; the launcher is written
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
| 8 | — fixture tier only (see below) |

### JavaScript (`packages/javascript`, spawn strategy)

The spawn strategy delegates process semantics to the OS — the child *is* the
native process — so rows 2–4 hold by construction rather than by translation.

| Row | Test |
|-----|------|
| 1 | `src/cli/main.test.ts`, `src/defaults/spawner.test.ts`, `tests/integration/integration.test.ts` |
| 2–8 | N/A — owned by the OS, not by the launcher |

### Fixture tier (both languages, real `fixtures/native` crate)

Suites: `packages/javascript/tests/integration/fixture.conformance.test.ts` and
`packages/python/tests/integration/fixture_conformance_test.py`. Rows 2–3 here send a
**real signal to a running process** and wait for the fixture's readiness
line first, so the handlers are provably installed before delivery — these
are the rows the fake tier cannot state honestly. POSIX only; run by
`.github/workflows/fixture-conformance.yaml` on ubuntu and macos.

| Row | JavaScript | Python |
|-----|------------|--------|
| 1 | `fixture tier: row 1 …` | `describe_row_1_exit_code_passthrough::…` |
| 2 | `fixture tier: row 2 — SIGINT delivered mid-run` | `describe_row_2_sigint_delivered_mid_run::it_produces_genuine_signal_death` |
| 3 | `fixture tier: row 3 — SIGTERM delivered mid-run` | `describe_row_3_sigterm_delivered_mid_run::it_produces_genuine_signal_death` |
| 4 | `fixture tier: row 4 — Windows ctrl-c` | `describe_row_4_windows_ctrl_c::…` |
| 5 | — Python-only row | `describe_row_5_windows_keyboard_interrupt::…` (Windows), plus the fake tier on POSIX |
| 6 | `fixture tier: row 6 — native fd-1 writes interleave correctly` | `describe_row_6_native_fd1_writes_interleave_correctly::…` |
| 7 | `fixture tier: row 7 — argv passthrough` | `describe_row_7_argv_passthrough::…` |
| 8 | `fixture tier: row 8 — prompt exit` | `describe_row_8_prompt_exit::…` |

Row 8 exists only at this tier: the fixture leaves four OS threads sleeping
for 600s and returns immediately, and the row asserts the process still exits
at once. A fake has no native threads, so there is nothing for it to prove.

### Windows: rows 4–5 against a real `CTRL_C_EVENT`

These rows were **designed but untested** when the spec was first written —
an open item inherited from dirsql's spike. They are now validated on
Windows CI against the reference fixture, which registers a real console
control handler via `SetConsoleCtrlHandler`.

Getting a genuine event to one process takes more machinery than POSIX's
`kill`, and the constraints are worth recording:

- `GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)` reaches **every** process
  sharing the caller's console, which would include the test runner.
- Windows only targets a specific process **group**, and only a process
  created with `CREATE_NEW_PROCESS_GROUP` is in one. Node cannot set that
  flag — `detached` maps to `DETACHED_PROCESS`, which leaves the child with
  no console at all, so there is then nothing to send a console event to.
- A process in a new group starts with Ctrl-C *disabled*, inheriting an
  ignore-handler. The fixture clears that with `SetConsoleCtrlHandler(NULL,
  FALSE)` before installing its own, or the event never arrives.

So the fixture ships a `ctrl-event` helper (`fixtures/native/crates/ctrl-event`)
owning both halves: `spawn` starts the target on its own console and in its
own group and reports its pid; `send` attaches to that console and raises the
event there, which is what keeps it off the test runner.

Both `CTRL_C_EVENT` and `CTRL_BREAK_EVENT` are exercised. Windows reports one
console event rather than distinct signals, so the fixture maps both to the
SIGINT-shaped shutdown and returns 130 — and the launcher exits plainly with
130, never by signal, since Windows has no signal death to produce.
