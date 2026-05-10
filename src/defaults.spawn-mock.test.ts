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
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', async (importActual) => {
  const actual =
    await importActual<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

import { spawn } from 'node:child_process';
import { defaultSpawner } from './defaults.js';

describe('defaultSpawner (mocked spawn)', () => {
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
});
