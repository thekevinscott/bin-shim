/**
 * Integration tests — spawn a real `node` subprocess as the wrapper and
 * inspect its observed exit status and stderr. These complement the
 * in-process unit tests in index.test.ts; the in-process tests are what
 * drive the 100% coverage target. The integration tests are what catch
 * the orphan-on-SIGTERM bug and any regressions in real-process semantics.
 *
 * Each test runs the *built* dist/index.js (pretest hook builds it).
 */
import { describe, expect, test } from 'vitest';
import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIB = new URL('../dist/index.js', import.meta.url).href;

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface RunOpts {
  signalAfterMs?: number;
  signal?: NodeJS.Signals;
  env?: Record<string, string>;
}

function runWrapper(source: string, opts: RunOpts = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(
      process.execPath,
      ['--input-type=module', '-e', source],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(opts.env ?? {}) },
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d) => (stdout += d.toString()));
    child.stderr!.on('data', (d) => (stderr += d.toString()));
    if (opts.signalAfterMs && opts.signal) {
      setTimeout(() => child.kill(opts.signal), opts.signalAfterMs);
    }
    child.once('exit', (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
    child.once('error', reject);
  });
}

/**
 * Build a fake consumer layout in a temp dir:
 *   <root>/
 *     bin/foo.js
 *     node_modules/@scope/<platform>-<arch>/(bin/foo|foo.exe)
 *     node_modules/@scope/<platform>-<arch>/package.json
 *
 * The wrapper script imports the built bin-shim from its real path and
 * uses `from: pathToFileURL('<root>/bin/foo.js')` so resolution is rooted
 * at the consumer just like in production.
 */
function makeFakeConsumer(opts: {
  scope: string;
  binaryName: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  binaryContent: string;
  executable?: boolean;
}) {
  const root = mkdtempSync(join(tmpdir(), 'bin-shim-it-'));
  mkdirSync(join(root, 'bin'), { recursive: true });
  const pkgDir = join(
    root,
    'node_modules',
    `@${opts.scope}`,
    `${opts.platform}-${opts.arch}`,
  );
  const isWin = opts.platform === 'win32';
  const binaryPath = isWin
    ? join(pkgDir, `${opts.binaryName}.exe`)
    : join(pkgDir, 'bin', opts.binaryName);
  mkdirSync(isWin ? pkgDir : join(pkgDir, 'bin'), { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: `@${opts.scope}/${opts.platform}-${opts.arch}`,
      version: '0.0.1',
      os: [opts.platform],
      cpu: [opts.arch],
    }),
  );
  writeFileSync(binaryPath, opts.binaryContent);
  if (opts.executable !== false) chmodSync(binaryPath, 0o755);
  // bin/foo.js — actual entry script we'll spawn
  const shim = join(root, 'bin', 'foo.js');
  writeFileSync(
    shim,
    `#!/usr/bin/env node\nimport { run } from '${LIB}';\nrun({ scope: '${opts.scope}', binaryName: '${opts.binaryName}', from: import.meta.url });\n`,
  );
  return { root, shim, binaryPath };
}

describe('integration: end-to-end via real consumer layout', () => {
  test.skipIf(process.platform === 'win32')(
    'wrapper resolves binary, propagates exit 0',
    async () => {
      const { shim } = makeFakeConsumer({
        scope: 'bsi',
        binaryName: 'foo',
        platform: process.platform,
        arch: process.arch,
        binaryContent: `#!/usr/bin/env node\nprocess.exit(0);\n`,
      });
      const result = await runWrapper(`await import('${shim}');`);
      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
    },
  );

  test.skipIf(process.platform === 'win32')(
    'wrapper propagates non-zero exit code',
    async () => {
      const { shim } = makeFakeConsumer({
        scope: 'bsi',
        binaryName: 'foo',
        platform: process.platform,
        arch: process.arch,
        binaryContent: `#!/usr/bin/env node\nprocess.exit(42);\n`,
      });
      const result = await runWrapper(`await import('${shim}');`);
      expect(result.code).toBe(42);
    },
  );

  test.skipIf(process.platform === 'win32')(
    'wrapper passes argv through to binary',
    async () => {
      const { shim } = makeFakeConsumer({
        scope: 'bsi',
        binaryName: 'foo',
        platform: process.platform,
        arch: process.arch,
        binaryContent: `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\nprocess.exit(0);\n`,
      });
      // Drive argv via the wrapper's process.argv: spawn with extra argv.
      const result = await new Promise<RunResult>((resolve, reject) => {
        const child = nodeSpawn(
          process.execPath,
          [shim, 'one', 'two', '--three=4'],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        child.stdout!.on('data', (d) => (stdout += d.toString()));
        child.stderr!.on('data', (d) => (stderr += d.toString()));
        child.once('exit', (code, signal) =>
          resolve({ code, signal, stdout, stderr }),
        );
        child.once('error', reject);
      });
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([
        'one',
        'two',
        '--three=4',
      ]);
    },
  );

  test('wrapper writes helpful error and exits 1 when platform pkg missing', async () => {
    const result = await runWrapper(`
      import { run } from '${LIB}';
      run({
        scope: 'definitely-not-installed-xyz',
        binaryName: 'definitely-not-installed-xyz',
        from: import.meta.url,
      });
    `);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      /no prebuilt binary.*expected optional dependency.*npm install/s,
    );
  });
});

