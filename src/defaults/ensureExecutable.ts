import { chmodSync, statSync } from 'node:fs';

// Workaround: actions/upload-artifact@v4 strips per-file exec bits, so
// bundled binaries can arrive 0644 even when packed correctly upstream.
export function ensureExecutable(cmd: string): void {
  try {
    const mode = statSync(cmd).mode;
    if ((mode & 0o111) === 0) chmodSync(cmd, mode | 0o755);
  } catch {
    /* spawn surfaces a clearer error */
  }
}
