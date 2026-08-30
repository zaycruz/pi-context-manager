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

An `agent-managed` trial is invalid only when the fixture does not reach 35% context use. A missing notice or missing autonomous action remains a valid failure and stays in the aggregate.

Field scoring uses strict JSON value types. A full-task pass requires one bare JSON object with exactly the requested keys. Fences, surrounding prose, extra keys, numeric coercion, and decoy values prevent a full-task pass.

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

## Recorded clean-commit result

The 2026-08-30 run used Pi 0.84.3, Node.js v25.5.0, and `openai-codex/gpt-5.4-mini`. It ran from clean commit `706ef33c6e6d56c875db68ea2e672a7895098816`. The load pressure was 36.3% to 36.5% of the 272,000-token context window.

| Arm | Field accuracy | Full-task pass rate | Decoy errors | Autonomous attempts | Autonomous successes | Human interventions | Context tokens saved | Total measured cost | Mean measured cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `full-context` | 100% | 100% | 0 | 0/3 | 0/3 | 0 | 0 | $0.275500 | $0.091833 |
| `runtime-compaction` | 100% | 100% | 0 | 0/3 | 0/3 | 3 | 0 | $0.477789 | $0.159263 |
| `agent-managed` | 97.2% | 66.7% | 0 | 3/3 | 2/3 | 0 | 335,830 | $0.506276 | $0.168759 |

The managed arm summarized messages 1–6 in all three trials. Active rules saved 111,943 context tokens per trial on average. One managed answer returned `null` for `queue_name`, so that trial returned 11 of 12 exact fields. The raw record does not include generated summary text, so it cannot locate the omission in summary generation or later retrieval.

This run does not show a task-quality or cost win. The managed arm reduced active context without human intervention, but its full-task pass rate was 33.3 percentage points below both comparison arms. Its measured cost was 83.8% above full context and 6.0% above runtime compaction.

The raw record is [`results/2026-08-30.json`](results/2026-08-30.json). It contains every answer, score, context action, provider-usage record, and validity check.

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

The full-context arm is the correctness ceiling, not a token-efficiency strategy. The runtime-compaction arm includes one explicit human context intervention. The agent-managed arm records an autonomous attempt when it invokes `hide`, `remove`, or `summarize` without a user instruction. It records autonomous success only when the final answers are exact, no provider error occurs, at least one context rule remains active, and the latest successful result with a savings measurement reports that active rules save at least 1% of the model context window. A state-changing action result or a later `stats` result can provide that measurement. The 1% floor excludes nominal actions such as hiding a few acknowledgment tokens.

The harness counts nested summary usage only when Pi returns that usage through the extension. It records the missing value instead of estimating it.

The harness executes arms in the requested order. Provider caches can remain warm across runs. Treat the recorded cost as an observation for this run, not a causal estimate of each strategy's billing effect.

A useful result must show lower context cost or longer useful context while preserving canonical-field accuracy. Token reduction with lower task accuracy is not a win.
