/**
 * Mocked-spawn unit tests for `defaultSpawner`. Exists separately from
 * `defaults.test.ts` because vi.mock of `node:child_process` is per-file
 * scope and would clobber the real-spawn integration tests there.
 *
 * Why this file exists at all: the `code ?? 1` nullish-coalescing branch
 * in `defaults.ts` only fires when `child` emits `exit` with `code ===
 * null` (i.e. signal death). On Linux/macOS the sibling test "resolves
 * with 1 when child is terminated by a signal" hits that branch via
 * SIGTERM. On Windows, Node's signal emulation delivers a non-null exit
 * code, so the null-branch never lights up and branch coverage drops
 * below 100%. Driving the event directly via a mocked spawn lets every
 * platform exercise both branches deterministically.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', async (importActual) => {
  const actual =
    await importActual<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return { ...actual, statSync: vi.fn(), chmodSync: vi.fn() };
});

import { spawn } from 'node:child_process';
import { chmodSync, statSync } from 'node:fs';
import { defaultSpawner } from './defaults.js';

describe('defaultSpawner (mocked spawn)', () => {
  beforeEach(() => {
    vi.mocked(statSync).mockReset();
    vi.mocked(chmodSync).mockReset();
    vi.mocked(spawn).mockReset();
    vi.mocked(statSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
  });

  it('resolves with 1 when exit code is null (signal-death proxy)', async () => {
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValue(child as never);
    const promise = defaultSpawner('whatever', []);
    child.emit('exit', null);
    expect(await promise).toBe(1);
  });

  it('resolves with the numeric exit code on clean exit', async () => {
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValue(child as never);
    const promise = defaultSpawner('whatever', []);
    child.emit('exit', 0);
    expect(await promise).toBe(0);
  });

  it('rejects when the child emits error', async () => {
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValue(child as never);
    const promise = defaultSpawner('whatever', []);
    const boom = new Error('boom');
    child.emit('error', boom);
    await expect(promise).rejects.toBe(boom);
  });

  // Cross-platform coverage for ensureExecutable. The real-spawn POSIX
  // tests in defaults.test.ts exercise these too, but Windows skips
  // them, so we drive the branches here via mocked fs.
  it('chmods to 0755 when no exec bit is set', async () => {
    vi.mocked(statSync).mockReturnValue({ mode: 0o644 } as never);
    vi.mocked(chmodSync).mockReturnValue();
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValue(child as never);
    const promise = defaultSpawner('/some/bin', []);
    child.emit('exit', 0);
    await promise;
    expect(chmodSync).toHaveBeenCalledWith('/some/bin', 0o644 | 0o755);
  });

  it('skips chmod when an exec bit is already set', async () => {
    vi.mocked(statSync).mockReturnValue({ mode: 0o755 } as never);
    vi.mocked(chmodSync).mockReturnValue();
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValue(child as never);
    const promise = defaultSpawner('/some/bin', []);
    child.emit('exit', 0);
    await promise;
    expect(chmodSync).not.toHaveBeenCalled();
  });

  it('swallows stat errors and continues to spawn', async () => {
    vi.mocked(statSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValue(child as never);
    const promise = defaultSpawner('/missing', []);
    child.emit('exit', 0);
    expect(await promise).toBe(0);
    expect(chmodSync).not.toHaveBeenCalled();
  });
});
