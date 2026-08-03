//! Reference implementation of the `run_cli` contract from
//! `spec/conformance.md`.
//!
//! This is the *fixture tier* of the conformance suite: one Rust core,
//! exposed to Node through napi and to Python through pyo3, so both
//! launchers are tested against the same native side a real consumer would
//! have. The per-language fakes cover the launchers' own logic; this crate
//! covers what a fake structurally cannot — real signals delivered into
//! native code mid-run, real writes to file descriptors 1/2, and real
//! background threads outliving the call.
//!
//! The contract it upholds:
//!
//! 1. `run_cli` always returns; it never terminates the process.
//! 2. It registers its own SIGINT/SIGTERM handling for the duration of the
//!    run, performs graceful shutdown on receipt, and returns 130/143.
//! 3. It writes only to file descriptors 1/2, never to host-language stdio.

use std::sync::atomic::{AtomicI32, Ordering};
use std::time::{Duration, Instant};

/// Set by the signal handler to the signal number received, 0 when none.
/// A plain atomic is the only thing a POSIX signal handler may safely touch.
static SIGNALLED: AtomicI32 = AtomicI32::new(0);

/// The signal we shut down for, so the guard knows to leave it at `SIG_DFL`
/// rather than handing it back to the host. See `SignalGuard`'s docs.
static SHUTDOWN_SIGNAL: AtomicI32 = AtomicI32::new(0);

#[cfg(unix)]
extern "C" fn handle_signal(sig: i32) {
    SIGNALLED.store(sig, Ordering::SeqCst);
}

/// Guard installing our handlers on construction and, on drop, putting each
/// signal back the way contract point 4 requires.
///
/// Two things matter here, both learned the hard way.
///
/// **Save and restore with `sigaction`, never `signal`.** Node and CPython
/// install their handlers with `sigaction` and meaningful `sa_flags`
/// (`SA_SIGINFO` among them). Saving such a handler with `signal()` yields
/// only its `sa_handler` field, and restoring it that way reinstalls it as a
/// plain one-argument handler with the flags dropped — the host's handler is
/// then silently broken.
///
/// **Leave the shutdown signal at `SIG_DFL`.** For the signal we actually
/// shut down for, handing the host's handler back is not enough: the
/// launcher is about to re-raise that signal expecting to die, and a host
/// handler that merely notes it and returns swallows the re-raise, hanging
/// the launcher. Whether a given host's handler terminates on re-raise is
/// its own business and varies by platform, so the fixture does not depend
/// on it. `SIG_DFL` is the other option contract point 4 permits, and it is
/// the one a core should prefer: it makes the outcome the kernel's decision
/// rather than the host runtime's.
#[cfg(unix)]
struct SignalGuard {
    previous: Vec<(i32, libc::sigaction)>,
}

#[cfg(unix)]
const HANDLED_SIGNALS: [i32; 2] = [libc::SIGINT, libc::SIGTERM];

#[cfg(unix)]
impl SignalGuard {
    fn install() -> Self {
        SIGNALLED.store(0, Ordering::SeqCst);
        SHUTDOWN_SIGNAL.store(0, Ordering::SeqCst);
        let mut previous = Vec::with_capacity(HANDLED_SIGNALS.len());
        // SAFETY: installing an extern "C" handler that only stores to an
        // atomic — the one operation guaranteed async-signal-safe — and
        // capturing each prior disposition in full.
        unsafe {
            for sig in HANDLED_SIGNALS {
                let mut action: libc::sigaction = std::mem::zeroed();
                action.sa_sigaction = handle_signal as *const () as usize;
                libc::sigemptyset(&mut action.sa_mask);
                action.sa_flags = libc::SA_RESTART;
                let mut old: libc::sigaction = std::mem::zeroed();
                libc::sigaction(sig, &action, &mut old);
                previous.push((sig, old));
            }
        }
        Self { previous }
    }
}

#[cfg(unix)]
impl Drop for SignalGuard {
    fn drop(&mut self) {
        let shutdown = SHUTDOWN_SIGNAL.load(Ordering::SeqCst);
        // SAFETY: restoring dispositions captured by sigaction() itself,
        // flags and all — except the shutdown signal, which is left at
        // SIG_DFL so the launcher's re-raise reliably terminates us.
        unsafe {
            for (sig, old) in &self.previous {
                if *sig == shutdown {
                    let mut default: libc::sigaction = std::mem::zeroed();
                    default.sa_sigaction = libc::SIG_DFL;
                    libc::sigemptyset(&mut default.sa_mask);
                    libc::sigaction(*sig, &default, std::ptr::null_mut());
                } else {
                    libc::sigaction(*sig, old, std::ptr::null_mut());
                }
            }
        }
    }
}

