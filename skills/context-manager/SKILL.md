---
name: context-manager
description: Manage the agent's own conversation context with the manage_context tool. Hide, remove, or summarize old messages instead of compacting the whole session. Use when context usage is high (roughly 80% of the model's context window) or when the conversation has grown large.
---

# Context Manager

The `manage_context` tool lets you manage your own conversation context without compacting the whole session. You can hide, unhide, remove, or summarize old messages. Hidden and removed messages stay in the session file but are filtered from the context sent to the model. Summaries replace a range of messages with a condensed version.

## When to use

- The context-usage indicator in your system prompt shows high usage (roughly 80% or more of the model's context window).
- The conversation has grown large and old exchanges are no longer needed.
- You want to free context without losing the session history.

## Workflow

1. Call `manage_context action=stats` to see context usage against the model's context window.
2. Call `manage_context action=list` to see the current context with message indices.
3. Choose old, completed exchanges to manage. Do not hide or remove the current user request or your own in-progress work.
4. Apply the action:
   - `hide` removes messages from context but keeps them in the session. You can bring them back with `unhide`.
   - `remove` drops messages from context permanently for this session.
   - `summarize` replaces a range with a condensed summary. You can bring the originals back with `restore`.
5. Verify with `action=list` that the context looks right.

## Actions

| Action | Purpose |
|--------|---------|
| `list` | Show the current context with message indices. Use `limit` to control how many trailing messages are shown (default 25). |
| `stats` | Show context usage: tokens, cap, percent, and tokens saved by context rules. |
| `hide` | Hide messages by range. They stay in the session and can be unhidden. |
| `unhide` | Bring hidden messages back into context. |
| `remove` | Remove messages from context permanently. |
| `summarize` | Replace a range with a summary. Optionally pass `model` like `google/gemini-2.5-flash`. |
| `restore` | Remove a summary rule and bring the original messages back. Pass the summary id shown by `list` as `range`. |
| `reset` | Clear all context rules. |

## Ranges

Ranges are 1-based message indices shown by `action=list`:

- `3` a single message
- `3-10` a range
- `3,5,7` specific messages
- `all` everything

## Safety

- Tool calls stay paired with their results automatically. Hiding, removing, or summarizing one side also affects the other so the context stays valid. You do not need to manage that.
- Do not hide or remove the current user request or your own in-progress work. Target old, completed exchanges only.
- You cannot hide, remove, or summarize a range that overlaps an existing summary. Restore it first with `action=restore range=<id>`.
- Hidden messages are not deleted. They remain in the session file and can be unhidden.
