# Changelog

All notable changes to the npm `bin-shim` package are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.0] - 2026-08-03

Identical in content to 0.1.4 — see the note under that version. Prefer this
one: it is the version whose number reflects what actually changed.

### Added

- **In-process strategy** alongside spawn, for native CLIs exposed to Node
  through napi bindings as `runCli(argv) -> number`:
  - `mainInProcess(opts)` — flushes host stdio, loads the addon, calls
    `runCli(argv)`, and applies the process-semantics contract to the
    returned code. Note it does *not* always return: on POSIX the shutdown
    codes kill the process from inside (see below).
  - `resolveRunCli(opts)` — loads the addon package for the host and returns
    its entry point (default export name `runCli`), or throws with an
    install hint. Default package template `@{scope}/lib-{platform}-{arch}`,
    per the napi-rs convention; `platformPackage`, `packageName`, and
    `triples` work as they do for the spawn strategy.
  - `applyExitSemantics(code, opts?)` — exit-code passthrough, and on POSIX
    the `130`/`143` shutdown codes restore the default handler and re-raise
    SIGINT/SIGTERM so the parent observes genuine signal death. On Windows
    codes pass through unchanged.
  - `flushStdio(streams?)`, `defaultLoader(from)`,
    `defaultSignalRaiser(signal)`, and the `SIGINT_EXIT_CODE` /
    `SIGTERM_EXIT_CODE` constants.
  - New types: `Loader`, `RunCli`, `SignalRaiser`, `ResolveAddonOpts`,
    `ExitSemanticsOpts`, `InProcessOpts`, `PackageNamingOpts`.
- The package now executes the cross-language
  [conformance spec](https://github.com/thekevinscott/bin-shim/blob/main/spec/conformance.md)
  (`src/conformance.test.ts`), which asserts real signal death rather than
  exit codes for the POSIX shutdown rows.

### Changed

- Moved the package into the `packages/javascript/` directory as part of the
  multi-language monorepo restructure. No consumer-visible change: the
  published package name, API, and behavior are identical.
- `ResolveOpts` now extends the new `PackageNamingOpts` interface. Its
  members are unchanged, so this is source-compatible; it is only visible if
  you were re-declaring the interface yourself.

The spawn strategy — `main`, `resolveBinary`, `defaultResolver`,
`defaultSpawner` — is untouched.

## [0.1.4] - 2026-08-03

Everything listed under 0.2.0 above, published under a patch number by
mistake. The release pipeline had been failing since the monorepo
restructure, and the `release: minor` marker was attached to a run that
died before tagging; by the time publishing was fixed, only a patch bump
remained in scope.

The two versions are the same code. 0.1.4 stays on npm because published
versions are permanent, but 0.2.0 supersedes it and is the version to
depend on — a patch number badly understates a release that adds a whole
second strategy.

## [0.1.3] - 2026-05-13

### Changed

- Internal restructure of the default resolver/spawner modules. No
  consumer-visible change.

## [0.1.2] - 2026-05-13

### Fixed

- `chmod` the bundled binary executable before spawning, so packages whose
  publish pipeline dropped the executable bit still run.

## [0.1.1] - 2026-05-10

### Added

- Arbitrary platform sub-package naming via the `platformPackage` template
  string (with `{scope}` / `{platform}` / `{arch}` / `{triple}` placeholders),
  the `triples` map, and the `packageName` function escape hatch.

## [0.1.0] - 2026-05-10

### Added

- Initial release: `main`, `resolveBinary`, `defaultResolver`,
  `defaultSpawner` — platform detection, per-platform package resolution,
  spawn with inherited stdio, and exit-code propagation for native binaries
  distributed via `optionalDependencies`.
