import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { createRequire } from 'node:module';

export type Resolver = (id: string) => string;
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface RunOptions {
  /** npm scope without the leading '@', e.g. 'darkfactory' for '@darkfactory/...' */
  scope: string;
  /** binary name as it appears on PATH and inside the platform package */
  binaryName: string;
  /**
   * file URL or absolute path to root resolution from. Pass `import.meta.url`
   * from your bin shim. See "Why `from` is required" in the README.
   */
  from: string | URL;
  /** args passed to the binary (defaults to `process.argv.slice(2)`) */
  argv?: readonly string[];
  /** override platform detection (testing only) */
  platform?: NodeJS.Platform;
  /** override arch detection (testing only) */
  arch?: NodeJS.Architecture;
  /** override module resolver (testing only); defaults to require.resolve rooted at `from` */
  resolver?: Resolver;
  /** override process for signal forwarding (testing only) */
  proc?: NodeJS.Process;
  /** override child_process.spawn (testing only) */
  spawn?: SpawnFn;
}

const FORWARDED_SIGNALS: NodeJS.Signals[] = [
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
  'SIGQUIT',
];

/**
 * Resolve the absolute path to the platform binary inside its optional dep.
 *
 * Layout convention (matches esbuild):
 *   Unix:    @{scope}/{platform}-{arch}/bin/{binaryName}
 *   Windows: @{scope}/{platform}-{arch}/{binaryName}.exe
 *
 * Windows binaries live at the package root, not under bin/, because npm's
 * Windows bin-shim machinery generates a .cmd launcher that wants the .exe
 * adjacent to package.json.
 */
export function resolveBinary(opts: RunOptions): string {
  const {
    scope,
    binaryName,
    platform = process.platform,
    arch = process.arch,
    resolver = createRequire(opts.from).resolve,
  } = opts;
  const pkg = `@${scope}/${platform}-${arch}`;
  const subpath =
    platform === 'win32' ? `${binaryName}.exe` : `bin/${binaryName}`;
  try {
    return resolver(`${pkg}/${subpath}`);
  } catch (cause) {
    throw new Error(
      `${binaryName}: no prebuilt binary for ${platform}-${arch}. ` +
        `expected optional dependency ${pkg} to provide one. ` +
        `fix: rerun \`npm install ${binaryName}\`.`,
      { cause },
    );
  }
}

/**
 * Spawn the binary with stdio inherited, forward termination signals to it,
 * and propagate its exit status (code or signal) back to the caller.
 *
 * The promise never resolves — control either returns to the OS via
 * `proc.exit()` (clean exit) or `proc.kill(proc.pid, signal)` (signal
 * death). It can reject if `spawn` itself throws or the child emits
 * `error` before exit.
 */
export function spawnBinary(
  binPath: string,
  argv: readonly string[],
  proc: NodeJS.Process = process,
  spawnFn: SpawnFn = spawn,
): Promise<never> {
  return new Promise<never>((_, reject) => {
    let child: ChildProcess;
    try {
      child = spawnFn(binPath, [...argv], { stdio: 'inherit' });
    } catch (err) {
      reject(err);
      return;
    }

    const forwarders = new Map<NodeJS.Signals, () => void>();
    for (const sig of FORWARDED_SIGNALS) {
      const handler = () => {
        try {
          child.kill(sig);
        } catch {
          // child already gone — ignore
        }
      };
      forwarders.set(sig, handler);
      proc.on(sig, handler);
    }

    const cleanup = () => {
      for (const [sig, handler] of forwarders) {
        proc.removeListener(sig, handler);
      }
    };

    child.once('error', (err) => {
      cleanup();
      reject(err);
    });

    child.once('exit', (code, signal) => {
      cleanup();
      if (signal) {
        // Re-raise so our exit status reflects child's death.
        // process.exit(128+sig) is the conventional shorthand but
        // re-raising is more correct for process-manager visibility.
        proc.kill(proc.pid, signal);
      } else {
        proc.exit(code ?? 1);
      }
    });
  });
}

/**
 * One-shot entry point for `bin/foo.js` shims.
 *
 * @example
 *   #!/usr/bin/env node
 *   import { run } from 'bin-shim';
 *   run({ scope: 'darkfactory', binaryName: 'darkfactory', from: import.meta.url });
 */
export async function run(opts: RunOptions): Promise<never> {
  const proc = opts.proc ?? process;
  try {
    const binPath = resolveBinary(opts);
    return await spawnBinary(
      binPath,
      opts.argv ?? proc.argv.slice(2),
      proc,
      opts.spawn,
    );
  } catch (err) {
    proc.stderr.write(`${(err as Error).message}\n`);
    proc.exit(1);
    throw err; // unreachable; satisfies Promise<never>
  }
}
