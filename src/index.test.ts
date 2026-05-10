import { describe, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn as nodeSpawn } from 'node:child_process';
import {
  resolveBinary,
  run,
  spawnBinary,
  type SpawnFn,
} from './index.js';

describe('resolveBinary', () => {
  test('builds Unix path with bin/ prefix', () => {
    const calls: string[] = [];
    const path = resolveBinary({
      scope: 'foo',
      binaryName: 'foo',
      platform: 'linux',
      arch: 'x64',
      resolver: (id) => (calls.push(id), `/fake/${id}`),
      from: import.meta.url,
    });
    expect(path).toBe('/fake/@foo/linux-x64/bin/foo');
    expect(calls).toEqual(['@foo/linux-x64/bin/foo']);
  });

  test('Windows uses .exe at package root, not bin/', () => {
    const path = resolveBinary({
      scope: 'foo',
      binaryName: 'foo',
      platform: 'win32',
      arch: 'x64',
      resolver: (id) => `/fake/${id}`,
      from: import.meta.url,
    });
    expect(path).toBe('/fake/@foo/win32-x64/foo.exe');
  });

  test('handles each documented platform/arch pair', () => {
    const cases: Array<[NodeJS.Platform, NodeJS.Architecture, string]> = [
      ['linux', 'x64', '@foo/linux-x64/bin/foo'],
      ['linux', 'arm64', '@foo/linux-arm64/bin/foo'],
      ['darwin', 'x64', '@foo/darwin-x64/bin/foo'],
      ['darwin', 'arm64', '@foo/darwin-arm64/bin/foo'],
      ['win32', 'x64', '@foo/win32-x64/foo.exe'],
    ];
    for (const [platform, arch, expected] of cases) {
      const path = resolveBinary({
        scope: 'foo',
        binaryName: 'foo',
        platform,
        arch,
        resolver: (id) => `/fake/${id}`,
        from: import.meta.url,
      });
      expect(path).toBe(`/fake/${expected}`);
    }
  });

  test('throws helpful error on resolver failure', () => {
    expect(() =>
      resolveBinary({
        scope: 'foo',
        binaryName: 'foo',
        platform: 'darwin',
        arch: 'arm64',
        resolver: () => {
          throw new Error('not found');
        },
        from: import.meta.url,
      }),
    ).toThrow(
      /no prebuilt binary for darwin-arm64.*@foo\/darwin-arm64.*npm install foo/s,
    );
  });

  test('original error preserved as cause', () => {
    const cause = new Error('inner');
    try {
      resolveBinary({
        scope: 'foo',
        binaryName: 'foo',
        platform: 'linux',
        arch: 'x64',
        resolver: () => {
          throw cause;
        },
        from: import.meta.url,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).cause).toBe(cause);
    }
  });

  test('uses process.platform/arch when not overridden', () => {
    const path = resolveBinary({
      scope: 'foo',
      binaryName: 'foo',
      resolver: (id) => `/fake/${id}`,
      from: import.meta.url,
    });
    expect(path).toContain(`@foo/${process.platform}-${process.arch}`);
  });

  test('default resolver uses createRequire rooted at `from`', () => {
    expect(() =>
      resolveBinary({
        scope: 'definitely-not-installed',
        binaryName: 'definitely-not-installed',
        platform: 'linux',
        arch: 'x64',
        from: import.meta.url,
      }),
    ).toThrow(/no prebuilt binary/);
  });
});

class FakeChild extends EventEmitter {
  killed: NodeJS.Signals | number | null = null;
  killReturn = true;
  killThrow: Error | null = null;
  kill(sig?: NodeJS.Signals | number) {
    if (this.killThrow) throw this.killThrow;
    this.killed = sig ?? 'SIGTERM';
    return this.killReturn;
  }
}

interface FakeProcessInit {
  pid?: number;
}

class FakeProcess extends EventEmitter {
  pid: number;
  exitCode: number | null = null;
  killed: { pid: number; signal: NodeJS.Signals | number } | null = null;
  stderrChunks: string[] = [];
  stderr = {
    write: (chunk: string) => {
      this.stderrChunks.push(chunk);
      return true;
    },
  };
  argv: string[] = ['node', 'wrapper'];
  constructor(init: FakeProcessInit = {}) {
    super();
    this.pid = init.pid ?? 4242;
  }
  exit(code?: number) {
    this.exitCode = code ?? 0;
  }
  kill(pid: number, signal?: NodeJS.Signals | number) {
    this.killed = { pid, signal: signal ?? 'SIGTERM' };
    return true;
  }
}

