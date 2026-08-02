import { defaultSpawner } from '../defaults/index.js';
import { resolveBinary } from '../resolve/binary.js';
import type { MainOpts } from '../types.js';

export async function main(opts: MainOpts): Promise<number> {
  const {
    argv = process.argv.slice(2),
    resolveBin = () => resolveBinary(opts),
    spawn = defaultSpawner,
  } = opts;
  return spawn(resolveBin(), argv);
}
