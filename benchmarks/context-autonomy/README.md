# Agent-managed context outcome evaluation

This evaluation measures whether an agent can manage its own context without losing canonical task constraints.

It compares three arms:

| Arm | Context behavior | Human context intervention |
|---|---|---:|
| `full-context` | Keep the complete transcript. Disable automatic compaction. | 0 |
| `runtime-compaction` | Disable automatic compaction. Run one manual Pi RPC compaction before the audit queries. | 1 |
| `agent-managed` | Load `pi-context-manager`. Let the persisted 30% and 35% notices guide the agent. Do not tell it which context action or range to use. | 0 |

Every arm receives the same seeded fixture split across three load prompts, one preparation prompt, and three audit prompts. The fixture contains twelve canonical facts, explicit superseded decoys, and completed-work filler. Each audit prompt requests four facts as exact JSON.

The default `messages` fixture places facts and filler in user messages. The `tool-outputs` fixture keeps canonical facts in compact user packets and returns the large completed-work filler through real `load_completed_log_chunk` tool calls. This mode measures whether the LLM chooses reversible tool-exchange hiding without losing the facts it still needs. Every arm loads the same benchmark-only fixture tool.

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
  --fixture-mode tool-outputs \
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
  --fixture-mode tool-outputs \
  --target-chars 440000 \
  --output benchmarks/context-autonomy/results/YYYY-MM-DD.json
```

Review the raw result before you commit it. Do not commit failed authentication responses, provider diagnostics that contain private account data, or unrelated local paths.

## Recorded clean-commit result

The 2026-08-30 run used Pi 0.84.3, Node.js v25.5.0, and `openai-codex/gpt-5.4-mini`. It ran from clean commit `46ef79215cec0a03a3dd8a0d73626badcdff1320`. The load pressure was 36.3% to 36.5% of the 272,000-token context window. The fixture used independent deterministic opaque values for each canonical field.

| Arm | Field accuracy | Full-task pass rate | Decoy errors | Autonomous attempts | Autonomous successes | Human interventions | Active-rule tokens saved | Total measured cost | Mean measured cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `full-context` | 100% | 100% | 0 | 0/3 | 0/3 | 0 | N/A | $0.387246 | $0.129082 |
| `runtime-compaction` | 100% | 100% | 0 | 0/3 | 0/3 | 3 | N/A | $0.521035 | $0.173678 |
| `agent-managed` | 86.1% | 66.7% | 0 | 3/3 | 1/3 | 0 | 186,877 | $0.594945 | $0.198315 |

The managed arm attempted context management in all three trials. Seed 1 summarized messages 1–6, retained all 12 fields, and ended with 111,700 active-rule tokens saved. Seed 2 retained all 12 fields but restored its summary, so it ended with no active rules. Seed 3 hid messages 3–6 and 9–12, ended with 75,177 active-rule tokens saved, and returned 7 of 12 exact fields. The savings metric applies only to `manage_context` rules; it does not measure runtime compaction reduction.

This run does not show a task-quality or cost win. The managed arm's full-task pass rate was 33.3 percentage points below both comparison arms. Its field accuracy was 13.9 percentage points lower. Its measured cost was 53.6% above full context and 14.2% above runtime compaction.

The raw record is [`results/2026-08-30.json`](results/2026-08-30.json). It contains every answer, score, context action, provider-usage record, and validity check.

## Lossless-selection follow-up

The 2026-08-30 follow-up ran only the `agent-managed` arm from clean commit `5790f7763c3ad8bbba71e7172e1569bfe93827eb`. That commit rejects lossy `hide` and `remove` selections unless every selected message is short plain assistant text. The implementation directs durable context to `summarize`.

| Field accuracy | Full-task pass rate | Decoy errors | Autonomous attempts | Autonomous successes | Active-rule tokens saved | Total measured cost |
|---:|---:|---:|---:|---:|---:|---:|
| 97.2% | 66.7% | 0 | 3/3 | 2/3 | 335,476 | $0.621713 |

All three trials created one summary and retained it. Seeds 1 and 3 returned all twelve fields. Seed 2 returned eleven fields and reported `queue_name` as `null`. No trial used `hide` or `remove`.

Compared with the earlier managed-arm observation, field accuracy increased from 86.1% to 97.2%, autonomous success increased from 1 of 3 trials to 2 of 3, and active-rule savings increased from 186,877 to 335,476 tokens. The full-task pass rate stayed at 66.7%.

This one-arm follow-up is directional evidence, not a causal estimate. Provider behavior is nondeterministic, and the comparison did not rerun the other arms. The result is consistent with the selection guard's intended effect because the previous range-hiding failure did not recur. Summary fidelity remains the unresolved failure boundary.

The raw follow-up record is [`results/2026-08-30-selection-guard.json`](results/2026-08-30-selection-guard.json).

## Options

- `--model`: provider/model selector. Default: `openai-codex/gpt-5.4-mini`.
- `--seeds`: comma-separated integer seeds. Default: `1,2,3`.
- `--arms`: comma-separated arm names.
- `--fixture-mode`: `messages` or `tool-outputs`. Default: `messages`.
- `--target-chars`: approximate generated fixture size. Default: `440000`.
- `--timeout-ms`: timeout for each RPC response or agent turn. Default: `300000`.
- `--pi`: Pi executable. Default: `pi`.
- `--output`: optional JSON result path. The harness always prints the same JSON to stdout.

Equivalent `AUTONOMY_BENCH_*` environment variables are available for each option.

## Measurement boundaries

Provider and model behavior are nondeterministic. Run multiple seeds and repeat the evaluation on different dates before making a general claim.

The full-context arm is the correctness ceiling, not a token-efficiency strategy. The runtime-compaction arm includes one explicit human context intervention. The agent-managed arm records an autonomous attempt when it invokes `hide`, `remove`, or `summarize` without a user instruction. It records autonomous success only when the final answers are exact, no provider error occurs, at least one context rule remains active, and the latest successful result with a savings measurement reports that active rules save at least 1% of the model context window. A state-changing action result or a later `stats` result can provide that measurement. The 1% floor excludes nominal actions such as hiding a few acknowledgment tokens.

The `tool-outputs` fixture labels its generated logs as reproducible closed-work filler and states that they contain no canonical facts. It measures whether the LLM can use that semantic distinction. It does not prove that the model will correctly classify arbitrary production tool evidence.

The harness counts nested summary usage only when Pi returns that usage through the extension. It records the missing value instead of estimating it.

The harness executes arms in the requested order. Provider caches can remain warm across runs. Treat the recorded cost as an observation for this run, not a causal estimate of each strategy's billing effect.

A useful result must show lower context cost or longer useful context while preserving canonical-field accuracy. Token reduction with lower task accuracy is not a win.