describe('integration: spawnBinary semantics with real children', () => {
  test('propagates exit code from real child', async () => {
    const result = await runWrapper(`
      import { spawnBinary } from '${LIB}';
      spawnBinary(process.execPath, ['-e', 'process.exit(7)']);
    `);
    expect(result.code).toBe(7);
    expect(result.signal).toBeNull();
  });

  test.skipIf(process.platform === 'win32')(
    'propagates signal death (SIGTERM) from real child',
    async () => {
      const result = await runWrapper(`
        import { spawnBinary } from '${LIB}';
        spawnBinary(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")']);
      `);
      expect(result.signal).toBe('SIGTERM');
      expect(result.code).toBeNull();
    },
  );

  test.skipIf(process.platform === 'win32')(
    'forwards SIGTERM from wrapper to child (no orphan)',
    async () => {
      const result = await runWrapper(
        `
        import { spawnBinary } from '${LIB}';
        spawnBinary(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)']);
      `,
        { signalAfterMs: 200, signal: 'SIGTERM' },
      );
      expect(result.signal).toBe('SIGTERM');
      expect(result.code).toBeNull();
    },
  );

  test.skipIf(process.platform === 'win32')(
    'forwards SIGINT from wrapper to child',
    async () => {
      const result = await runWrapper(
        `
        import { spawnBinary } from '${LIB}';
        spawnBinary(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)']);
      `,
        { signalAfterMs: 200, signal: 'SIGINT' },
      );
      expect(result.signal).toBe('SIGINT');
      expect(result.code).toBeNull();
    },
  );

  test('rejects asynchronously when binary path does not exist', async () => {
    const result = await runWrapper(`
      import { spawnBinary } from '${LIB}';
      spawnBinary('/definitely/does/not/exist/bin', []).catch((e) => {
        process.stderr.write(e.message + '\\n');
        process.exit(2);
      });
    `);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/ENOENT|spawn/);
  });
});

describe('integration: resolveBinary against real node_modules layout', () => {
  test.skipIf(process.platform === 'win32')(
    'resolves Unix layout to real file path',
    async () => {
      const { root } = makeFakeConsumer({
        scope: 'bsi',
        binaryName: 'foo',
        platform: process.platform,
        arch: process.arch,
        binaryContent: '#!/usr/bin/env node\n',
      });
      const consumerEntry = join(root, 'bin', 'foo.js');
      const result = await runWrapper(`
        import { resolveBinary } from '${LIB}';
        import { pathToFileURL } from 'node:url';
        const p = resolveBinary({
          scope: 'bsi',
          binaryName: 'foo',
          from: pathToFileURL(${JSON.stringify(consumerEntry)}).href,
        });
        process.stdout.write(p);
      `);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        `node_modules/@bsi/${process.platform}-${process.arch}/bin/foo`,
      );
    },
  );

  test('throws with helpful message when no platform pkg in node_modules', async () => {
    const result = await runWrapper(`
      import { resolveBinary } from '${LIB}';
      try {
        resolveBinary({
          scope: 'definitely-not-installed-xyz',
          binaryName: 'definitely-not-installed-xyz',
          from: import.meta.url,
        });
        process.exit(0);
      } catch (e) {
        process.stderr.write(e.message);
        if (e.cause) process.stderr.write('\\nCAUSE:' + e.cause.message);
        process.exit(3);
      }
    `);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/no prebuilt binary/);
    expect(result.stderr).toContain('CAUSE:');
  });
});
