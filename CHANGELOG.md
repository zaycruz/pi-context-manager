# Changelog

## 1.1.0

First scoped npm release as `@zaycruz/pi-context-manager`.

- Make Pi and OMP the sole owners of whole-session compaction.
- Start context review at 30% usage and require management at 35% usage.
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
