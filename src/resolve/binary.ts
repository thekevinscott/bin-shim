import { defaultResolver } from '../defaults.js';
import type { ResolveOpts } from '../types.js';

export function resolveBinary({
  scope,
  binaryName,
  from,
  platform = process.platform,
  arch = process.arch,
  resolver = defaultResolver(from),
}: ResolveOpts): string {
  const ext = platform === 'win32' ? '.exe' : '';
  const platformPkg = `@${scope}/${platform}-${arch}`;
  try {
    return resolver(`${platformPkg}/bin/${binaryName}${ext}`);
  } catch (cause) {
    throw new Error(
      `${binaryName}: no prebuilt binary for ${platform}-${arch}. ` +
        `expected optional dependency ${platformPkg} to provide one. ` +
        `fix: rerun \`npm install ${binaryName}\`.`,
      { cause },
    );
  }
}
