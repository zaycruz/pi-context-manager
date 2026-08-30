# Agent-managed context: example and evidence

`pi-context-manager` gives an agent a bounded control loop for its own working context:

1. Observe context use with `stats` and inspect messages with `list`.
2. Decide which completed messages are no longer useful for the active task.
3. Apply `hide`, `remove`, or `summarize` to only those messages.
4. Verify the reduced working set with `stats` and `list`.
5. Recover with `unhide`, `restore`, or `reset` if the removed material becomes relevant.

This is different from whole-session compaction. The agent selects the working set before the runtime must compact the full conversation. The runtime remains the sole owner of compaction.

## Reproduce the control loop

Install the package and reload Pi:

```sh
pi install npm:@zaycruz/pi-context-manager
```

Use a session with completed work and an active request. Ask the agent to inspect its context without telling it which messages to remove:

> Inspect your current context. Preserve the active request, current constraints, and unresolved decisions. Manage only completed or superseded work. Report the context use before and after the change.

The agent can then use this sequence:

```text
manage_context(action="stats")
manage_context(action="list", limit=25)
manage_context(action="hide", range="<completed-message-range>")
manage_context(action="stats")
```

A successful run has these observable properties:

- The second `stats` result reports tokens saved by context rules.
- The next provider request excludes the selected messages.
- The current user request and active turn remain present.
- A selection containing one side of a tool exchange automatically includes its paired tool call or tool result.
- `unhide` or `reset` restores hidden messages.
- The rules survive process restart and session continuation.

At 30% context use, the extension appends one persisted message that asks the agent to inspect old completed work. At 35%, it appends one persisted message that requires safe context management. Passive monitoring never replaces or modifies the system prompt.

## What the automated tests prove

Run:

```sh
npm ci
npm run check
```

The behavioral suite verifies these contracts:

- `stats` and `list` expose the canonical host context.
- `hide`, `remove`, `unhide`, `restore`, and `reset` persist and reconcile correctly.
- Pi can summarize a selected range and restore its original messages.
- OMP rejects `summarize` without changing state because OMP does not expose model completion to extensions.
- The extension rejects changes to the active turn.
- Tool calls and tool results remain paired.
- A threshold notice is persisted once, retries if persistence fails, and does not replace Pi's string system prompt or OMP's system-prompt array.
- A direct jump above 35% emits the 30% notice before the 35% notice.

The relevant tests are in [`tests/extension.cjs`](../tests/extension.cjs) and [`tests/context-policy.test.ts`](../tests/context-policy.test.ts).

## Measured cache evidence

We compared the cache-safe implementation at commit `0dce5f7` with the dynamic-system-prompt baseline at commit `fc2e224`.

The repository includes the [benchmark harness](../benchmarks/cache-prefix/run.mjs), [reproduction procedure](../benchmarks/cache-prefix/README.md), and [raw usage records](../benchmarks/cache-prefix/results/). Reproduce a run with:

```sh
node benchmarks/cache-prefix/run.mjs > /tmp/pi-context-cache-result.json
```

The first recorded run used Pi 0.84.3, Node.js v25.5.0, `openai-codex/gpt-5.4-mini`, and `README.md` from commit `0dce5f7` as the immutable fixture. Each arm had one warm-up turn and three measured continuation turns. Each continuation started a fresh Pi process.

| Turn | Fixed uncached input | Fixed cache read | Fixed output | Fixed cost | Baseline uncached input | Baseline cache read | Baseline output | Baseline cost |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2 | 1,722 | 3,072 | 19 | $0.00160740 | 4,835 | 0 | 20 | $0.00371625 |
| 3 | 1,563 | 4,608 | 21 | $0.00161235 | 6,212 | 0 | 20 | $0.00474900 |
| 4 | 1,916 | 5,632 | 21 | $0.00195390 | 7,589 | 0 | 21 | $0.00578625 |
| **Total** | **5,201** | **13,312** | **61** | **$0.00517365** | **18,636** | **0** | **61** | **$0.01425150** |

The dollar values are the `usage.cost` values returned by Pi's provider adapter. They are not reconstructed from a separate price table.

In the first recorded run:

- The cache-safe arm reused 13,312 of 18,513 prompt tokens: 71.9%.
- The dynamic-prompt baseline reused 0 of 18,636 prompt tokens.
- The cache-safe arm's measured continuation cost was 63.7% lower for this fixture.

The second run reused 13,824 cache tokens in the fixed arm and 1,536 in the baseline. Across both runs, the fixed arm reused 27,136 of 37,179 prompt tokens (73.0%); the baseline reused 1,536 of 37,425 (4.1%). The combined measured continuation cost was 63.3% lower in the fixed arm.

Provider caching is best-effort. These two runs show that the cache-safe arm allowed substantially more provider cache reuse for this model and fixture. They do not establish a provider-wide hit rate or promise a cache hit on every request. Run more repetitions before making a general performance claim.

## Claim boundary

The implementation and tests demonstrate that the agent can observe, selectively transform, persist, and recover its working context within structural safety boundaries. The recorded A/B documents one stable-prefix cache observation with an auditable fixture, harness, and raw usage output.

The repository now includes a [three-arm outcome evaluation](../benchmarks/context-autonomy/README.md) for the remaining task-quality question. It compares full context, one manual runtime compaction, and notice-driven agent management on the same seeded long-context audit.

The evaluation measures:

- canonical-field accuracy and full-task pass rate;
- superseded-decoy errors;
- prompt tokens and measured provider cost;
- autonomous context actions;
- human context interventions; and
- provider failures.

The hardened clean-commit three-seed run did not meet that bar. Full context and manual runtime compaction each returned 36 of 36 fields. Agent-managed context returned 31 of 36 fields and passed 2 of 3 complete tasks. It attempted autonomous management in all three trials but met the exact-output and meaningful-final-savings criterion in only 1 of 3. One exact trial restored its summary and ended with no active rules. Another trial hid old ranges, saved 75,177 active-rule tokens, and returned only 7 of 12 fields. The managed arm's measured cost was also higher than both comparison arms.

Do not claim a task-quality or cost improvement from this result. The narrow measured result is that the agent autonomously achieved meaningful context reduction while preserving every field in 1 of 3 trials. Safe lossless range selection remains the load-bearing unproven boundary.
