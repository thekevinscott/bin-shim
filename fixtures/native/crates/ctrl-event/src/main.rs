//! Test harness for delivering **real** console control events on Windows,
//! used by the fixture-tier conformance suites for rows 4-5.
//!
//! Why this exists at all: neither Node's `child_process.spawn` nor a plain
//! `GenerateConsoleCtrlEvent` call from the test runner can do this safely.
//!
//! - `GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)` hits *every* process sharing
//!   the caller's console — including the test runner, which would take the
//!   whole suite down with it.
//! - Windows only lets you target a specific process **group**, and only a
//!   process created with `CREATE_NEW_PROCESS_GROUP` is in one. Node exposes
//!   no way to set that flag (`detached` maps to `DETACHED_PROCESS`, which
//!   gives the child *no* console at all, so there is then nothing to send a
//!   console event to).
//!
//! So this helper owns both halves:
//!
//! ```text
//! ctrl-event spawn <program> [args...]   # new console + new process group,
//!                                        # prints "PID=<pid>", waits, exits
//!                                        # with the child's exit code
//! ctrl-event send <pid> <c|break>        # attach to that console, raise the
//!                                        # event, leaving the runner alone
//! ```
//!
//! The target lands on its own console, so `send` can raise the event for
//! everything on that console without touching anything else. Standard
//! handles are inherited, so the runner still captures the child's output.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("spawn") => imp::spawn(&args[1..]),
        Some("send") => imp::send(&args[1..]),
        _ => {
            eprintln!("usage: ctrl-event spawn <program> [args...]");
            eprintln!("       ctrl-event send <pid> <c|break>");
            std::process::exit(64);
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn spawn(_args: &[String]) -> ! {
        unsupported()
    }

    pub fn send(_args: &[String]) -> ! {
        unsupported()
    }

    fn unsupported() -> ! {
        // POSIX has kill(2); the suites use it directly there. Exiting
        // loudly keeps a mis-wired test from looking like a pass.
        eprintln!("ctrl-event: Windows-only helper (POSIX suites use kill)");
        std::process::exit(64);
    }
}

#[cfg(windows)]
mod imp {
    use std::os::windows::ffi::OsStrExt;

    type Bool = i32;
    type Dword = u32;
    type Handle = *mut core::ffi::c_void;

    const CTRL_C_EVENT: Dword = 0;
    const CTRL_BREAK_EVENT: Dword = 1;
    const CREATE_NEW_CONSOLE: Dword = 0x0000_0010;
    const CREATE_NEW_PROCESS_GROUP: Dword = 0x0000_0200;
    const INFINITE: Dword = 0xFFFF_FFFF;
    const STARTF_USESTDHANDLES: Dword = 0x0000_0100;
    const STD_INPUT_HANDLE: Dword = -10i32 as Dword;
    const STD_OUTPUT_HANDLE: Dword = -11i32 as Dword;
    const STD_ERROR_HANDLE: Dword = -12i32 as Dword;

    #[repr(C)]
    struct StartupInfoW {
        cb: Dword,
        reserved: *mut u16,
        desktop: *mut u16,
        title: *mut u16,
        x: Dword,
        y: Dword,
        x_size: Dword,
        y_size: Dword,
        x_count_chars: Dword,
        y_count_chars: Dword,
        fill_attribute: Dword,
        flags: Dword,
        show_window: u16,
        cb_reserved2: u16,
        reserved2: *mut u8,
        std_input: Handle,
        std_output: Handle,
        std_error: Handle,
    }

    #[repr(C)]
    struct ProcessInformation {
        process: Handle,
        thread: Handle,
        process_id: Dword,
        thread_id: Dword,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateProcessW(
            application_name: *const u16,
            command_line: *mut u16,
            process_attributes: *mut core::ffi::c_void,
            thread_attributes: *mut core::ffi::c_void,
            inherit_handles: Bool,
            creation_flags: Dword,
            environment: *mut core::ffi::c_void,
            current_directory: *const u16,
            startup_info: *mut StartupInfoW,
            process_information: *mut ProcessInformation,
        ) -> Bool;
        fn WaitForSingleObject(handle: Handle, milliseconds: Dword) -> Dword;
        fn GetExitCodeProcess(process: Handle, exit_code: *mut Dword) -> Bool;
        fn GetStdHandle(std_handle: Dword) -> Handle;
        fn FreeConsole() -> Bool;
        fn AttachConsole(process_id: Dword) -> Bool;
        fn SetConsoleCtrlHandler(handler: *mut core::ffi::c_void, add: Bool) -> Bool;
        fn GenerateConsoleCtrlEvent(ctrl_event: Dword, process_group_id: Dword) -> Bool;
        fn GetLastError() -> Dword;
    }

