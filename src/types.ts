export type Resolver = (id: string) => string;

export type Spawner = (
  cmd: string,
  args: readonly string[],
) => Promise<number>;

export interface ResolveOpts {
  scope: string;
  binaryName: string;
  from: string | URL;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  resolver?: Resolver;
}

export interface MainOpts extends ResolveOpts {
  argv?: readonly string[];
  resolveBin?: () => string;
  spawn?: Spawner;
}
