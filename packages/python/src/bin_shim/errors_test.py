"""Unit tests for bin_shim.errors."""

import pytest

from bin_shim.errors import BinShimError


def describe_bin_shim_error():
    def test_is_an_exception_with_its_message():
        with pytest.raises(BinShimError, match="boom"):
            raise BinShimError("boom")