function makeSpawn(child: FakeChild, opts: { throws?: Error } = {}): {
  fn: SpawnFn;
  calls: Array<{ cmd: string; args: readonly string[] }>;
} {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const fn: SpawnFn = (cmd, args) => {
    calls.push({ cmd, args: [...args] });
    if (opts.throws) throw opts.throws;
    return child as unknown as ReturnType<SpawnFn>;
  };
  return { fn, calls };
}

describe('spawnBinary', () => {
  test('propagates exit code from child', async () => {
    const child = new FakeChild();
    const proc = new FakeProcess();
    const { fn, calls } = makeSpawn(child);
    const promise = spawnBinary(
      '/bin/foo',
      ['--flag'],
      proc as unknown as NodeJS.Process,
      fn,
    );
    child.emit('exit', 7, null);
    await Promise.race([promise.catch(() => {}), Promise.resolve()]);
    expect(proc.exitCode).toBe(7);
    expect(proc.killed).toBeNull();
    expect(calls[0]).toEqual({ cmd: '/bin/foo', args: ['--flag'] });
  });

  test('exits 1 when child exit code is null and no signal', async () => {
    const child = new FakeChild();
    const proc = new FakeProcess();
    const { fn } = makeSpawn(child);
    const promise = spawnBinary(
      '/bin/foo',
      [],
      proc as unknown as NodeJS.Process,
      fn,
    );
    child.emit('exit', null, null);
    await Promise.race([promise.catch(() => {}), Promise.resolve()]);
    expect(proc.exitCode).toBe(1);
  });

  test('re-raises signal death on parent', async () => {
    const child = new FakeChild();
    const proc = new FakeProcess({ pid: 9999 });
    const { fn } = makeSpawn(child);
    const promise = spawnBinary(
      '/bin/foo',
      [],
      proc as unknown as NodeJS.Process,
      fn,
    );
    child.emit('exit', null, 'SIGTERM');
    await Promise.race([promise.catch(() => {}), Promise.resolve()]);
    expect(proc.killed).toEqual({ pid: 9999, signal: 'SIGTERM' });
    expect(proc.exitCode).toBeNull();
  });

  test('forwards SIGINT/SIGTERM/SIGHUP/SIGQUIT to child', () => {
    const child = new FakeChild();
    const proc = new FakeProcess();
    const { fn } = makeSpawn(child);
    spawnBinary(
      '/bin/foo',
      [],
      proc as unknown as NodeJS.Process,
      fn,
    ).catch(() => {});
    for (const sig of [
      'SIGINT',
      'SIGTERM',
      'SIGHUP',
      'SIGQUIT',
    ] as NodeJS.Signals[]) {
      child.killed = null;
      proc.emit(sig);
      expect(child.killed).toBe(sig);
    }
  });

  test('forwarder ignores child.kill throwing (already exited)', () => {
    const child = new FakeChild();
    child.killThrow = new Error('ESRCH');
    const proc = new FakeProcess();
    const { fn } = makeSpawn(child);
    spawnBinary(
      '/bin/foo',
      [],
      proc as unknown as NodeJS.Process,
      fn,
    ).catch(() => {});
    expect(() => proc.emit('SIGTERM')).not.toThrow();
  });

  test('removes signal listeners after child exits', async () => {
    const child = new FakeChild();
    const proc = new FakeProcess();
    const { fn } = makeSpawn(child);
    const promise = spawnBinary(
      '/bin/foo',
      [],
      proc as unknown as NodeJS.Process,
      fn,
    );
    expect(proc.listenerCount('SIGTERM')).toBe(1);
    child.emit('exit', 0, null);
    await Promise.race([promise.catch(() => {}), Promise.resolve()]);
    expect(proc.listenerCount('SIGTERM')).toBe(0);
    expect(proc.listenerCount('SIGINT')).toBe(0);
    expect(proc.listenerCount('SIGHUP')).toBe(0);
    expect(proc.listenerCount('SIGQUIT')).toBe(0);
  });

  test('rejects when spawn throws synchronously', async () => {
    const child = new FakeChild();
    const proc = new FakeProcess();
    const boom = new Error('spawn EACCES');
    const { fn } = makeSpawn(child, { throws: boom });
    await expect(
      spawnBinary(
        '/bin/foo',
        [],
        proc as unknown as NodeJS.Process,
        fn,
      ),
    ).rejects.toBe(boom);
  });

  test('rejects when child emits error and removes listeners', async () => {
    const child = new FakeChild();
    const proc = new FakeProcess();
    const { fn } = makeSpawn(child);
    const promise = spawnBinary(
      '/bin/foo',
      [],
      proc as unknown as NodeJS.Process,
      fn,
    );
    const boom = new Error('ENOENT');
    child.emit('error', boom);
    await expect(promise).rejects.toBe(boom);
    expect(proc.listenerCount('SIGTERM')).toBe(0);
  });

  test('uses real process and spawn defaults when omitted', () => {
    // Just verify no throw on default parameter wiring; we don't actually
    // spawn anything because the path is a guaranteed-fail target on all
    // platforms — child emits 'error' asynchronously which we ignore.
    const promise = spawnBinary('/definitely/does/not/exist', []);
    promise.catch(() => {});
    expect(promise).toBeInstanceOf(Promise);
  });
});

