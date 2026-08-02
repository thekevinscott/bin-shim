# bin-shim Development

Multi-language monorepo following the [cachetta](https://github.com/thekevinscott/cachetta)
layout: independent packages under `packages/`, per-language path-filtered CI,
releases orchestrated by putitoutthere.

## Workflow

- **NEVER commit directly to main** — always create a PR.
- Every unit of work has a GitHub issue; the PR description links it with a
  closing keyword (`Closes #N`).
- **Before pushing**: run the tests for the package(s) you changed (see Key
  Commands).
- Keep PRs minimal but complete; every PR includes tests for changed behavior.
- Each package owns a `CHANGELOG.md` ([Keep a Changelog](https://keepachangelog.com/));
  add an entry under `## [Unreleased]` for any consumer-visible change.

## The conformance spec

`spec/conformance.md` is the source of truth for process semantics (exit
codes, signals, stdio). Any semantics change lands as a spec row **before**
the behavior ships, and every implementation's test suite must map to the
rows it covers. Keep the per-implementation mapping tables in the spec up to
date when adding tests.

## Project structure

- `packages/javascript/` — TypeScript implementation (npm: `bin-shim`), spawn strategy
- `packages/python/` — Python implementation (PyPI: `bin-shim`, import `bin_shim`), in-process strategy
- `spec/` — cross-language process-semantics conformance spec
- `.github/workflows/` — per-language CI (`js-*.yaml`, `py-*.yaml`), shared release plumbing

## Testing

Both packages hold their **unit** suites at 100% coverage including branches;
CI enforces it. The unit/integration boundary is **by location**:

- **JS**: unit tests are colocated `src/**/*.test.ts` (vitest thresholds in
  `vitest.config.ts`).
- **Python**: unit tests are colocated `src/bin_shim/**/*_test.py`
  (pytest-describe style); integration tests live in `packages/python/tests/`
  and are excluded from the coverage gate. Integration tests spawn real
  subprocesses to observe genuine exit codes and signal death.

## Key commands

### JavaScript (`packages/javascript/`)

```bash
pnpm build         # tsc build to dist/
pnpm test          # vitest run (builds first via pretest)
pnpm coverage      # vitest run --coverage (100% thresholds)
pnpm typecheck     # tsc --noEmit
pnpm typecheck:tests
```

### Python (`packages/python/`)

```bash
uv run pytest .    # all tests (unit + integration)
make test          # same as above
make coverage      # unit suite with 100% line+branch gate
make lint          # ruff check
make typecheck     # ty check
```

## Versioning & releases

- Versions are independent per package: JS in `package.json`, Python in
  `pyproject.toml` (setuptools-scm, driven by tags).
- **Tag formats**: `v{version}` (npm, pre-monorepo continuity) and
  `py/bin-shim-v{version}` (PyPI).
- Releases are orchestrated by [putitoutthere](https://github.com/thekevinscott/put-it-out-there)
  via `putitoutthere.toml`; push to `main` cascades a `patch` for any package
  whose `globs` matched changed files. Override with a `release: minor`,
  `release: major`, or `release: skip` commit trailer.
- Publishing uses OIDC trusted publishing for both npm and PyPI.

## Code style

- **JS**: TypeScript strict mode, ES2022 target, ESM only.
- **Python**: 3.10+, ruff for linting, ty for type checking.
- camelCase in JS, snake_case in Python — the APIs mirror each other with
  language-appropriate naming.

## Commit convention

| Type | Use for |
|------|---------|
| `feat:` | New user-facing functionality |
| `fix:` | Bug fixes |
| `test:` | Test additions/changes |
| `chore:` | Internal tooling, CI, maintenance |
| `refactor:` | Code restructuring without behavior change |
| `docs:` | Documentation only |
| `style:` | Formatting changes |
