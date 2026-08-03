import type { PackageNamingOpts } from '../types.js';

/**
 * Expand a platform-package template for the host.
 *
 * Shared by both strategies: the spawn strategy resolves a *binary* package,
 * the in-process strategy an *addon* package. They differ only in their
 * default template, so that is a parameter rather than a constant here.
 */
export function buildPackageName(
  opts: PackageNamingOpts,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
  defaultTemplate: string,
): string {
  const { scope, binaryName, platformPackage, packageName, triples } = opts;
  if (packageName) {
    return packageName({ platform, arch, scope, binaryName });
  }
  const template = platformPackage ?? defaultTemplate;
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
