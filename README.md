# bin-shim

Runtime shim for distributing native binaries as npm packages via
`optionalDependencies`. The pattern esbuild popularized: a top-level package
with no real code that delegates to a per-platform package containing the
prebuilt binary for the host. `bin-shim` is the 3-line wrapper your top-level
package's `bin/foo.js` delegates to.

It handles platform detection, path resolution (including the
Windows-vs-Unix layout difference), signal forwarding, exit-code
propagation, and the error message you want users to see when no platform
package matched.

It does not generate the per-platform packages or write the
`optionalDependencies` block — that's a publishing concern, not a runtime
concern.

## Quickstart

Three pieces fit together. You need all three.

### 1. Top-level `bin/foo.js`

```js
#!/usr/bin/env node
import { run } from 'bin-shim';
run({
  scope: 'yourname',
  binaryName: 'foo',
  from: import.meta.url,
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

Unix (`@yourname/linux-x64`, etc.):

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

Windows (`@yourname/win32-x64`):

```
@yourname/win32-x64/
├── package.json
└── foo.exe
```

```json
{
  "name": "@yourname/win32-x64",
  "version": "1.0.0",
  "os": ["win32"],
  "cpu": ["x64"],
  "preferUnplugged": true
}
```

The Windows `.exe` lives at the package root, not under `bin/`. npm's
Windows shim machinery generates a `.cmd` launcher that expects the `.exe`
adjacent to `package.json`. Putting it in `bin/` breaks that path.

The `os` and `cpu` constraints make npm install only the matching package.
Skip them and every user downloads every platform's binary.

`preferUnplugged: true` keeps Yarn Berry from zipping the package, which
breaks file-path resolution.

## API

### `run(opts): Promise<never>`

The one-shot entry point. Resolves the platform binary, spawns it, forwards
signals, and propagates the exit status. Calls `process.exit()` on the
caller's behalf. The promise never resolves; control returns to the OS.

```ts
run({
  scope: 'yourname',      // npm scope without '@'
  binaryName: 'foo',
  from: import.meta.url,  // see below — required
  argv: process.argv.slice(2), // optional; default
});
```

### `resolveBinary(opts): string`

Returns the absolute path to the platform binary inside the matching
optional dependency, or throws with a helpful message if none was
installed. Useful if you need the path for something other than `spawn`.

### `spawnBinary(binPath, argv, proc?): Promise<never>`

Spawns the binary at `binPath` with `stdio: 'inherit'`, forwards SIGINT,
SIGTERM, SIGHUP, and SIGQUIT to it, and propagates its exit status (code or
signal) to `proc` (default: `process`). Re-raises signals via `proc.kill`
rather than translating to `128 + sig` so process managers see the real
death cause.

## What `bin-shim` does not do

- **Generate per-platform packages.** That's your publishing tool's job.
- **Write the `optionalDependencies` block.** Same.
- **Handle `--no-optional`.** A consumer who runs
  `npm install --no-optional foo` skips all platform packages. `bin-shim`
  fails with a documented error. Recommend a language-native install path
  (`cargo install`, `brew install`, direct GitHub release download) as the
  alternative. We deliberately don't ship a postinstall download fallback —
  postinstall scripts are widely disabled, the security surface is large,
  and hash verification has no obvious right answer.
- **Yarn Berry PnP zip-path workaround.** Set `preferUnplugged: true` on
  every platform package and you'll be fine.
- **`*_BINARY_PATH` env var escape hatch.** Three lines of code, public API
  surface forever once shipped. May add in a future release on demand.

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
`import.meta.url` from your `bin/foo.js` is the cheapest reliable way: one
extra arg, always correct, always how `createRequire` is meant to be used.

If you make `from` optional in a fork, expect breakage under pnpm,
Yarn PnP, and monorepos.

## Comparison to esbuild's hand-rolled wrapper

esbuild's `lib/npm/node-platform.ts` is the reference implementation of
this pattern and the source of much of `bin-shim`'s design. Two differences
worth knowing:

1. **Signal forwarding.** esbuild uses `execFileSync`, which orphans the
   child binary if the wrapper is killed. `bin-shim` uses `spawn` with
   explicit signal forwarding plus signal re-raise on child exit, so a
   SIGTERM to the wrapper kills the binary too and surfaces as a SIGTERM
   death of the wrapper.
2. **Windows layout.** esbuild's machinery and `bin-shim` agree: `.exe` at
   the platform-package root, not under `bin/`. Some hand-rolled wrappers
   put it under `bin/` and break the npm `.cmd` launcher path. `bin-shim`'s
   resolver enforces the right layout so a misconfigured platform package
   fails loudly.

## License

MIT