    fn wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// Quote one argv element per the CommandLineToArgvW rules, so the child
    /// receives argv byte-faithfully (conformance row 7 depends on it).
    fn quote(arg: &str) -> String {
        if !arg.is_empty() && !arg.contains([' ', '\t', '"']) {
            return arg.to_string();
        }
        let mut out = String::from("\"");
        let mut backslashes = 0;
        for ch in arg.chars() {
            match ch {
                '\\' => {
                    backslashes += 1;
                    out.push('\\');
                }
                '"' => {
                    // Escape the run of backslashes, then the quote itself.
                    for _ in 0..=backslashes {
                        out.push('\\');
                    }
                    out.push('"');
                    backslashes = 0;
                }
                c => {
                    backslashes = 0;
                    out.push(c);
                }
            }
        }
        for _ in 0..backslashes {
            out.push('\\');
        }
        out.push('"');
        out
    }

    pub fn spawn(args: &[String]) -> ! {
        if args.is_empty() {
            eprintln!("ctrl-event spawn: no program given");
            std::process::exit(64);
        }
        let command_line = args
            .iter()
            .map(|a| quote(a))
            .collect::<Vec<_>>()
            .join(" ");
        let mut command_line = wide(&command_line);

        // SAFETY: all pointers below outlive the CreateProcessW call.
        unsafe {
            let mut startup: StartupInfoW = std::mem::zeroed();
            startup.cb = std::mem::size_of::<StartupInfoW>() as Dword;
            // Hand our own std handles to the child even though it gets a
            // fresh console, so the test runner still captures its output.
            startup.flags = STARTF_USESTDHANDLES;
            startup.std_input = GetStdHandle(STD_INPUT_HANDLE);
            startup.std_output = GetStdHandle(STD_OUTPUT_HANDLE);
            startup.std_error = GetStdHandle(STD_ERROR_HANDLE);

            let mut info: ProcessInformation = std::mem::zeroed();
            let ok = CreateProcessW(
                std::ptr::null(),
                command_line.as_mut_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                1, // inherit handles, so the std handles above are usable
                CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP,
                std::ptr::null_mut(),
                std::ptr::null(),
                &mut startup,
                &mut info,
            );
            if ok == 0 {
                eprintln!("ctrl-event spawn: CreateProcessW failed ({})", GetLastError());
                std::process::exit(70);
            }
            // The suites parse this to learn who to signal.
            println!("PID={}", info.process_id);
            use std::io::Write;
            let _ = std::io::stdout().flush();

            WaitForSingleObject(info.process, INFINITE);
            let mut code: Dword = 0;
            if GetExitCodeProcess(info.process, &mut code) == 0 {
                eprintln!("ctrl-event spawn: GetExitCodeProcess failed ({})", GetLastError());
                std::process::exit(70);
            }
            // Surface the child's exit code as our own, so the suites can
            // assert on it exactly as they would for a direct spawn.
            std::process::exit(code as i32);
        }
    }

    pub fn send(args: &[String]) -> ! {
        let pid: Dword = match args.first().and_then(|p| p.parse().ok()) {
            Some(pid) => pid,
            None => {
                eprintln!("ctrl-event send: bad or missing pid");
                std::process::exit(64);
            }
        };
        let event = match args.get(1).map(String::as_str) {
            Some("c") | None => CTRL_C_EVENT,
            Some("break") => CTRL_BREAK_EVENT,
            Some(other) => {
                eprintln!("ctrl-event send: unknown event '{other}' (want c|break)");
                std::process::exit(64);
            }
        };

        // SAFETY: plain console API calls with no borrowed state.
        unsafe {
            // Leave whatever console we inherited and join the target's, so
            // the event below reaches it and nothing else.
            FreeConsole();
            if AttachConsole(pid) == 0 {
                eprintln!(
                    "ctrl-event send: AttachConsole({pid}) failed ({}); \
                     the target may have exited or have no console",
                    GetLastError()
                );
                std::process::exit(71);
            }
            // Ignore the event ourselves so we survive to report the result.
            SetConsoleCtrlHandler(std::ptr::null_mut(), 1);
            // Group 0 == every process on the console we just attached to,
            // which after CREATE_NEW_CONSOLE is only the target.
            if GenerateConsoleCtrlEvent(event, 0) == 0 {
                eprintln!(
                    "ctrl-event send: GenerateConsoleCtrlEvent failed ({})",
                    GetLastError()
                );
                std::process::exit(72);
            }
            std::process::exit(0);
        }
    }
}