/// Windows has no POSIX signals; the console sends control *events* instead.
/// We register a console control handler for the duration of the run, which
/// is the Windows spelling of contract point 2.
///
/// The two numbers below are the shutdown codes the core reports. Windows
/// has no SIGTERM analogue, so CTRL_BREAK is mapped to the same 130 as
/// CTRL_C: both mean "the user asked us to stop".
#[cfg(windows)]
mod win {
    use super::{SIGNALLED, Ordering};

    pub const CTRL_C_EVENT: u32 = 0;
    pub const CTRL_BREAK_EVENT: u32 = 1;
    /// Sentinel stored in SIGNALLED; translated to 130 by shutdown_code.
    pub const CTRL_SIGNAL: i32 = 2;

    #[link(name = "kernel32")]
    extern "system" {
        pub fn SetConsoleCtrlHandler(
            handler: Option<unsafe extern "system" fn(u32) -> i32>,
            add: i32,
        ) -> i32;
    }

    pub unsafe extern "system" fn handle_console_ctrl(event: u32) -> i32 {
        if event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT {
            SIGNALLED.store(CTRL_SIGNAL, Ordering::SeqCst);
            // TRUE: we handled it, so the default terminator does not run
            // and run_cli gets to return its shutdown code (contract
            // point 1 — run_cli always returns).
            return 1;
        }
        0
    }
}

#[cfg(windows)]
struct SignalGuard;

#[cfg(windows)]
impl SignalGuard {
    fn install() -> Self {
        SIGNALLED.store(0, Ordering::SeqCst);
        // SAFETY: registering a handler that only stores to an atomic.
        unsafe {
            // A process created with CREATE_NEW_PROCESS_GROUP starts with
            // Ctrl-C *disabled* (it inherits an ignore-handler). Clearing
            // that is what makes a delivered CTRL_C_EVENT reach us at all —
            // and creating such a group is the only way a test harness can
            // target one process rather than the whole console.
            win::SetConsoleCtrlHandler(None, 0);
            win::SetConsoleCtrlHandler(Some(win::handle_console_ctrl), 1);
        }
        Self
    }
}

#[cfg(windows)]
impl Drop for SignalGuard {
    fn drop(&mut self) {
        // SAFETY: removing the handler we added, scoping handling to the run.
        unsafe {
            win::SetConsoleCtrlHandler(Some(win::handle_console_ctrl), 0);
        }
    }
}

#[cfg(not(any(unix, windows)))]
struct SignalGuard;

#[cfg(not(any(unix, windows)))]
impl SignalGuard {
    fn install() -> Self {
        SIGNALLED.store(0, Ordering::SeqCst);
        Self
    }
}

/// Write straight to a file descriptor, bypassing Rust's `println!` buffers
/// as well as the host language's stdio objects (contract point 3).
fn write_fd(fd: i32, bytes: &[u8]) {
    let mut written = 0;
    while written < bytes.len() {
        let remaining = bytes.len() - written;
        // The count parameter is size_t on POSIX but c_uint on Windows.
        #[cfg(unix)]
        let count = remaining;
        #[cfg(windows)]
        let count = remaining as libc::c_uint;
        // SAFETY: writing a subslice of a live buffer to a raw fd.
        let n = unsafe {
            libc::write(
                fd,
                bytes[written..].as_ptr() as *const libc::c_void,
                count,
            )
        };
        if n <= 0 {
            return;
        }
        written += n as usize;
    }
}

fn shutdown_code(sig: i32) -> i32 {
    // Graceful shutdown lives here, in the core, once — launchers only
    // translate the code (spec rows 2-4).
    write_fd(2, b"fixture: graceful shutdown\n");
    // Tells the guard to leave this one at SIG_DFL, so the launcher's
    // re-raise terminates us rather than hitting a host handler. Harmless
    // on Windows, where there is nothing to re-raise.
    SHUTDOWN_SIGNAL.store(sig, Ordering::SeqCst);
    #[cfg(windows)]
    {
        // Windows reports one console event rather than distinct signals;
        // it always means the SIGINT-shaped shutdown.
        if sig == win::CTRL_SIGNAL {
            return 130;
        }
    }
    128 + sig
}

