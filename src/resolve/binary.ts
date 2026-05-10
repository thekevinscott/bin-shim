import { defaultResolver } from '../defaults.js';
import type { ResolveOpts } from '../types.js';

const DEFAULT_TEMPLATE = '@{scope}/{platform}-{arch}';

function buildPlatformPkg(
  opts: ResolveOpts,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string {
  const { scope, binaryName, platformPackage, packageName, triples } = opts;
  if (packageName) {
    return packageName({ platform, arch, scope, binaryName });
  }
  const template = platformPackage ?? DEFAULT_TEMPLATE;
  return template.replace(
    /\{(scope|platform|arch|triple)\}/g,
    (_match, key: 'scope' | 'platform' | 'arch' | 'triple') => {
      switch (key) {
        case 'scope':
          if (!scope) {
            throw new Error(
              `bin-shim: platformPackage template "${template}" uses {scope} but no scope was provided.`,
            );
          }
          return scope;
        case 'platform':
          return platform;
        case 'arch':
          return arch;
        case 'triple': {
          const triple = triples?.[`${platform}-${arch}`];
          if (!triple) {
            throw new Error(
              `bin-shim: platformPackage template "${template}" uses {triple} but no triple mapping was provided for ${platform}-${arch}. ` +
                `fix: pass a \`triples\` map covering this platform/arch pair.`,
            );
          }
          return triple;
        }
      }
    },
  );
}

export function resolveBinary(opts: ResolveOpts): string {
  const {
    binaryName,
    from,
    platform = process.platform,
    arch = process.arch,
    resolver = defaultResolver(from),
  } = opts;
  const ext = platform === 'win32' ? '.exe' : '';
  const platformPkg = buildPlatformPkg(opts, platform, arch);
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
