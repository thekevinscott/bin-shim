"""Consumer-shaped launcher over the *real* native fixture, run as a
subprocess by the fixture-tier conformance suite.

Identical in shape to the package README's recommended entry point; only the
module name differs.
"""

import os
import sys

from bin_shim import main

if __name__ == "__main__":
    if "HOST_UNFLUSHED_BYTES" in os.environ:
        # Host-side output left in Python's buffered stdout before the native
        # call; main() must flush it so it lands ahead of the extension's
        # direct fd-1 writes (conformance row 6). The *size* comes in rather
        # than the payload: a 200KB env var would blow the exec limit.
        sys.stdout.write("h" * int(os.environ["HOST_UNFLUSHED_BYTES"]))
    sys.exit(main("bin_shim_fixture", argv=sys.argv[1:]))
