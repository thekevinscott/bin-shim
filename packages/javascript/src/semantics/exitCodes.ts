import { defaultSignalRaiser } from '../defaults/index.js';
import type { ExitSemanticsOpts } from '../types.js';

/** `128 + SIGINT`, the POSIX convention the core reports shutdown with. */
export const SIGINT_EXIT_CODE = 130;
/** `128 + SIGTERM`. */
export const SIGTERM_EXIT_CODE = 143;

/**
 * Translate a `runCli` return code into observable process semantics.
 *
 * Ordinary codes pass through for the caller to exit with. On POSIX the two
 * shutdown codes instead re-raise their signal, so the parent sees genuine
 * signal death — exactly what a spawned child produces, which is what makes
 * spawn → in-process behavior-preserving. Windows has no such convention:
 * codes pass through unchanged (conformance rows 2–4).
 */
export function applyExitSemantics(
  code: number,
  opts: ExitSemanticsOpts = {},
): number {
  const { platform = process.platform, raiseSignal = defaultSignalRaiser } =
    opts;
  if (platform === 'win32') {
    return code;
  }
  if (code === SIGINT_EXIT_CODE) {
    return raiseSignal('SIGINT');
  }
  if (code === SIGTERM_EXIT_CODE) {
    return raiseSignal('SIGTERM');
  }
  return code;
}
