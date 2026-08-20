/**
 * Fixture tier of the process-semantics conformance spec
 * (spec/conformance.md at the repo root).
 *
 * Unlike `conformance.test.ts`, the native side here is the real reference
 * crate — one Rust `run_cli` behind napi — so these tests cover what a
 * JavaScript fake structurally cannot: a signal delivered into native code
 * *while it is running*, writes issued to file descriptor 1 by the addon
 * itself, and real OS threads still alive when `runCli` returns.
 *
 * The suite skips itself when the fixture has not been built, so
 * `pnpm test` stays useful without a Rust toolchain. CI builds it first
 * (see .github/workflows/fixture-conformance.yaml).
 */
import { describe, expect, test } from 'vitest';
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = new URL('../../dist/index.js', import.meta.url).href;
const FIXTURE = fileURLToPath(
  new URL('../../../../fixtures/native/dist/fixture.node', import.meta.url),
);

const hasFixture = existsSync(FIXTURE);
const describeFixture = hasFixture ? describe : describe.skip;
const posixOnly = process.platform !== 'win32';

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

interface RunOpts {
  argv?: readonly string[];
  /** Send this signal once the fixture reports it is ready. */
  signalWhenReady?: NodeJS.Signals;
  timeoutMs?: number;
  /**
   * Bytes to leave in the host's buffered stdout *before* calling
   * mainInProcess. Writing inside `runCli` would prove nothing — by then
   * the launcher has already flushed — so row 6 depends on this happening
   * ahead of the call.
   */
  hostUnflushedBytes?: number;
}

/**
 * Run a consumer-shaped launcher over the real addon. `body` is spliced in
 * as the mainInProcess options, so each test picks its own seam.
 */
function runLauncher(optionsSource: string, opts: RunOpts = {}): Promise<RunResult> {
  const dir = mkdtempSync(join(tmpdir(), 'bin-shim-fx-'));
  const file = join(dir, 'launcher.mjs');
  const prelude =
    opts.hostUnflushedBytes === undefined
      ? ''
      : `process.stdout.write('h'.repeat(${opts.hostUnflushedBytes}));`;
  writeFileSync(
    file,
    `import { createRequire } from 'node:module';
     import { mainInProcess } from '${LIB}';
     const require = createRequire(import.meta.url);
     const addon = require(${JSON.stringify(FIXTURE)});
     ${prelude}
     mainInProcess({
       scope: 'fx',
       binaryName: 'fixture',
       from: import.meta.url,
       ${optionsSource}
     })
       .then((code) => process.exit(code))
       .catch((err) => {
         process.stderr.write(err.message + '\\n');
         process.exit(1);
       });
    `,
  );
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(process.execPath, [file, ...(opts.argv ?? [])], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let signalled = false;
    child.stdout!.on('data', (d) => (stdout += d.toString()));
    child.stderr!.on('data', (d) => {
      stderr += d.toString();
      // The fixture announces readiness only after its signal handlers are
      // installed; signalling before that would race and flake.
      if (
        !signalled &&
        opts.signalWhenReady &&
        stderr.includes('fixture: ready')
      ) {
        signalled = true;
        child.kill(opts.signalWhenReady);
      }
    });
    const limit = opts.timeoutMs ?? 20000;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      // Report what the child actually managed before hanging — without
      // this a stuck re-raise and a signal that never arrived look
      // identical, and the difference is the whole diagnosis.
      reject(
        new Error(
          `launcher did not exit within ${limit}ms\n` +
            `  signal sent: ${signalled}\n` +
            `  stdout: ${JSON.stringify(stdout.slice(0, 200))}\n` +
            `  stderr: ${JSON.stringify(stderr.slice(0, 400))}`,
        ),
      );
    }, limit);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        elapsedMs: Date.now() - started,
      });
    });
    child.once('error', reject);
  });
}

describeFixture('fixture tier: row 1 — exit-code passthrough', () => {
  test.each([0, 1, 101, 255])(
    'the real addon returning %i exits the process with it',
    async (code) => {
      const result = await runLauncher(`runCli: addon.runCli,`, {
        argv: ['exit', String(code)],
      });
      expect(result.code).toBe(code);
      expect(result.signal).toBeNull();
    },
  );
});

describeFixture('fixture tier: row 2 — SIGINT delivered mid-run', () => {
  test.skipIf(!posixOnly)(
    'a real SIGINT during runCli produces genuine signal death',
    async () => {
      const result = await runLauncher(`runCli: addon.runCli,`, {
        argv: ['sleep', '10000'],
        signalWhenReady: 'SIGINT',
      });
      // The core caught the signal itself, shut down gracefully, and
      // returned 130; the launcher then re-raised it.
      expect(result.stderr).toContain('fixture: graceful shutdown');
      expect(result.signal).toBe('SIGINT');
      expect(result.code).toBeNull();
    },
    30000,
  );
});

describeFixture('fixture tier: row 3 — SIGTERM delivered mid-run', () => {
  test.skipIf(!posixOnly)(
    'a real SIGTERM during runCli produces genuine signal death',
    async () => {
      const result = await runLauncher(`runCli: addon.runCli,`, {
        argv: ['sleep', '10000'],
        signalWhenReady: 'SIGTERM',
      });
      expect(result.stderr).toContain('fixture: graceful shutdown');
      expect(result.signal).toBe('SIGTERM');
      expect(result.code).toBeNull();
    },
    30000,
  );
});

