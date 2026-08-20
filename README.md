# pi-context-manager

A pi extension that lets the agent manage its own conversation context: hide, remove, or summarize portions of the session without compacting the whole session.

## How it works

- The `context` event fires before every LLM call with a deep copy of the messages. The extension returns `{ messages }` with hidden/removed messages dropped and summaries injected, so the session file is never modified.
- Rules are persisted as a custom session entry (`customType: "context-manager-state"`) via `pi.appendEntry`, so they survive restarts and `-c` continuation.
- Messages are identified by a SHA-256 fingerprint of `role|timestamp|content` (16 hex chars), so rules survive message edits and reloads.

## Tool: `manage_context`

| Action | Description |
|---|---|
| `list` | Show the current context with indices, token estimate, and active rules. |
| `stats` | Show context usage against the model's context window (tokens, cap, percent, tokens saved by rules). |
| `hide` | Exclude messages from context until unhidden. |
| `unhide` | Bring hidden messages back. |
| `remove` | Permanently remove messages from context (for this session). |
| `summarize` | Replace messages with a single summary block (model-generated). Requires the runtime's `modelRegistry.complete` (pi). In OMP, where that method is absent, `summarize` returns a clear error and changes nothing. |
| `restore` | Bring summarized messages back (by summary id). |
| `reset` | Clear all rules. |

## Context-usage indicator

Before every agent turn, the extension appends a compact usage line to the system prompt. The wording escalates with usage so the agent acts on its own before hitting the cap:

```
# below 40% — advisory
[Context usage: 12% of 128k (15,000 tokens). If usage is at or above 40%, call manage_context action=stats for details, then hide, remove, or summarize old messages.]

# 40-60% — directive
[Context usage: 45% of 128k (58,000 tokens). Usage is at or above 40% — call manage_context action=stats for details, then hide, remove, or summarize old messages to stay under the cap. OMP auto-compacts during idle at roughly 40% usage; act before that to keep control over what gets trimmed.]

# 60%+ — imperative
[Context usage: 65% of 128k (83,000 tokens). Usage is at or above 60% — you MUST call manage_context action=stats now, then action=list to see old messages, then hide, remove, or summarize them to stay under the cap. OMP auto-compacts during idle; act before that to keep control over what gets trimmed.]
```

This gives the agent a standing signal of how full its context is against the model's context window, so it can decide to manage its own context before hitting the cap. `action=stats` returns the same numbers plus the tokens saved by active rules.

### Parameters

- `range`: `"3"`, `"3-10"`, `"3,5,7"`, or `"all"`. For `restore`: the summary id shown by `list`.
- `limit`: for `list`, how many trailing messages to show (default 25).
- `model`: for `summarize`, a model id like `google/gemini-2.5-flash` (default: the active model).

## Safety: tool-call pairing

A `toolResult` without its preceding `toolCall` is rejected by providers (HTTP 400) on every subsequent call, which would brick the session. The extension therefore auto-extends any selection so tool calls stay paired with their results:

- Hiding/removing/summarizing a `toolResult` also includes its `toolCall` assistant message.
- Hiding/removing/summarizing an assistant message with tool calls also includes its `toolResult` messages.
- The same closure is applied defensively in the `context` handler, so even hand-edited state cannot produce an orphaned `toolResult`.

The tool output reports when the selection was auto-extended.

## Runtime support

- **pi**: all actions work, including `summarize` (via `modelRegistry.complete`).
- **OMP**: `list`, `stats`, `hide`, `unhide`, `remove`, `restore`, and `reset` work. `summarize` is unavailable because OMP's extension context does not expose a model-completion API; the action returns a clear error instead of crashing.

## Usage

```sh
# Load for one session
pi -e ./extensions/context-manager.ts

# Install globally
pi install ./pi-context-manager
```

## Development

- `extensions/context-manager.ts` — the single-file extension.
- Test with a 3-turn session: seed a secret, hide it, then ask for it. The model answering `UNKNOWN` proves the filter works.
