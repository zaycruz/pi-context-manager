# Changelog

## Unreleased

- Add a reproducible three-arm long-context outcome evaluation with strict scoring and raw evidence.
- Make threshold notices retry after failed host persistence without duplicating within one agent turn.
- Report active-rule token savings on every state-changing context action.
- Preserve nested summary usage and provider failures in benchmark accounting.
- Strengthen summary guidance for exact durable constraints and meaningful context reduction.

## 1.1.0

First scoped npm release as `@zaycruz/pi-context-manager`.

- Make Pi and OMP the sole owners of whole-session compaction.
- Append one persisted notice at each 30% and 35% threshold crossing without changing the system prompt.
- Use the host's canonical `context` event messages for tool indices.
- Apply context-management rules to runtime compaction preparation.
- Reconcile stale context rules on each canonical context event.
- Migrate persisted 1.0.x rules to full-message fingerprints without failing open on collisions.
- Preserve split-turn preparation buckets and filter OMP remote-compaction recent messages.
- Use Pi host-provided peer modules instead of bundled core-module copies.
- Preserve tool-call and tool-result pairs during context management.
- Add public npm packaging, automated checks, and clean-install coverage.

## 1.0.0

- Add `manage_context` actions for listing, inspecting, hiding, removing, summarizing, restoring, and resetting conversation context.
- Persist context rules in session entries without rewriting message history.
