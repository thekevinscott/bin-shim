test:
	uv run pytest .

test_watch:
	uv run ptw .

coverage:
	uv run pytest src/bin_shim --cov=bin_shim --cov-branch --cov-fail-under=100

lint:
	uv run ruff check $(filter-out $@,$(MAKECMDGOALS))

typecheck:
	uv run ty check

%:
	@:
