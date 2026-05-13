import { spawn } from 'node:child_process';
import { chmodSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Resolver, Spawner } from './types.js';

export const defaultResolver = (from: string | URL): Resolver =>
  createRequire(from).resolve;

// Workaround: actions/upload-artifact@v4 strips per-file exec bits, so
// bundled binaries can arrive 0644 even when packed correctly upstream.
function ensureExecutable(cmd: string): void {
  try {
    const mode = statSync(cmd).mode;
    if ((mode & 0o111) === 0) chmodSync(cmd, mode | 0o755);
  } catch {
    /* spawn surfaces a clearer error */
  }
}

export const defaultSpawner: Spawner = (cmd, args) =>
  new Promise((resolve, reject) => {
    ensureExecutable(cmd);
    const child = spawn(cmd, [...args], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
