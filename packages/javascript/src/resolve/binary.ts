import { defaultResolver } from '../defaults/index.js';
import type { ResolveOpts } from '../types.js';
import { buildPackageName } from './packageName.js';

const DEFAULT_TEMPLATE = '@{scope}/{platform}-{arch}';

export function resolveBinary(opts: ResolveOpts): string {
  const {
    binaryName,
    from,
    platform = process.platform,
    arch = process.arch,
    resolver = defaultResolver(from),
    binaryDir = 'bin',
  } = opts;
  const ext = platform === 'win32' ? '.exe' : '';
  const platformPkg = buildPackageName(opts, platform, arch, DEFAULT_TEMPLATE);
  const subpath = [binaryDir, `${binaryName}${ext}`].filter(Boolean).join('/');
  try {
    return resolver(`${platformPkg}/${subpath}`);
  } catch (cause) {
    throw new Error(
      `${binaryName}: no prebuilt binary for ${platform}-${arch}. ` +
        `expected optional dependency ${platformPkg} to provide one. ` +
        `fix: rerun \`npm install ${binaryName}\`.`,
      { cause },
    );
  }
}
