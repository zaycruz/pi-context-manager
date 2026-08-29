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

Test conditions:

- Runtime: Pi
- Model: `openai-codex/gpt-5.4-mini`
- One uncached warm-up turn per arm
- Three continuation turns, each started in a fresh Pi process
- Matched large-context fixture and turn structure

| Continuation turn | Cache-safe implementation | Dynamic-prompt baseline |
|---:|---:|---:|
| 2 | 3,072 cache-read tokens | 0 |
| 3 | 4,608 cache-read tokens | 0 |
| 4 | 5,632 cache-read tokens | 0 |
| **Total** | **13,312** | **0** |

Across the measured continuation turns:

- The cache-safe arm reused 13,312 of 18,513 prompt tokens: 71.9%.
- The dynamic-prompt baseline reused 0 of 18,636 prompt tokens.
- The cache-safe arm cost $0.00517365.
- The dynamic-prompt baseline cost $0.01425150.
- The measured cost reduction for this fixture was 63.7%.

Provider caching is best-effort. This result proves that passive context monitoring no longer systematically invalidates the prompt prefix. It does not promise a cache hit on every request.

## Claim boundary

The implementation and tests prove that the agent can observe, selectively transform, persist, and recover its working context within structural safety boundaries. The cache A/B proves the stable-prefix efficiency improvement.

They do not yet prove that agent-directed context management improves long-horizon task quality. That requires a separate evaluation against no-manager and runtime-compaction-only baselines. That evaluation must measure:

- final task score;
- critical-constraint retention;
- irrelevant-token reduction;
- prompt tokens per turn;
- turns before runtime compaction;
- human interventions;
- active-turn and tool-pair violations; and
- recovery after an intentionally bad context decision.

The strongest outcome claim will be: the managed arm uses materially fewer prompt tokens without reducing task score or critical-constraint retention.
