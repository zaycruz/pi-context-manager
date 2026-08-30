# Agent-managed context outcome evaluation

This evaluation measures whether an agent can manage its own context without losing canonical task constraints.

It compares three arms:

| Arm | Context behavior | Human context intervention |
|---|---|---:|
| `full-context` | Keep the complete transcript. Disable automatic compaction. | 0 |
| `runtime-compaction` | Disable automatic compaction. Run one manual Pi RPC compaction before the audit queries. | 1 |
| `agent-managed` | Load `pi-context-manager`. Let the persisted 30% and 35% notices guide the agent. Do not tell it which context action or range to use. | 0 |

Every arm receives the same seeded fixture split across three load prompts, one preparation prompt, and three audit prompts. The fixture contains twelve canonical facts, explicit superseded decoys, and completed-work filler. Each audit prompt requests four facts as exact JSON.

## Metrics

The result records:

- exact canonical-field accuracy;
- full twelve-field task pass rate;
- superseded-decoy errors;
- provider errors;
- prompt, cache-read, output, reasoning, and total tokens;
- main-loop, nested-summary, compaction, and total measured cost;
- every `manage_context` action and its result;
- autonomous management attempts and successful retained rules;
- threshold-notice levels;
- context pressure after the load turn; and
- human context interventions.

An `agent-managed` trial is invalid if the load turn stays below 35% context use or if the session does not persist both the 30% and 35% notices.

## Prerequisites

Install the repository dependencies. Authenticate Pi for the selected model. Confirm that the selected account can make several large-context requests.

The harness does not read or copy authentication files. The Pi process uses its normal authenticated provider configuration.

## Run a one-seed pilot

Run the pilot before a repeated evaluation:

```sh
node benchmarks/context-autonomy/run.mjs \
  --seeds 1 \
  --arms full-context,runtime-compaction,agent-managed \
  --target-chars 440000 \
  --output /tmp/context-autonomy-pilot.json
```

Inspect `contextPressureAfterLoad` and `noticeLevels` in the output.

Increase `--target-chars` if the managed trial does not reach 35%. Reduce it if the provider approaches its context limit.

## Run three seeds

Run:

```sh
node benchmarks/context-autonomy/run.mjs \
  --seeds 1,2,3 \
  --arms full-context,runtime-compaction,agent-managed \
  --target-chars 440000 \
  --output benchmarks/context-autonomy/results/YYYY-MM-DD.json
```

Review the raw result before you commit it. Do not commit failed authentication responses, provider diagnostics that contain private account data, or unrelated local paths.

## Options

- `--model`: provider/model selector. Default: `openai-codex/gpt-5.4-mini`.
- `--seeds`: comma-separated integer seeds. Default: `1,2,3`.
- `--arms`: comma-separated arm names.
- `--target-chars`: approximate generated fixture size. Default: `440000`.
- `--timeout-ms`: timeout for each RPC response or agent turn. Default: `300000`.
- `--pi`: Pi executable. Default: `pi`.
- `--output`: optional JSON result path. The harness always prints the same JSON to stdout.

Equivalent `AUTONOMY_BENCH_*` environment variables are available for each option.

## Measurement boundaries

Provider and model behavior are nondeterministic. Run multiple seeds and repeat the evaluation on different dates before making a general claim.

The full-context arm is the correctness ceiling, not a token-efficiency strategy. The runtime-compaction arm includes one explicit human context intervention. The agent-managed arm records an autonomous attempt when it invokes `hide`, `remove`, or `summarize` without a user instruction. It records autonomous success only when the final answers are exact, no provider error occurs, and a final stats result reports that active rules save at least 1% of the model context window. The 1% floor excludes nominal actions such as hiding a few acknowledgment tokens.

The harness counts nested summary usage only when Pi returns that usage through the extension. It records the missing value instead of estimating it.

A useful result must show lower context cost or longer useful context while preserving canonical-field accuracy. Token reduction with lower task accuracy is not a win.
