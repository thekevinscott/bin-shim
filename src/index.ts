export { main } from './cli/main.js';
export { resolveBinary } from './resolve/binary.js';
export { defaultResolver, defaultSpawner } from './defaults/index.js';
export type {
  Resolver,
  Spawner,
  ResolveOpts,
  MainOpts,
  Triples,
  PackageNameContext,
  PackageNameFn,
} from './types.js';
