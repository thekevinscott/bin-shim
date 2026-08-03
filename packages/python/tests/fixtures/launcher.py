"""Consumer-shaped launcher over the fake native module, run as a subprocess
by the conformance suite. This is exactly the entry point a real consumer
writes (see the package README): ``sys.exit(main(...))``.
"""

import os
import sys

from bin_shim import main

if __name__ == "__main__":
    if "HOST_UNFLUSHED_WRITE" in os.environ:
        # Host-side output left in Python's buffered stdout before the native
        # call; main() must flush it so it lands ahead of native fd-1 writes
        # (conformance row 6).
        sys.stdout.write(os.environ["HOST_UNFLUSHED_WRITE"])
    sys.exit(main("fake_native", argv=sys.argv[1:]))
