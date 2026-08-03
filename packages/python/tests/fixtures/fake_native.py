"""Pure-Python stand-in for a native bindings module (the conformance
suite's fake tier — see spec/conformance.md).

Behaves like a pyo3 module implementing the run_cli contract: it always
returns an int and writes only to file descriptors 1/2 (via ``os.write``,
never host stdio objects). Behavior is selected with FAKE_NATIVE_MODE:

- ``exit`` (default): return int(FAKE_NATIVE_CODE, default 0). Returning 130
  or 143 simulates the core having completed its own graceful shutdown after
  SIGINT/SIGTERM, which is how the contract reports mid-run signals.
- ``echo-argv``: write the received argv to fd 1 as JSON, return 0.
- ``raise-keyboard-interrupt``: raise KeyboardInterrupt, simulating an
  interrupt escaping around the native call (conformance row 5).
- ``write-fd1``: write ``native`` to fd 1, return 0 (conformance row 6).
"""

import json
import os


def run_cli(argv: list[str]) -> int:
    mode = os.environ.get("FAKE_NATIVE_MODE", "exit")
    if mode == "exit":
        return int(os.environ.get("FAKE_NATIVE_CODE", "0"))
    if mode == "echo-argv":
        os.write(1, json.dumps(argv).encode("utf-8"))
        return 0
    if mode == "raise-keyboard-interrupt":
        raise KeyboardInterrupt
    if mode == "write-fd1":
        os.write(1, b"native")
        return 0
    raise AssertionError(f"unknown FAKE_NATIVE_MODE: {mode}")
