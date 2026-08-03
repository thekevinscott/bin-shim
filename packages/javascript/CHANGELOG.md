# Changelog

All notable changes to the npm `bin-shim` package are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Moved the package into the `packages/javascript/` directory as part of the
  multi-language monorepo restructure. No consumer-visible change: the
  published package name, API, and behavior are identical.

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
