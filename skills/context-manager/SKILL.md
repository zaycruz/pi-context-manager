---
name: context-manager
description: Manage the agent's own conversation context with the manage_context tool. Review context at 30% usage and act by 35% before runtime-owned compaction.
---

# Context Manager

The `manage_context` tool lets you manage your own conversation context without compacting the whole session. You can hide, unhide, remove, or summarize old messages. Hidden and removed messages stay in the session file but are filtered from the context sent to the model. Summaries replace a range of messages with a condensed version.

## When to use

- At 30% context usage, call `manage_context action=stats` and then `action=list`.
- At 35% context usage, hide, remove, or summarize old completed messages before OMP can compact at roughly 40%.
- Use the tool when old exchanges are no longer needed or when you must free context without losing session history.

## Workflow

1. Call `manage_context action=stats` to see context usage against the model's context window.
2. Call `manage_context action=list` to see the current context with message indices.
3. Choose old, completed exchanges to manage. Do not hide or remove the current user request or your own in-progress work.
4. Apply the action:
   - `hide` removes messages from context but keeps them in the session. You can bring them back with `unhide`.
   - `remove` drops messages from context without a per-range restore action. Use `reset` to clear all removal rules.
   - `summarize` replaces a range with a condensed summary. You can bring the originals back with `restore`.
5. Verify with `action=list` that the context looks right.

The runtime owns whole-session compaction. Do not start or suppress compaction through this tool.

## Actions

| Action | Purpose |
|--------|---------|
| `list` | Show the current context with message indices. Use `limit` to control how many trailing messages are shown (default 25). |
| `stats` | Show context usage: tokens, cap, percent, and tokens saved by context rules. |
| `hide` | Hide messages by range. They stay in the session and can be unhidden. |
| `unhide` | Bring hidden messages back into context. |
| `remove` | Remove messages from context. Use `reset` to clear all removal rules and bring the messages back. |
| `summarize` | Replace a range with a summary. Optionally pass `model` as `provider/model`. Pi supports this action through `modelRegistry.complete`. OMP returns an error and changes nothing. |
| `restore` | Remove a summary rule and bring the original messages back. Pass the summary id shown by `list` as `range`. |
| `reset` | Clear all context rules. |

## Ranges

Ranges are 1-based message indices shown by `action=list`:

- `3` a single message
- `3-10` a range
- `3,5,7` specific messages
- `all` every completed message before the current user request

## Safety

- Tool calls stay paired with their results automatically. Hiding, removing, or summarizing one side also affects the other so the context stays valid. You do not need to manage that.
- The tool rejects a range that includes the latest user request or the active turn.
- You cannot hide, remove, or summarize a range that overlaps an existing summary. Restore it first with `action=restore range=<id>`.
- The tool lists the exact canonical context supplied by the host.
- Each context event removes rules for messages that no longer exist. A summary rule is dropped if any source message is absent.
- Hidden and removed messages remain in the session file. Use `unhide` for hidden messages. Use `reset` to clear all rules.
