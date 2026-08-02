"""setuptools shim: keep colocated unit tests out of the built package.

All real configuration lives in pyproject.toml. This shim exists only to
customize ``build_py`` so the colocated unit tests — ``src/bin_shim/**/*_test.py``
— are never packaged into the wheel or sdist, mirroring how the JS build drops
``src/**/*.test.ts``. Source-of-truth for what *is* shipped stays in pyproject.
"""

from setuptools import setup
from setuptools.command.build_py import build_py


class _BuildPyWithoutTests(build_py):
    """Exclude ``*_test.py`` modules (colocated unit tests) from the build."""

    def find_package_modules(self, package, package_dir):
        modules = super().find_package_modules(package, package_dir)
        return [
            (pkg, module, path)
            for (pkg, module, path) in modules
            if not module.endswith("_test")
        ]


setup(cmdclass={"build_py": _BuildPyWithoutTests})
