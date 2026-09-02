# Agent-managed context: example and evidence

`pi-context-manager` gives an agent a bounded control loop for its own working context:

1. Observe context use with `stats`.
2. Inspect message types, token estimates, and structural safety tags with `list`.
3. Decide which completed context is no longer needed.
4. Reversibly hide completed tool exchanges whose raw output is no longer useful.
5. Summarize durable context when model-backed summarization is available.
6. Verify the reduced working set with `stats` and `list`.
7. Recover with `unhide`, `restore`, or `reset` if the managed material becomes relevant.

The LLM owns the semantic selection. The extension supplies structure and token estimates but does not rank importance. This process is different from whole-session compaction. The runtime remains the sole owner of compaction.

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
manage_context(action="hide", range="<completed-tool-exchange-range>")
manage_context(action="stats")
```

Selecting either side of a completed tool exchange hides the call and every matching result. Pi can also summarize durable ranges. OMP cannot summarize because its extension API does not expose model completion, but it can reversibly hide completed tool exchanges.

A successful run has these observable properties:

- The second `stats` result reports tokens saved by context rules.
- The next provider request excludes the selected tool call and all matching results.
- The current user request and active turn remain present.
- `unhide` or `reset` restores the complete exchange.
- `remove` still rejects tool exchanges.
- Orphaned results and incomplete calls cannot be hidden.
- The rules survive process restart and session continuation.

At 30% context use, the extension appends one persisted message that asks the agent to inspect old completed work. At 35%, it asks the LLM to decide which completed context it no longer needs. `hide` accepts complete tool exchanges of any size. `remove` remains limited to plain assistant text with at most 128 estimated tokens per message and 512 estimated tokens per selection. Passive monitoring never replaces or modifies the system prompt.

## What the automated tests prove

Run:

```sh
npm ci
npm run check
```

The behavioral suite verifies these contracts:

- `stats` and `list` expose canonical host context, per-message token estimates, and structural tool-exchange tags.
- Completed tool calls and all matching results hide and unhide together from either selected side.
- Large and failed completed tool outputs remain structurally hideable because the LLM owns the semantic decision.
- `remove` rejects every tool exchange.
- Orphaned results, incomplete calls, user content, summaries, unrelated rich content, and active-turn content cannot be hidden.
- Mixed tool-plus-short-assistant selections work, while mixed tool-plus-user selections fail without persisted mutation.
- The plain-assistant guard enforces its exact 128-token message and 512-token selection boundaries for block-array and string-form content.
- Range parsing rejects malformed or unsafe numeric input without partial action or unbounded expansion.
- Policy migration restores all pre-policy hidden and removed messages while preserving valid summaries.
- Pi can summarize a selected range and restore its original messages.
- OMP rejects `summarize` without changing state because OMP does not expose model completion to extensions.
- Tool calls and tool results remain paired during context rendering and runtime compaction.
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
- prompt tokens, audit-continuation usage, and measured provider cost;
- autonomous context actions;
- human context interventions; and
- provider failures.

The hardened clean-commit three-arm run did not meet that bar. Full context and manual runtime compaction each returned 36 of 36 fields. Agent-managed context returned 31 of 36 fields and passed 2 of 3 complete tasks. It attempted autonomous management in all three trials but met the exact-output and meaningful-final-savings criterion in only 1 of 3. One exact trial restored its summary and ended with no active rules. Another trial hid old ranges, saved 75,177 active-rule tokens, and returned only 7 of 12 fields.

We then added the lossless-selection guard and reran the three managed seeds from clean commit `5790f77`. The agent summarized context in every trial and did not use `hide` or `remove`. It returned 35 of 36 fields, passed 2 of 3 complete tasks, met the autonomous-success criterion in 2 of 3 trials, and ended with 335,476 active-rule tokens saved. The only miss was one `queue_name` value returned as `null`.

This one-arm follow-up is directional evidence. It does not prove a task-quality or cost improvement because provider behavior is nondeterministic and the comparison arms were not rerun. The previous range-hiding failure did not recur. Summary fidelity is now the observed failure boundary.

The clean-commit `tool-outputs` run then exercised LLM-selected completed-tool hiding directly. All three arms returned 36 of 36 fields and passed all three tasks. Every managed trial hid all three labeled filler tool exchanges, succeeded autonomously, and together saved 334,582 active-rule tokens. Managed audit-continuation tokens were 96.1% lower than full context, while total tokens were 6.0% lower.

The feature did not beat manual runtime compaction or reduce total cost in that run. Managed total cost was 35.8% above full context and 44.3% above runtime compaction. The result proves the structural path and shows correct semantic selection on this labeled fixture. It does not prove a general break-even point or correct classification of arbitrary production evidence.
