import { createRequire } from 'node:module';
import type { Loader } from '../types.js';

/**
 * The in-process sibling of `defaultResolver`. `createRequire(from)` is both
 * a resolver (`.resolve`) and a loader (calling it), so the addon strategy
 * reuses the same "resolve from the consumer, not from bin-shim" mechanism —
 * see "Why `from` is required" in the README.
 *
 * `require` (not `import()`) because napi-rs addons are CommonJS, and because
 * loading must be synchronous relative to the caller's argv handling.
 */
export const defaultLoader = (from: string | URL): Loader =>
  createRequire(from);
