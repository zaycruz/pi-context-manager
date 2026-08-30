import assert from "node:assert/strict";
import test from "node:test";

import {
  contextNotificationText,
  nextNotificationLevel,
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
    notificationLevel: 30,
    policyVersion: 1,
  };

  assert.deepEqual(reconcileState(state, ["active", "active-removed"]), {
    hidden: ["active"],
    removed: ["active-removed"],
    summaries: [],
    notificationLevel: 30,
    policyVersion: 1,
  });
});

test("reconcileState drops a summary when any source message is inactive", () => {
  const state: ContextState = {
    hidden: [],
    removed: [],
    summaries: [summary],
    notificationLevel: 0,
    policyVersion: 1,
  };
  assert.deepEqual(reconcileState(state, ["first"]).summaries, []);
});

test("reconcileState retains a summary while every source message is active", () => {
  const state: ContextState = {
    hidden: [],
    removed: [],
    summaries: [summary],
    notificationLevel: 0,
    policyVersion: 1,
  };
  assert.deepEqual(reconcileState(state, ["first", "second"]).summaries, [summary]);
});

test("statesEqual compares the persisted rule value", () => {
  const left: ContextState = {
    hidden: ["one"],
    removed: [],
    summaries: [],
    notificationLevel: 0,
    policyVersion: 1,
  };
  assert.equal(statesEqual(left, structuredClone(left)), true);
  assert.equal(statesEqual(left, { ...left, hidden: ["two"] }), false);
});

test("notification levels emit only on threshold crossings", () => {
  assert.equal(nextNotificationLevel(29, 0), undefined);
  assert.equal(nextNotificationLevel(30, 0), 30);
  assert.equal(nextNotificationLevel(34, 30), undefined);
  assert.equal(nextNotificationLevel(35, 30), 35);
  assert.equal(nextNotificationLevel(40, 35), undefined);
  assert.equal(nextNotificationLevel(29, 35), 0);
  assert.equal(nextNotificationLevel(35, 0), 30);
  assert.equal(nextNotificationLevel(35, 30), 35);
  assert.equal(nextNotificationLevel(35, 35), undefined);
});

test("notification text describes the crossed threshold", () => {
  assert.match(contextNotificationText(30, "30%", ""), /Usage reached 30%/);
  assert.match(contextNotificationText(35, "35%", ""), /Usage reached 35%/);
  assert.match(contextNotificationText(35, "35%", ""), /runtime-owned compaction/);
  assert.match(contextNotificationText(35, "35%", ""), /plain assistant text/);
  assert.match(contextNotificationText(35, "35%", ""), /128 tokens/);
  assert.match(contextNotificationText(35, "35%", ""), /512 tokens total/);
  const ompText = contextNotificationText(35, "35%", "", false);
  assert.match(ompText, /cannot summarize through manage_context/);
  assert.match(ompText, /runtime-owned compaction/);
});