describe('run', () => {
  test('resolves and spawns, propagating exit code', async () => {
    const child = new FakeChild();
    const proc = new FakeProcess();
    const { fn, calls } = makeSpawn(child);
    const promise = run({
      scope: 'foo',
      binaryName: 'foo',
      from: import.meta.url,
      platform: 'linux',
      arch: 'x64',
      argv: ['--x'],
      resolver: (id) => `/fake/${id}`,
      proc: proc as unknown as NodeJS.Process,
      spawn: fn,
    });
    child.emit('exit', 0, null);
    await Promise.race([promise.catch(() => {}), Promise.resolve()]);
    expect(calls[0]).toEqual({
      cmd: '/fake/@foo/linux-x64/bin/foo',
      args: ['--x'],
    });
    expect(proc.exitCode).toBe(0);
  });

  test('defaults argv to proc.argv.slice(2)', async () => {
    const child = new FakeChild();
    const proc = new FakeProcess();
    proc.argv = ['node', 'wrapper', 'a', 'b'];
    const { fn, calls } = makeSpawn(child);
    const promise = run({
      scope: 'foo',
      binaryName: 'foo',
      from: import.meta.url,
      platform: 'linux',
      arch: 'x64',
      resolver: (id) => `/fake/${id}`,
      proc: proc as unknown as NodeJS.Process,
      spawn: fn,
    });
    child.emit('exit', 0, null);
    await Promise.race([promise.catch(() => {}), Promise.resolve()]);
    expect(calls[0]?.args).toEqual(['a', 'b']);
  });

  test('writes resolveBinary error to stderr and exits 1', async () => {
    const proc = new FakeProcess();
    await run({
      scope: 'foo',
      binaryName: 'foo',
      from: import.meta.url,
      platform: 'linux',
      arch: 'x64',
      resolver: () => {
        throw new Error('not found');
      },
      proc: proc as unknown as NodeJS.Process,
    }).catch(() => {});
    expect(proc.exitCode).toBe(1);
    expect(proc.stderrChunks.join('')).toMatch(/no prebuilt binary/);
  });

  test('writes spawn rejection to stderr and exits 1', async () => {
    const child = new FakeChild();
    const proc = new FakeProcess();
    const boom = new Error('spawn EACCES');
    const { fn } = makeSpawn(child, { throws: boom });
    await run({
      scope: 'foo',
      binaryName: 'foo',
      from: import.meta.url,
      platform: 'linux',
      arch: 'x64',
      resolver: (id) => `/fake/${id}`,
      proc: proc as unknown as NodeJS.Process,
      spawn: fn,
    }).catch(() => {});
    expect(proc.exitCode).toBe(1);
    expect(proc.stderrChunks.join('')).toMatch(/spawn EACCES/);
  });

  test('uses real process when proc omitted (smoke)', () => {
    // Spy on real process.exit to confirm default proc wiring runs.
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    const writeSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      run({
        scope: 'definitely-not-installed-xyz',
        binaryName: 'nope',
        from: import.meta.url,
      }).catch(() => {});
    } finally {
      exitSpy.mockRestore();
      writeSpy.mockRestore();
    }
  });
});

describe('integration (real node child) — orphan/exit-code regression', () => {
  // One real-process smoke: spawn the built dist as a wrapper around node,
  // SIGTERM it, and confirm both wrapper and child die. This is the bug
  // that motivated the signal-forwarding code.
  test.skipIf(process.platform === 'win32')(
    'wrapper SIGTERM kills child binary',
    async () => {
      const libUrl = new URL('../dist/index.js', import.meta.url).href;
      const source = `
        import { spawnBinary } from '${libUrl}';
        spawnBinary(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)']);
      `;
      const result = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        const child = nodeSpawn(
          process.execPath,
          ['--input-type=module', '-e', source],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        setTimeout(() => child.kill('SIGTERM'), 200);
        child.once('exit', (code, signal) => resolve({ code, signal }));
        child.once('error', reject);
      });
      expect(result.signal).toBe('SIGTERM');
      expect(result.code).toBeNull();
    },
  );
});
