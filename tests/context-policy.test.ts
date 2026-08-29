import assert from "node:assert/strict";
import test from "node:test";

import {
  contextIndicatorLine,
  reconcileState,
  statesEqual,
  type ContextState,
} from "../extensions/context-policy.ts";

const summary = {
  id: "summary-1",
  fingerprints: ["first", "second"],
  summary: "Earlier work",
  model: "test/model",
  createdAt: 1,
  tokensBefore: 64,
};

test("reconcileState removes inactive hidden and removed fingerprints", () => {
  const state: ContextState = {
    hidden: ["active", "stale-hidden"],
    removed: ["active-removed", "stale-removed"],
    summaries: [],
  };

  assert.deepEqual(reconcileState(state, ["active", "active-removed"]), {
    hidden: ["active"],
    removed: ["active-removed"],
    summaries: [],
  });
});

test("reconcileState drops a summary when any source message is inactive", () => {
  const state: ContextState = { hidden: [], removed: [], summaries: [summary] };
  assert.deepEqual(reconcileState(state, ["first"]).summaries, []);
});

test("reconcileState retains a summary while every source message is active", () => {
  const state: ContextState = { hidden: [], removed: [], summaries: [summary] };
  assert.deepEqual(reconcileState(state, ["first", "second"]).summaries, [summary]);
});

test("statesEqual compares the persisted rule value", () => {
  const left: ContextState = { hidden: ["one"], removed: [], summaries: [] };
  assert.equal(statesEqual(left, structuredClone(left)), true);
  assert.equal(statesEqual(left, { ...left, hidden: ["two"] }), false);
});

test("context indicator escalates before runtime compaction", () => {
  assert.match(contextIndicatorLine(29, "29%", ""), /reaches 30%/);
  assert.match(contextIndicatorLine(30, "30%", ""), /at or above 30%/);
  assert.match(contextIndicatorLine(35, "35%", ""), /MUST call manage_context/);
  assert.match(contextIndicatorLine(35, "35%", ""), /runtime-owned idle compaction/);
});
