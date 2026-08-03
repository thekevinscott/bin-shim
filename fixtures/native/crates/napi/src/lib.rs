//! napi binding over the shared fixture core.
//!
//! `#[napi]` camelCases the export, so Rust's `run_cli` reaches Node as
//! `runCli` — which is exactly the npm package's default `entryPoint`.

use napi_derive::napi;

#[napi]
pub fn run_cli(argv: Vec<String>) -> i32 {
    bin_shim_fixture_core::run_cli(argv)
}