describeFixture('fixture tier: row 6 — native fd-1 writes interleave correctly', () => {
  test('host output queued before the call lands ahead of native output', async () => {
    // 200KB overruns the pipe buffer, so Node's stdout write is genuinely
    // still draining when the addon writes to fd 1 with write(2). The
    // launcher's flush is the only thing imposing an order.
    const result = await runLauncher(`runCli: addon.runCli,`, {
      argv: ['write-fd1', 'NATIVE'],
      hostUnflushedBytes: 200000,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('h'.repeat(200000) + 'NATIVE');
  });
});

describeFixture('fixture tier: row 7 — argv passthrough', () => {
  test('UTF-8, spaces, quotes and -- reach the native side byte-faithfully', async () => {
    const payload = ['héllo wörld', '--flag="quoted value"', '--', '-x', 'après'];
    const result = await runLauncher(`runCli: addon.runCli,`, {
      argv: ['echo-argv', ...payload],
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(payload);
  });
});

describeFixture('fixture tier: row 8 — prompt exit', () => {
  test('lingering native threads do not hold the process open', async () => {
    // The fixture leaves four threads sleeping for 600s and returns 0. If
    // anything waited on them the launcher would hang; it must exit at once.
    const result = await runLauncher(`runCli: addon.runCli,`, {
      argv: ['spawn-threads', '4'],
      timeoutMs: 15000,
    });
    expect(result.stderr).toContain('fixture: threads spawned');
    expect(result.code).toBe(0);
    expect(result.elapsedMs).toBeLessThan(10000);
  });
});

/**
 * Rows 4-5 on Windows: a **real console control event** delivered to a
 * running process, rather than a fixture that merely returns 130.
 *
 * Windows will only target a console control event at a process group, and
 * only a process created with CREATE_NEW_PROCESS_GROUP is in one — a flag
 * Node's `spawn` cannot set (`detached` maps to DETACHED_PROCESS, leaving
 * the child with no console to signal). So the fixture ships a `ctrl-event`
 * helper that both spawns the target onto its own console and raises the
 * event there, which is also what keeps the event off the test runner.
 */
const CTRL_EVENT = fileURLToPath(
  new URL('../../../../fixtures/native/dist/ctrl-event.exe', import.meta.url),
);
const hasCtrlEvent = process.platform === 'win32' && existsSync(CTRL_EVENT);
const describeWindowsCtrl = hasCtrlEvent ? describe : describe.skip;

describeWindowsCtrl('fixture tier: row 4 — Windows ctrl-c', () => {
  function launcherFile(): string {
    const dir = mkdtempSync(join(tmpdir(), 'bin-shim-fx-'));
    const file = join(dir, 'launcher.mjs');
    writeFileSync(
      file,
      `import { createRequire } from 'node:module';
       import { mainInProcess } from '${LIB}';
       const require = createRequire(import.meta.url);
       const addon = require(${JSON.stringify(FIXTURE)});
       mainInProcess({
         scope: 'fx',
         binaryName: 'fixture',
         from: import.meta.url,
         runCli: addon.runCli,
       }).then((code) => process.exit(code));
      `,
    );
    return file;
  }

  function runWithCtrlEvent(event: 'c' | 'break'): Promise<RunResult> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = nodeSpawn(
        CTRL_EVENT,
        ['spawn', process.execPath, launcherFile(), 'sleep', '10000'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      let pid: string | undefined;
      let sent = false;
      const maybeSend = () => {
        const match = /PID=(\d+)/.exec(stdout);
        if (match) pid = match[1];
        // Both conditions matter: the pid tells us who to signal, and the
        // readiness line proves the console handler is installed.
        if (!sent && pid && stderr.includes('fixture: ready')) {
          sent = true;
          nodeSpawn(CTRL_EVENT, ['send', pid, event], { stdio: 'inherit' });
        }
      };
      child.stdout!.on('data', (d) => {
        stdout += d.toString();
        maybeSend();
      });
      child.stderr!.on('data', (d) => {
        stderr += d.toString();
        maybeSend();
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`no exit within 30s; stdout=${stdout} stderr=${stderr}`));
      }, 30000);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal, stdout, stderr, elapsedMs: Date.now() - started });
      });
      child.once('error', reject);
    });
  }

  test('a real CTRL_C_EVENT exits plainly with 130, with no re-raise', async () => {
    const result = await runWithCtrlEvent('c');
    expect(result.stderr).toContain('fixture: graceful shutdown');
    // Windows has no signal death: the launcher must exit(130) plainly.
    expect(result.code).toBe(130);
    expect(result.signal).toBeNull();
  }, 40000);

  test('a real CTRL_BREAK_EVENT takes the same shutdown path', async () => {
    const result = await runWithCtrlEvent('break');
    expect(result.stderr).toContain('fixture: graceful shutdown');
    expect(result.code).toBe(130);
  }, 40000);
});

describeFixture('fixture tier: entry-point resolution against the real addon', () => {
  test('resolveRunCli finds the napi-camelCased runCli export', async () => {
    // napi renames Rust's `run_cli` to `runCli`, which is the npm package's
    // default entryPoint — this asserts those two conventions still line up.
    const result = await runLauncher(`load: () => addon,`, {
      argv: ['exit', '9'],
    });
    expect(result.code).toBe(9);
  });
});
