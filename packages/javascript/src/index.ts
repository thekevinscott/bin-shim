export { main } from './cli/main.js';
export { mainInProcess } from './cli/mainInProcess.js';
export { resolveBinary } from './resolve/binary.js';
export { resolveRunCli } from './resolve/addon.js';
export {
  applyExitSemantics,
  SIGINT_EXIT_CODE,
  SIGTERM_EXIT_CODE,
} from './semantics/exitCodes.js';
export { flushStdio } from './semantics/flush.js';
export {
  defaultResolver,
  defaultSpawner,
  defaultLoader,
  defaultSignalRaiser,
} from './defaults/index.js';
export type {
  Resolver,
  Spawner,
  Loader,
  RunCli,
  SignalRaiser,
  ResolveOpts,
  MainOpts,
  ResolveAddonOpts,
  ExitSemanticsOpts,
  InProcessOpts,
  PackageNamingOpts,
  Triples,
  PackageNameContext,
  PackageNameFn,
} from './types.js';
