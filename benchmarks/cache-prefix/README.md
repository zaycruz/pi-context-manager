# Cache-prefix benchmark

This benchmark compares the cache-safe threshold-message implementation with the earlier dynamic-system-prompt implementation.

## Recorded runs

The committed raw results are:

- [`results/2026-08-29.json`](results/2026-08-29.json)
- [`results/2026-08-30.json`](results/2026-08-30.json)

Both runs used:

- Pi 0.84.3;
- Node.js v25.5.0;
- `openai-codex/gpt-5.4-mini`;
- fixed commit `0dce5f7`;
- dynamic-prompt baseline commit `fc2e224`;
- `README.md` from commit `0dce5f7` as both the appended system-prompt fixture and attached user-message fixture; and
- one warm-up turn and three measured continuation turns per arm.

Across the six measured continuation turns in the two runs, the fixed arm read 27,136 tokens from cache out of 37,179 prompt tokens. The baseline read 1,536 tokens from cache out of 37,425 prompt tokens. The observed cache shares were 73.0% and 4.1%, respectively.

The fixed arm's combined continuation cost was $0.01011645. The baseline's was $0.02756295. This was a 63.3% reduction for these two runs. The dollar values are the `usage.cost` values that Pi received from the provider adapter. They are not reconstructed from a separate price table.

## Run the benchmark

Install the repository dependencies. Authenticate Pi for the configured model. Then run:

```sh
node benchmarks/cache-prefix/run.mjs > /tmp/pi-context-cache-result.json
```

The harness performs these operations:

1. Extract both extension revisions from Git into a temporary directory.
2. Extract the fixed revision's README as the immutable prompt fixture.
3. Start a separate Pi session for each arm.
4. Run one warm-up turn in each arm.
5. Continue each session for three measured turns. Each continuation starts a fresh Pi process.
6. Capture the final assistant `usage` object from Pi's JSON event stream.
7. Print the environment, fixture metadata, commits, and raw per-turn usage as JSON.
8. Remove the temporary sessions and extracted extensions.

Override the defaults with these environment variables:

- `CACHE_BENCH_PI`: Pi executable path.
- `CACHE_BENCH_MODEL`: provider/model selector.
- `CACHE_BENCH_FIXED_COMMIT`: fixed implementation commit.
- `CACHE_BENCH_BASELINE_COMMIT`: baseline implementation commit.

Provider prompt caching is best-effort. A new run can differ from the recorded run because of provider routing, cache state, model changes, or pricing changes. Use multiple repetitions before making a general performance claim.
