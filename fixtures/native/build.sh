#!/usr/bin/env bash
#
# Build the reference fixture and stage the artifacts both conformance
# suites load:
#
#   fixtures/native/dist/fixture.node          (napi, require()d by Node)
#   fixtures/native/dist/bin_shim_fixture.so   (pyo3, imported by Python)
#
# Cargo names cdylibs per-platform (lib*.so / lib*.dylib / *.dll), and
# neither runtime accepts those names as-is: Node wants a .node suffix and
# Python wants the module's import name. Staging is that rename, in one
# place, so the suites can just look for a fixed path.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dist="$here/dist"

cargo build --release --manifest-path "$here/Cargo.toml"

target="$here/target/release"
mkdir -p "$dist"

stage() {
  local stem="$1" dest="$2"
  for candidate in "$target/lib$stem.so" "$target/lib$stem.dylib" "$target/$stem.dll"; do
    if [[ -f "$candidate" ]]; then
      cp "$candidate" "$dist/$dest"
      echo "staged $(basename "$candidate") -> dist/$dest"
      return 0
    fi
  done
  echo "error: no cdylib found for $stem in $target" >&2
  return 1
}

stage bin_shim_fixture_napi fixture.node
# Python accepts a plain .so on Linux/macOS and .pyd on Windows; the import
# name must match the #[pymodule] function.
if [[ "${OS:-}" == "Windows_NT" ]]; then
  stage bin_shim_fixture bin_shim_fixture.pyd
else
  stage bin_shim_fixture bin_shim_fixture.so
fi
