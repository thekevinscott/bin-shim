/**
 * Integration tier of the process-semantics conformance spec
 * (spec/conformance.md at the repo root), fake-tier addon.
 *
 * Each describe block names the spec row it executes. Every test spawns a
 * real `node` subprocess running the *built* dist (the pretest hook builds
 * it), so exit codes and signal death are observed exactly as a shell would
 * observe them — `signal: 'SIGINT'` with a null code is WIFSIGNALED, not a
 * plain exit(130).
 */
import { describe, expect, test } from 'vitest';
import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIB = new URL('../dist/index.js', import.meta.url).href;

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * Run `source` as a real launcher file rather than via `node -e`: with `-e`,
 * `process.argv[1]` is the first user argument, so `slice(2)` would drop one
 * and row 7 could not be stated honestly.
 */
function runNodeScript(
  source: string,
  argv: readonly string[] = [],
): Promise<RunResult> {
  const dir = mkdtempSync(join(tmpdir(), 'bin-shim-conf-'));
  const file = join(dir, 'launcher.mjs');
  writeFileSync(file, source);
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
 * A consumer-shaped launcher over a fake addon. `runCli` is supplied inline
 * as the injected seam; `body` is its function body, which may only write to
 * fds 1/2 directly (per the run_cli contract) via `writeSync`.
 */
function launcher(body: string, opts = ''): string {
  return `
    import { mainInProcess } from '${LIB}';
    import { writeSync } from 'node:fs';
    mainInProcess({
      scope: 'bsc',
      binaryName: 'bsc',
      from: import.meta.url,
      runCli: (argv) => { ${body} },
      ${opts}
    })
      .then((code) => process.exit(code))
      .catch((err) => {
        process.stderr.write(err.message + '\\n');
        process.exit(1);
      });
  `;
}

describe('row 1: exit-code passthrough', () => {
  test.each([0, 1, 101, 255])(
    'process exits with exactly the returned code %i',
    async (code) => {
      const result = await runNodeScript(launcher(`return ${code};`));
      expect(result.code).toBe(code);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe('');
    },
  );
});

describe('row 2: SIGINT shutdown (POSIX)', () => {
  test.skipIf(process.platform === 'win32')(
    '130 becomes genuine signal death by SIGINT',
    async () => {
      const result = await runNodeScript(launcher('return 130;'));
      expect(result.signal).toBe('SIGINT');
      expect(result.code).toBeNull();
    },
  );
});

describe('row 3: SIGTERM shutdown (POSIX)', () => {
  test.skipIf(process.platform === 'win32')(
    '143 becomes genuine signal death by SIGTERM',
    async () => {
      const result = await runNodeScript(launcher('return 143;'));
      expect(result.signal).toBe('SIGTERM');
      expect(result.code).toBeNull();
    },
  );
});

describe('row 4: Windows plain exit', () => {
  test.runIf(process.platform === 'win32')(
    '130 exits plainly with 130, with no re-raise',
    async () => {
      const result = await runNodeScript(launcher('return 130;'));
      expect(result.code).toBe(130);
      expect(result.signal).toBeNull();
    },
  );
});

describe('row 6: host stdio flushed before the native call', () => {
  test('buffered host output lands ahead of native fd-1 writes', async () => {
    // 200KB overruns the pipe buffer, so Node's stdout write is genuinely
    // still draining when runCli is invoked. Without the flush in
    // mainInProcess, the direct writeSync would overtake it.
    const result = await runNodeScript(`
      import { mainInProcess } from '${LIB}';
      import { writeSync } from 'node:fs';
      process.stdout.write('h'.repeat(200000));
      mainInProcess({
        scope: 'bsc',
        binaryName: 'bsc',
        from: import.meta.url,
        argv: [],
        runCli: () => { writeSync(1, 'NATIVE'); return 0; },
      }).then((code) => process.exit(code));
    `);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('h'.repeat(200000) + 'NATIVE');
  });
});

describe('row 7: argv passthrough', () => {
  test('UTF-8, spaces, quotes and `--` arrive byte-faithfully', async () => {
    const args = ['héllo wörld', '--flag="quoted value"', '--', '-x', 'après'];
    const result = await runNodeScript(
      launcher('writeSync(1, JSON.stringify(argv)); return 0;'),
      args,
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(args);
  });

  test('argv defaults to process.argv.slice(2)', async () => {
    const result = await runNodeScript(
      launcher('writeSync(1, JSON.stringify(argv)); return 0;'),
      ['one', 'two'],
    );
    expect(JSON.parse(result.stdout)).toEqual(['one', 'two']);
  });
});

describe('contract violations surface as errors, not bad exit codes', () => {
  test('a non-integer return is reported and exits 1', async () => {
    const result = await runNodeScript(launcher("return 'nope';"));
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/must return an integer exit code/);
  });

  test('a missing addon package is reported with an install hint', async () => {
    const result = await runNodeScript(`
      import { mainInProcess } from '${LIB}';
      mainInProcess({
        scope: 'definitely-not-installed-xyz',
        binaryName: 'definitely-not-installed-xyz',
        from: import.meta.url,
        argv: [],
      })
        .then((code) => process.exit(code))
        .catch((err) => {
          process.stderr.write(err.message + '\\n');
          process.exit(1);
        });
    `);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      /no prebuilt addon.*expected optional dependency.*npm install/s,
    );
  });
});

describe('resolution against a real node_modules layout', () => {
  /**
   * Build a consumer whose addon package follows the default napi-shaped
   * name, so the whole resolve → load → call path runs unmocked.
   */
  function makeFakeAddonConsumer(exitCode: number) {
    const root = mkdtempSync(join(tmpdir(), 'bin-shim-conf-'));
    const pkgDir = join(
      root,
      'node_modules',
      '@bsc',
      `lib-${process.platform}-${process.arch}`,
    );
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: `@bsc/lib-${process.platform}-${process.arch}`,
        version: '0.0.1',
        main: 'index.cjs',
      }),
    );
    // CommonJS, as napi-rs emits — defaultLoader uses require().
    writeFileSync(
      join(pkgDir, 'index.cjs'),
      `exports.runCli = (argv) => {
         require('node:fs').writeSync(1, JSON.stringify(argv));
         return ${exitCode};
       };\n`,
    );
    mkdirSync(join(root, 'bin'), { recursive: true });
    const entry = join(root, 'bin', 'cli.js');
    writeFileSync(entry, '');
    return { entry };
  }

  test('loads @scope/lib-<platform>-<arch> and calls its runCli', async () => {
    const { entry } = makeFakeAddonConsumer(7);
    const result = await runNodeScript(`
      import { mainInProcess } from '${LIB}';
      mainInProcess({
        scope: 'bsc',
        binaryName: 'bsc',
        from: ${JSON.stringify(pathToFileURL(entry).href)},
        argv: ['a', 'b'],
      }).then((code) => process.exit(code));
    `);
    expect(result.code).toBe(7);
    expect(JSON.parse(result.stdout)).toEqual(['a', 'b']);
  });
});
