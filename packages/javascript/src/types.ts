export type Resolver = (id: string) => string;

export type Spawner = (
  cmd: string,
  args: readonly string[],
) => Promise<number>;

/**
 * Loads a module by package name, from the consumer's resolution root.
 * `createRequire(from)` is exactly this shape — see `defaultLoader`.
 */
export type Loader = (id: string) => unknown;

/**
 * The native entry point: `runCli(argv) -> number`. Per the run_cli contract
 * it always returns (never terminates the process) and writes only to file
 * descriptors 1/2.
 */
export type RunCli = (argv: readonly string[]) => number;

/**
 * Restores the default disposition for `signal` and re-raises it at this
 * process, so the parent observes genuine signal death. Never returns.
 */
export type SignalRaiser = (signal: 'SIGINT' | 'SIGTERM') => never;

export type Triples = Partial<Record<string, string>>;

export interface PackageNameContext {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  scope?: string;
  binaryName: string;
}

export type PackageNameFn = (ctx: PackageNameContext) => string;

/** The naming knobs shared by both strategies' platform-package resolution. */
export interface PackageNamingOpts {
  scope?: string;
  binaryName: string;
  platformPackage?: string;
  packageName?: PackageNameFn;
  triples?: Triples;
}

export interface ResolveOpts extends PackageNamingOpts {
  from: string | URL;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  resolver?: Resolver;
  /**
   * Directory holding the binary inside the platform package. Defaults to
   * `bin`; `''` puts it at the package root, which is where putitoutthere's
   * bundled-cli recipe stages it.
   */
  binaryDir?: string;
}

export interface MainOpts extends ResolveOpts {
  argv?: readonly string[];
  resolveBin?: () => string;
  spawn?: Spawner;
}

export interface ResolveAddonOpts extends PackageNamingOpts {
  from: string | URL;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  /** Named export to call on the addon. Default `'runCli'`. */
  entryPoint?: string;
  load?: Loader;
}

export interface ExitSemanticsOpts {
  platform?: NodeJS.Platform;
  raiseSignal?: SignalRaiser;
}

export interface InProcessOpts extends ResolveAddonOpts, ExitSemanticsOpts {
  argv?: readonly string[];
  runCli?: RunCli;
  flush?: () => Promise<void>;
}
