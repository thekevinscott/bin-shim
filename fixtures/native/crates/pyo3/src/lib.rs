//! pyo3 binding over the shared fixture core.
//!
//! Exported as `run_cli`, matching the Python package's default entry point.

use pyo3::prelude::*;

#[pyfunction]
fn run_cli(py: Python<'_>, argv: Vec<String>) -> i32 {
    // Release the GIL for the duration of the call. A real native CLI does
    // the same, and it is what lets Python's own signal machinery run while
    // the core is working — the condition rows 2-3 and 5 are about.
    py.allow_threads(|| bin_shim_fixture_core::run_cli(argv))
}

#[pymodule]
fn bin_shim_fixture(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(run_cli, m)?)?;
    Ok(())
}
