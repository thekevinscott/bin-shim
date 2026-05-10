export type Resolver = (id: string) => string;

export type Spawner = (
  cmd: string,
  args: readonly string[],
) => Promise<number>;

export type Triples = Partial<Record<string, string>>;

export interface PackageNameContext {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  scope?: string;
  binaryName: string;
}

export type PackageNameFn = (ctx: PackageNameContext) => string;

export interface ResolveOpts {
  scope?: string;
  binaryName: string;
  from: string | URL;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  resolver?: Resolver;
  platformPackage?: string;
  packageName?: PackageNameFn;
  triples?: Triples;
}

export interface MainOpts extends ResolveOpts {
  argv?: readonly string[];
  resolveBin?: () => string;
  spawn?: Spawner;
}
