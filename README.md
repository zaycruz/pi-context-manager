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
| `list` | Show the current context with indices, token estimates, active rules, and `SUMMARIZE-ONLY` safety tags. |
| `stats` | Show context usage against the model's context window (tokens, cap, percent, tokens saved by rules). |
| `hide` | Temporarily exclude short plain-assistant-text messages. Each message must be at most 128 estimated tokens. The closed selection must be at most 512 estimated tokens. |
| `unhide` | Bring hidden messages back. |
| `remove` | Exclude short plain-assistant-text messages until `reset`. It uses the same 128-token message limit and 512-token selection limit as `hide`. |
| `summarize` | Replace messages with one model-generated summary block. Use it for user content, facts, constraints, tool exchanges, and other durable context. Pi supports this action through `modelRegistry.complete`. OMP returns an error and changes nothing because its extension context does not expose that method. |
| `restore` | Bring summarized messages back (by summary id). |
| `reset` | Clear all rules. |

## Context-usage threshold notices

The extension never changes the system prompt.

When usage first reaches 30%, the extension appends one persisted conversation message that asks the agent to inspect old completed messages. When usage first reaches 35%, it appends one persisted conversation message that requires the agent to summarize durable completed context. The notice limits `hide` and `remove` to short plain assistant text. The extension does not append another notice at the same threshold.

Usage below 30% resets the notification cycle. A later crossing can then append new 30% and 35% notices.

This append-only design keeps the existing provider prompt prefix stable during passive monitoring. An explicit `hide`, `remove`, `summarize`, `unhide`, `restore`, or `reset` action changes provider context by design.

The runtime is the sole owner of whole-session compaction. The extension never calls, cancels, or suppresses runtime compaction. Manual, threshold, and overflow compaction continue through the runtime's normal safety path.

### Parameters

- `range`: `"3"`, `"3-10"`, `"3,5,7"`, or `"all"`. `all` targets completed messages before the current request. The parser rejects the complete range when any component is malformed or is not a positive safe integer. It clamps valid endpoints before expansion. The action still enforces its selection limits. For `restore`, use the summary id shown by `list`.
- `limit`: for `list`, how many trailing messages to show (default 25).
- `model`: for `summarize`, a model id like `google/gemini-2.5-flash` (default: the active model).

If you set `model`, use `provider/model`. The action returns an error without sending messages when the selector is malformed or unavailable.

## Selection safety

The extension marks messages that `hide` and `remove` cannot select as `SUMMARIZE-ONLY` in `list`.

`hide` and `remove` accept only plain assistant text. Each selected message must contain only text and must be at most 128 estimated tokens. The full tool-pair-closed selection must be at most 512 estimated tokens. The extension rejects user messages, tool calls, tool results, summaries, thinking, images, custom messages, and larger selections. Use `summarize` for those messages.

The extension rejects any `hide`, `remove`, or `summarize` selection that includes the latest user request or the active turn.

The first context event after this policy upgrade clears all existing `hide` and `remove` rules. The extension cannot reconstruct the original selection groupings needed to prove the new limits. It preserves valid summaries and notification state.

Some provider protocols require each `toolResult` to match a preceding `toolCall`. An orphaned result can cause repeated provider-request failures while the malformed context remains. The extension auto-extends each summary selection so tool calls stay paired with their results. It also applies this closure defensively in the `context` handler, so hand-edited state cannot produce an orphaned `toolResult`.

The tool output reports when the selection was auto-extended.

## Runtime support

- **pi**: all actions work, including `summarize` through `modelRegistry.complete`.
- **OMP**: `list`, `stats`, guarded `hide`, `unhide`, guarded `remove`, `restore`, and `reset` work. `summarize` is unavailable because OMP's extension context does not expose a model-completion API. The 35% notice tells OMP agents to leave durable content to runtime-owned compaction. OMP can remove only short plain assistant text and cannot perform durable-context reduction through this extension.

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
