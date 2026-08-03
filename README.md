# bin-shim

Runtime shims for shipping native CLIs through language package managers,
with identical process semantics everywhere. Two packages, one contract:

| Package | Registry | Path |
|---------|----------|------|
| `bin-shim` (JS/TS) | [npm](https://www.npmjs.com/package/bin-shim) | [`packages/javascript/`](packages/javascript/) |
| `bin-shim` (Python, import `bin_shim`) | PyPI | [`packages/python/`](packages/python/) |

## What it does

**JavaScript (both strategies):** the *spawn* strategy is the esbuild
pattern — a top-level npm package with no real code delegates to a
per-platform package containing the prebuilt binary, and `bin-shim` handles
platform detection, path resolution, spawning with inherited stdio, and
exit-code propagation. The *in-process* strategy instead loads a napi addon
and calls `runCli(argv)` in the same process, owning the process semantics
itself. See [`packages/javascript/README.md`](packages/javascript/README.md).

**Python (in-process strategy):** the native CLI is exposed as a library
function `run_cli(argv) -> int` via bindings (e.g. pyo3), and the launcher
calls it in-process — no spawned child. `bin-shim` owns the process
semantics: exit-code passthrough, signal re-raise (130/143), stdio flushing,
and `KeyboardInterrupt` handling. See
[`packages/python/README.md`](packages/python/README.md).

Both implementations execute the same language-agnostic
[process-semantics conformance spec](spec/conformance.md), so a CLI launched
through either behaves identically to the shell that invoked it.

## What it does not do

Generate per-platform packages, write `optionalDependencies` blocks, or
publish anything — those are publishing concerns (handled here by
[putitoutthere](https://github.com/thekevinscott/put-it-out-there)), not
runtime concerns.

## Repository layout

- `packages/javascript/` — TypeScript implementation (npm: `bin-shim`)
- `packages/python/` — Python implementation (PyPI: `bin-shim`)
- `spec/` — cross-language process-semantics conformance spec
- `.github/workflows/` — per-language, path-filtered CI

Packages version and release independently. Tags: `v{version}` (npm,
pre-monorepo continuity) and `py/bin-shim-v{version}` (PyPI).

## License

MIT
