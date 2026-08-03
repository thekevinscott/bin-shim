import { defaultLoader } from '../defaults/index.js';
import type { ResolveAddonOpts, RunCli } from '../types.js';
import { buildPackageName } from './packageName.js';

/**
 * napi-rs publishes addons as `@scope/lib-<platform>-<arch>`; the `lib-`
 * prefix is what distinguishes an addon package from the spawn strategy's
 * binary package when both ship under one scope.
 */
const DEFAULT_ADDON_TEMPLATE = '@{scope}/lib-{platform}-{arch}';

export function resolveRunCli(opts: ResolveAddonOpts): RunCli {
  const {
    binaryName,
    from,
    platform = process.platform,
    arch = process.arch,
    entryPoint = 'runCli',
    load = defaultLoader(from),
  } = opts;
  const addonPkg = buildPackageName(
    opts,
    platform,
    arch,
    DEFAULT_ADDON_TEMPLATE,
  );
  let addon: unknown;
  try {
    addon = load(addonPkg);
  } catch (cause) {
    throw new Error(
      `${binaryName}: no prebuilt addon for ${platform}-${arch}. ` +
        `expected optional dependency ${addonPkg} to provide one. ` +
        `fix: rerun \`npm install ${binaryName}\`.`,
      { cause },
    );
  }
  const entry = (addon as Record<string, unknown> | null | undefined)?.[
    entryPoint
  ];
  if (typeof entry !== 'function') {
    throw new Error(
      `${binaryName}: ${addonPkg} has no callable '${entryPoint}' export ` +
        `(got ${entry === undefined ? 'undefined' : typeof entry}). ` +
        `it does not implement the run_cli contract.`,
    );
  }
  return entry as RunCli;
}