/// The fixture's `run_cli`. Behavior is selected by `argv[0]`:
///
/// | argv                  | behavior                                         |
/// |-----------------------|--------------------------------------------------|
/// | `exit <n>`            | return `n`                                        |
/// | `echo-argv`           | write argv as JSON to fd 1, return 0              |
/// | `write-fd1 <text>`    | write `text` to fd 1, return 0                    |
/// | `sleep <ms>`          | sleep, returning 130/143 if signalled mid-run     |
/// | `spawn-threads <n>`   | leave `n` long-lived threads running, return 0    |
///
/// An unknown or missing mode returns 64 (`EX_USAGE`).
pub fn run_cli(argv: Vec<String>) -> i32 {
    let _guard = SignalGuard::install();
    let mode = argv.first().map(String::as_str).unwrap_or("");
    match mode {
        "exit" => argv.get(1).and_then(|c| c.parse::<i32>().ok()).unwrap_or(0),
        "echo-argv" => {
            write_fd(1, encode_json_array(&argv[1..]).as_bytes());
            0
        }
        "write-fd1" => {
            write_fd(1, argv.get(1).map(String::as_str).unwrap_or("").as_bytes());
            0
        }
        "sleep" => {
            let ms = argv.get(1).and_then(|c| c.parse::<u64>().ok()).unwrap_or(0);
            // Announce readiness on fd 2 so the test harness knows the
            // handlers are installed before it sends a signal — without this
            // the race makes rows 2-3 flaky.
            write_fd(2, b"fixture: ready\n");
            sleep_until_signalled(Duration::from_millis(ms))
        }
        "spawn-threads" => {
            let n = argv.get(1).and_then(|c| c.parse::<u32>().ok()).unwrap_or(1);
            for _ in 0..n {
                // Deliberately never joined: row 8 asserts the process still
                // exits promptly once run_cli returns.
                std::thread::spawn(|| std::thread::sleep(Duration::from_secs(600)));
            }
            write_fd(2, b"fixture: threads spawned\n");
            0
        }
        _ => 64,
    }
}

/// Sleep for `total`, waking early with the shutdown code if a signal lands.
fn sleep_until_signalled(total: Duration) -> i32 {
    let deadline = Instant::now() + total;
    loop {
        let sig = SIGNALLED.swap(0, Ordering::SeqCst);
        if sig != 0 {
            return shutdown_code(sig);
        }
        if Instant::now() >= deadline {
            return 0;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Minimal JSON string-array encoder — enough for row 7's argv round trip
/// without taking a serde dependency into the fixture.
fn encode_json_array(items: &[String]) -> String {
    let mut out = String::from("[");
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('"');
        for ch in item.chars() {
            match ch {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                c if (c as u32) < 0x20 => {
                    out.push_str(&format!("\\u{:04x}", c as u32));
                }
                c => out.push(c),
            }
        }
        out.push('"');
    }
    out.push(']');
    out
}

/// These tests share the process-global signal state, so they must not run
/// concurrently — `.cargo/config.toml` pins `RUST_TEST_THREADS=1` for that
/// reason. Without it, one test's `SignalGuard::install()` can zero the flag
/// another just set by raising a signal.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_returns_the_requested_code() {
        assert_eq!(run_cli(vec!["exit".into(), "101".into()]), 101);
        assert_eq!(run_cli(vec!["exit".into()]), 0);
    }

    #[test]
    fn unknown_mode_is_ex_usage() {
        assert_eq!(run_cli(vec!["nope".into()]), 64);
        assert_eq!(run_cli(vec![]), 64);
    }

    #[test]
    fn sleep_returns_zero_when_never_signalled() {
        assert_eq!(run_cli(vec!["sleep".into(), "10".into()]), 0);
    }

    #[test]
    fn json_encoding_escapes_quotes_and_backslashes() {
        assert_eq!(
            encode_json_array(&["a\"b".into(), "c\\d".into()]),
            r#"["a\"b","c\\d"]"#
        );
    }

    #[test]
    fn json_encoding_preserves_utf8() {
        assert_eq!(encode_json_array(&["héllo".into()]), "[\"héllo\"]");
    }

    #[cfg(unix)]
    #[test]
    fn sleep_returns_the_shutdown_code_when_signalled() {
        // Raise SIGTERM at ourselves while our own handler is installed.
        let guard = SignalGuard::install();
        unsafe { libc::raise(libc::SIGTERM) };
        assert_eq!(sleep_until_signalled(Duration::from_millis(500)), 143);
        drop(guard);
    }
}
