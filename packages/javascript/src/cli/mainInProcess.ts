import { resolveRunCli } from '../resolve/addon.js';
import { applyExitSemantics } from '../semantics/exitCodes.js';
import { flushStdio } from '../semantics/flush.js';
import type { InProcessOpts } from '../types.js';

/**
 * The in-process strategy: load the native addon and call its `runCli`
 * in this process, instead of spawning a bundled binary.
 *
 * A sibling of `main` rather than a `strategy` flag on it: the two resolve
 * different kinds of package and take different seams, so a shared options
 * object would be a union that is neither pleasant to type nor to document.
 *
 * Like `main`, the caller owns exiting (`process.exit(await mainInProcess())`).
 * Note that for the POSIX shutdown codes this never returns — the process
 * dies by re-raised signal from inside.
 */
export async function mainInProcess(opts: InProcessOpts): Promise<number> {
  const {
    argv = process.argv.slice(2),
    runCli = resolveRunCli(opts),
    platform,
    raiseSignal,
    flush = flushStdio,
    entryPoint = 'runCli',
  } = opts;
  await flush();
  const code = runCli(argv);
  if (typeof code !== 'number' || !Number.isInteger(code)) {
    throw new Error(
      `${opts.binaryName}: '${entryPoint}' must return an integer exit code; ` +
        `got ${typeof code === 'number' ? code : typeof code}. ` +
        `it does not implement the run_cli contract.`,
    );
  }
  return applyExitSemantics(code, { platform, raiseSignal });
}
