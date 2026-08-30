# @zaycruz/pi-context-manager

A Pi package that lets Pi and OMP agents inspect and selectively manage conversation context before runtime-owned compaction.

See the [agent-managed context example and measured evidence](https://github.com/zaycruz/pi-context-manager/blob/main/examples/agent-managed-context.md) for the control loop, safety contracts, cache A/B, and current claim boundary.

## Install

Install the public npm package:

```sh
pi install npm:@zaycruz/pi-context-manager
```

Install the latest GitHub revision:

```sh
pi install git:github.com/zaycruz/pi-context-manager
```

Start a new session or run `/reload` in an open session. The agent receives the `manage_context` tool and the bundled context-management skill.

Requirements: Node.js 22.19 or later and Pi 0.84 or later. OMP supports the actions listed under [Runtime support](#runtime-support).

## How it works

- Before each LLM call, the host sends the canonical message array through the `context` event. The extension caches that exact array for tool indices and returns a managed copy with hidden or removed messages omitted and summaries inserted. It does not reconstruct context from session entries.
- Rules persist as a custom session entry (`customType: "pi-context-manager-state"`) through `pi.appendEntry`. They survive restarts and `-c` continuation.
- Each message uses a 128-bit SHA-256 fingerprint of its full canonical value. The fingerprint includes tool-call and tool-result identity fields.
- Each `context` event reconciles rules against the host-provided messages. The extension drops an entire summary rule if any source message is absent. It migrates legacy 1.0.x fingerprints against the canonical snapshot and maps collisions to every matching message.
- Before runtime compaction, the extension applies the same rules to each host preparation bucket without changing split-turn boundaries. It also removes managed file operations from the derived file lists.

## Tool: `manage_context`

| Action | Description |
|---|---|
| `list` | Show the current context with indices, token estimate, and active rules. |
| `stats` | Show context usage against the model's context window (tokens, cap, percent, tokens saved by rules). |
| `hide` | Exclude messages from context until unhidden. |
| `unhide` | Bring hidden messages back. |
| `remove` | Exclude messages from context without a per-range restore action. `reset` clears removal rules and brings the messages back. |
| `summarize` | Replace messages with one model-generated summary block. Pi supports this action through `modelRegistry.complete`. OMP returns an error and changes nothing because its extension context does not expose that method. |
| `restore` | Bring summarized messages back (by summary id). |
| `reset` | Clear all rules. |

## Context-usage threshold notices

The extension never changes the system prompt.

When usage first reaches 30%, the extension appends one persisted conversation message that asks the agent to inspect old completed messages. When usage first reaches 35%, it appends one persisted conversation message that requires the agent to manage safe old context. The extension does not append another notice at the same threshold.

Usage below 30% resets the notification cycle. A later crossing can then append new 30% and 35% notices.

This append-only design keeps the existing provider prompt prefix stable during passive monitoring. An explicit `hide`, `remove`, `summarize`, `unhide`, `restore`, or `reset` action changes provider context by design.

The runtime is the sole owner of whole-session compaction. The extension never calls, cancels, or suppresses runtime compaction. Manual, threshold, and overflow compaction continue through the runtime's normal safety path.

### Parameters

- `range`: `"3"`, `"3-10"`, `"3,5,7"`, or `"all"`. Destructive `all` targets completed messages before the current request. For `restore`, use the summary id shown by `list`.
- `limit`: for `list`, how many trailing messages to show (default 25).
- `model`: for `summarize`, a model id like `google/gemini-2.5-flash` (default: the active model).

If you set `model`, use `provider/model`. The action returns an error without sending messages when the selector is malformed or unavailable.

## Safety: tool-call pairing

Some provider protocols require each `toolResult` to match a preceding `toolCall`. An orphaned result can cause repeated provider-request failures while the malformed context remains. The extension therefore auto-extends each selection so tool calls stay paired with their results:

- Hiding/removing/summarizing a `toolResult` also includes its `toolCall` assistant message.
- Hiding/removing/summarizing an assistant message with tool calls also includes its `toolResult` messages.
- The same closure is applied defensively in the `context` handler, so even hand-edited state cannot produce an orphaned `toolResult`.

The tool output reports when the selection was auto-extended.

The extension rejects any `hide`, `remove`, or `summarize` selection that includes the latest user request or the active turn.

## Runtime support

- **pi**: all actions work, including `summarize` (via `modelRegistry.complete`).
- **OMP**: `list`, `stats`, `hide`, `unhide`, `remove`, `restore`, and `reset` work. `summarize` is unavailable because OMP's extension context does not expose a model-completion API; the action returns a clear error instead of crashing.

## Privacy

- `list`, `stats`, `hide`, `unhide`, `remove`, `restore`, and `reset` make no separate model or API request. Their tool-result content enters the conversation and is sent to the active provider on the next model call.
- `list` includes short previews of canonical messages, including messages currently marked hidden, removed, or summarized. Do not use `list` after switching to a provider that must not receive those previews.
- `summarize` sends the selected messages to the chosen model through Pi's model registry. The summarization prompt treats the selected transcript as untrusted inert data. The returned summary then enters the active conversation.
- The package does not write usage telemetry.
- The package does not start, cancel, or replace runtime compaction.

## Remove

Remove the npm installation:

```sh
pi remove npm:@zaycruz/pi-context-manager
```

Use `git:github.com/zaycruz/pi-context-manager` instead when you installed the Git source.

## Development

```sh
npm ci
npm run check
```

`npm run check` runs behavioral tests, strict TypeScript checks, the cyclomatic-complexity limit, a packed-consumer test, and an npm package-content check.
