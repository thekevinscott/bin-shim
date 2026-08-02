import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', async (importActual) => {
  const actual = await importActual<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

vi.mock('./ensureExecutable.js', () => ({
  ensureExecutable: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { ensureExecutable } from './ensureExecutable.js';
import { defaultSpawner } from './spawner.js';

describe('defaultSpawner', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
    vi.mocked(ensureExecutable).mockReset();
  });

  it('calls ensureExecutable on the target before spawning', async () => {
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValue(child as never);
    const promise = defaultSpawner('/bin/foo', ['a']);
    expect(ensureExecutable).toHaveBeenCalledWith('/bin/foo');
    child.emit('exit', 0);
    await promise;
  });

  it('forwards args spread and inherits stdio', async () => {
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValue(child as never);
    const promise = defaultSpawner('/bin/foo', ['--flag', 'value']);
    child.emit('exit', 0);
    await promise;
    expect(spawn).toHaveBeenCalledWith('/bin/foo', ['--flag', 'value'], {
      stdio: 'inherit',
    });
  });

  it('resolves with the numeric exit code on clean exit', async () => {
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValue(child as never);
    const promise = defaultSpawner('/bin/foo', []);
    child.emit('exit', 0);
    expect(await promise).toBe(0);
  });

  it('resolves with 1 when exit code is null (signal-death proxy)', async () => {
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValue(child as never);
    const promise = defaultSpawner('/bin/foo', []);
    child.emit('exit', null);
    expect(await promise).toBe(1);
  });

  it('rejects when the child emits error', async () => {
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValue(child as never);
    const promise = defaultSpawner('/bin/foo', []);
    const boom = new Error('boom');
    child.emit('error', boom);
    await expect(promise).rejects.toBe(boom);
  });
});
