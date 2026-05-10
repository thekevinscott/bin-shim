/**
 * Integration tests — spawn a real `node` subprocess as the wrapper and
 * inspect its observed exit status and stderr. These complement the
 * in-process unit tests; coverage is driven by the unit tests, while
 * these verify real-process semantics end to end.
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
  argv?: readonly string[];
  signalAfterMs?: number;
  signal?: NodeJS.Signals;
}

function runNodeScript(source: string, opts: RunOpts = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(
      process.execPath,
      ['--input-type=module', '-e', source, ...(opts.argv ?? [])],
      { stdio: ['ignore', 'pipe', 'pipe'] },
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

function runNodeFile(file: string, argv: string[] = []): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(process.execPath, [file, ...argv], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d) => (stdout += d.toString()));
    child.stderr!.on('data', (d) => (stderr += d.toString()));
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
 *     node_modules/@scope/<platform>-<arch>/bin/(foo|foo.exe)
 *     node_modules/@scope/<platform>-<arch>/package.json
 */
function makeFakeConsumer(opts: {
  scope: string;
  binaryName: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  binaryContent: string;
}) {
  const root = mkdtempSync(join(tmpdir(), 'bin-shim-it-'));
  mkdirSync(join(root, 'bin'), { recursive: true });
  const pkgDir = join(
    root,
    'node_modules',
    `@${opts.scope}`,
    `${opts.platform}-${opts.arch}`,
  );
  mkdirSync(join(pkgDir, 'bin'), { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: `@${opts.scope}/${opts.platform}-${opts.arch}`,
      version: '0.0.1',
      os: [opts.platform],
      cpu: [opts.arch],
    }),
  );
  const ext = opts.platform === 'win32' ? '.exe' : '';
  const binaryPath = join(pkgDir, 'bin', `${opts.binaryName}${ext}`);
  writeFileSync(binaryPath, opts.binaryContent);
  chmodSync(binaryPath, 0o755);
  const shim = join(root, 'bin', 'foo.js');
  writeFileSync(
    shim,
    `#!/usr/bin/env node
import { main } from '${LIB}';
main({ scope: '${opts.scope}', binaryName: '${opts.binaryName}', from: import.meta.url })
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(\`\${err.message}\\n\`);
    process.exit(1);
  });
`,
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
      const result = await runNodeFile(shim);
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
      const result = await runNodeFile(shim);
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
      const result = await runNodeFile(shim, ['one', 'two', '--three=4']);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([
        'one',
        'two',
        '--three=4',
      ]);
    },
  );

  test('wrapper writes helpful error and exits 1 when platform pkg missing', async () => {
    const result = await runNodeScript(`
      import { main } from '${LIB}';
      main({
        scope: 'definitely-not-installed-xyz',
        binaryName: 'definitely-not-installed-xyz',
        from: import.meta.url,
      })
        .then((code) => process.exit(code))
        .catch((err) => {
          process.stderr.write(err.message + '\\n');
          process.exit(1);
        });
    `);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      /no prebuilt binary.*expected optional dependency.*npm install/s,
    );
  });
});

describe('integration: spawner semantics with real children', () => {
  test('propagates exit code from real child', async () => {
    const result = await runNodeScript(`
      import { defaultSpawner } from '${LIB}';
      const code = await defaultSpawner(process.execPath, ['-e', 'process.exit(7)']);
      process.exit(code);
    `);
    expect(result.code).toBe(7);
    expect(result.signal).toBeNull();
  });

  test.skipIf(process.platform === 'win32')(
    'returns 1 when child dies from signal',
    async () => {
      const result = await runNodeScript(`
        import { defaultSpawner } from '${LIB}';
        const code = await defaultSpawner(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")']);
        process.exit(code);
      `);
      expect(result.code).toBe(1);
    },
  );

  test('rejects when binary path does not exist', async () => {
    const result = await runNodeScript(`
      import { defaultSpawner } from '${LIB}';
      defaultSpawner('/definitely/does/not/exist/bin', []).catch((e) => {
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
      const result = await runNodeScript(`
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
    const result = await runNodeScript(`
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
