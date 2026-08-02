# bin-shim

Runtime shim for distributing native binaries as npm packages via
`optionalDependencies`. The pattern esbuild popularized: a top-level package
with no real code that delegates to a per-platform package containing the
prebuilt binary for the host. `bin-shim` is the wrapper your top-level
package's `bin/foo.js` delegates to.

It handles platform detection, path resolution, spawning the binary with
inherited stdio, and exit-code propagation. It does not generate the
per-platform packages or write the `optionalDependencies` block — those
are publishing concerns, not runtime concerns.

## Install

```sh
npm install bin-shim
```

## Quickstart

Three pieces fit together. You need all three.

### 1. Top-level `bin/foo.js`

```js
#!/usr/bin/env node
import { main } from 'bin-shim';

main({ scope: 'yourname', binaryName: 'foo', from: import.meta.url })
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
```

Make it executable: `chmod +x bin/foo.js`. Track the bit in git:
`git update-index --chmod=+x bin/foo.js`.

### 2. Top-level `package.json`

```json
{
  "name": "foo",
  "type": "module",
  "bin": { "foo": "bin/foo.js" },
  "files": ["bin/"],
  "engines": { "node": ">=20.20.0" },
  "dependencies": {
    "bin-shim": "^0.1.0"
  },
  "optionalDependencies": {
    "@yourname/linux-x64": "1.0.0",
    "@yourname/linux-arm64": "1.0.0",
    "@yourname/darwin-x64": "1.0.0",
    "@yourname/darwin-arm64": "1.0.0",
    "@yourname/win32-x64": "1.0.0"
  }
}
```

### 3. Per-platform package layout

```
@yourname/linux-x64/
├── package.json
└── bin/
    └── foo
```

```json
{
  "name": "@yourname/linux-x64",
  "version": "1.0.0",
  "os": ["linux"],
  "cpu": ["x64"],
  "preferUnplugged": true
}
```

Windows is the same shape with a `.exe` suffix:

```
@yourname/win32-x64/
├── package.json
└── bin/
    └── foo.exe
```

The `os` and `cpu` constraints make npm install only the matching package.
Skip them and every user downloads every platform's binary.

`preferUnplugged: true` keeps Yarn Berry from zipping the package, which
breaks file-path resolution.

## API

### `main(opts): Promise<number>`

Resolves the platform binary, spawns it with stdio inherited, and resolves
with the child's exit code. Caller is responsible for `process.exit`.

```ts
main({
  scope: 'yourname',         // npm scope without '@' (required unless template/fn omits {scope})
  binaryName: 'foo',         // binary name inside the platform pkg (required)
  from: import.meta.url,     // see "Why `from`" below (required)
  argv: process.argv.slice(2),  // optional; default
  resolveBin: () => '/path/to/foo', // optional; defaults to resolveBinary(opts)
  spawn: customSpawner,      // optional; defaults to defaultSpawner
  platformPackage: '@{scope}/{platform}-{arch}', // optional; default shown
  packageName: ({ platform, arch }) => `@scope/${platform}-${arch}`, // optional escape hatch
  triples: { 'linux-x64': 'x86_64-unknown-linux-gnu' }, // required if template uses {triple}
});
```

### Platform package naming

Default: `@{scope}/{platform}-{arch}` (the JS-shape convention,
e.g. `@yourname/linux-x64`).

Override with `platformPackage` (a template string) when your binaries are
published under a different shape. Available placeholders:

- `{scope}` — `opts.scope` (the template is expected to omit this for unscoped distributions)
- `{platform}` — Node's `NodeJS.Platform` value (`linux`, `darwin`, `win32`, ...)
- `{arch}` — Node's `NodeJS.Architecture` value (`x64`, `arm64`, ...)
- `{triple}` — value from the `triples` map keyed on `${platform}-${arch}`

Rust-triple shape (e.g. crates published by `putitoutthere`'s
bundled-cli mode):

```ts
main({
  scope: 'dark-factory',
  binaryName: 'darkfactory',
  from: import.meta.url,
  platformPackage: '@{scope}/{triple}',
  triples: {
    'linux-x64':    'x86_64-unknown-linux-gnu',
    'linux-arm64':  'aarch64-unknown-linux-gnu',
    'darwin-x64':   'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
    'win32-x64':    'x86_64-pc-windows-msvc',
  },
});
```

Use `packageName` for shapes that templating cannot express. It receives
`{ platform, arch, scope, binaryName }` and returns the package name.
`packageName` takes precedence over `platformPackage` when both are set.

### `resolveBinary(opts): string`

Returns the absolute path to the platform binary inside the matching
optional dependency, or throws with a helpful message if none was
installed.

### `defaultResolver(from): Resolver`

Returns `createRequire(from).resolve`. Used by `resolveBinary` when no
explicit `resolver` is supplied.

### `defaultSpawner(cmd, args): Promise<number>`

Spawns `cmd` with `stdio: 'inherit'`, resolves with the child's exit code
(or `1` if the child was terminated by a signal), rejects if `spawn`
itself errors.

### Types

```ts
type Resolver = (id: string) => string;
type Spawner = (cmd: string, args: readonly string[]) => Promise<number>;

type Triples = Partial<Record<string, string>>;

interface PackageNameContext {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  scope?: string;
  binaryName: string;
}

type PackageNameFn = (ctx: PackageNameContext) => string;

interface ResolveOpts {
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

interface MainOpts extends ResolveOpts {
  argv?: readonly string[];
  resolveBin?: () => string;
  spawn?: Spawner;
}
```

## What `bin-shim` does not do

- **Generate per-platform packages.** That's your publishing tool's job.
- **Write the `optionalDependencies` block.** Same.
- **Forward signals to the child.** A SIGTERM to the wrapper process
  exits the wrapper but does not propagate to the spawned binary; the
  child is reparented to PID 1 and finishes naturally. If your binary
  needs cooperative termination, wrap it yourself or supply a custom
  `spawn`.
- **Handle `--no-optional`.** A consumer who runs
  `npm install --no-optional foo` skips all platform packages. `main`
  rejects with the documented error. Recommend a language-native install
  path (`cargo install`, `brew install`, direct GitHub release download)
  as the alternative.
- **Yarn Berry PnP zip-path workaround.** Set `preferUnplugged: true` on
  every platform package.
- **`*_BINARY_PATH` env var escape hatch.**

## Why `from` is required

When `bin-shim` lives in `node_modules/bin-shim/`,
`createRequire(import.meta.url).resolve('@yourname/linux-x64/...')` from
inside the library asks Node to find that package starting from
`bin-shim`'s own directory. Depending on how the package manager hoists
deps, that lookup can fail entirely (pnpm's strict layout), succeed only
sometimes (npm with deduplication), or succeed by accident (flat
`node_modules`).

The platform package is installed next to the *consumer*, not next to
`bin-shim`. So the consumer has to tell `bin-shim` where it is. Passing
`import.meta.url` from your `bin/foo.js` is the cheapest reliable way.

## License

MIT
