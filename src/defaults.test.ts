import { describe, it, expect } from 'vitest';
import { chmodSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultResolver, defaultSpawner } from './defaults.js';

describe('defaultResolver', () => {
  it('returns a function that resolves Node built-ins', () => {
    const r = defaultResolver(import.meta.url);
    expect(typeof r('node:fs')).toBe('string');
  });
});

describe('defaultSpawner', () => {
  it('runs a real command and resolves with its exit code', async () => {
    const code = await defaultSpawner(process.execPath, [
      '-e',
      'process.exit(0)',
    ]);
    expect(code).toBe(0);
  });

  it('rejects when the command does not exist', async () => {
    await expect(defaultSpawner('/nonexistent/binary', [])).rejects.toThrow();
  });

  it('resolves with 1 when child is terminated by a signal', async () => {
    const code = await defaultSpawner(process.execPath, [
      '-e',
      'process.kill(process.pid, "SIGTERM")',
    ]);
    expect(code).toBe(1);
  });

  it('chmods a non-executable target before spawning', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bin-shim-chmod-'));
    const bin = join(dir, 'script.js');
    writeFileSync(bin, '#!/usr/bin/env node\nprocess.exit(0)\n');
    chmodSync(bin, 0o644);
    const code = await defaultSpawner(bin, []);
    expect(code).toBe(0);
    expect(statSync(bin).mode & 0o111).not.toBe(0);
  });

  it('leaves mode untouched when already executable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bin-shim-chmod-'));
    const bin = join(dir, 'script.js');
    writeFileSync(bin, '#!/usr/bin/env node\nprocess.exit(0)\n');
    chmodSync(bin, 0o755);
    const before = statSync(bin).mode;
    await defaultSpawner(bin, []);
    expect(statSync(bin).mode).toBe(before);
  });

  it('swallows stat errors for missing targets (spawn surfaces the real error)', async () => {
    await expect(defaultSpawner('/nonexistent/binary', [])).rejects.toThrow();
  });
});
