import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateTrials,
  combineUsage,
  extractJsonObject,
  scoreAnswer,
} from "../benchmarks/context-autonomy/score.mjs";
import { createFixture } from "../benchmarks/context-autonomy/fixtures.mjs";


test("extractJsonObject accepts raw, fenced, and prose-wrapped objects", () => {
  assert.deepEqual(extractJsonObject('{"a":"b"}'), { a: "b" });
  assert.deepEqual(extractJsonObject('```json\n{"a":"b"}\n```'), { a: "b" });
  assert.deepEqual(extractJsonObject('Result: {"a":"b"} done.'), { a: "b" });
});

test("scoreAnswer reports exact, missing, wrong, and decoy fields", () => {
  const expected = { a: "current-a", b: "current-b", c: "current-c" };
  const decoys = { b: ["old-b"], c: ["old-c"] };
  const score = scoreAnswer('{"a":"current-a","b":"old-b"}', expected, decoys);
  assert.equal(score.correct, 1);
  assert.equal(score.total, 3);
  assert.equal(score.exact, false);
  assert.deepEqual(score.missing, ["c"]);
  assert.deepEqual(score.wrong, [{ key: "b", expected: "current-b", actual: "old-b" }]);
  assert.deepEqual(score.decoyErrors, ["b"]);
});

test("fixtures retain every canonical fact and superseded decoy across insertion collisions", () => {
  for (const seed of [1, 2, 3]) {
    const fixture = createFixture(seed);
    assert.equal(Object.keys(fixture.facts).length, 12);
    for (const [key, value] of Object.entries(fixture.facts)) {
      assert.equal(fixture.fixture.includes(`CANONICAL_FACT ${key}=${JSON.stringify(value)}`), true);
      for (const decoy of fixture.decoys[key]) {
        assert.equal(fixture.fixture.includes(`SUPERSEDED_FACT ${key}=${JSON.stringify(decoy)}`), true);
      }
    }
  }
});

test("combineUsage sums provider tokens and costs", () => {
  const usage = combineUsage([
    { input: 10, output: 2, cacheRead: 4, totalTokens: 16, cost: { total: 0.1 } },
    { input: 20, output: 3, cacheRead: 8, reasoning: 1, totalTokens: 32, cost: { total: 0.2 } },
  ]);
  assert.deepEqual(
    { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, reasoning: usage.reasoning, totalTokens: usage.totalTokens, totalCost: usage.cost.total },
    { input: 30, output: 5, cacheRead: 12, reasoning: 1, totalTokens: 48, totalCost: 0.30000000000000004 },
  );
});

test("aggregateTrials excludes invalid trials and computes outcome rates", () => {
  const base = {
    valid: true,
    providerErrors: [],
    measuredUsage: { input: 10, output: 1, totalTokens: 11, cost: { total: 0.01 } },
  };
  const aggregate = aggregateTrials([
    { ...base, autonomyAttempted: true, autonomySuccess: true, contextTokensSaved: 4000, score: { correct: 12, total: 12, exact: true, decoyErrors: [] } },
    { ...base, autonomyAttempted: true, autonomySuccess: false, contextTokensSaved: 9, score: { correct: 9, total: 12, exact: false, decoyErrors: ["a"] } },
    { ...base, valid: false, autonomyAttempted: false, autonomySuccess: false, contextTokensSaved: 0, score: { correct: 0, total: 12, exact: false, decoyErrors: [] } },
  ]);
  assert.equal(aggregate.validTrials, 2);
  assert.equal(aggregate.invalidTrials, 1);
  assert.equal(aggregate.fieldAccuracy, 21 / 24);
  assert.equal(aggregate.fullTaskPassRate, 0.5);
  assert.equal(aggregate.autonomySuccessRate, 0.5);
  assert.equal(aggregate.autonomyAttemptRate, 1);
  assert.equal(aggregate.contextTokensSaved, 4009);
  assert.equal(aggregate.decoyErrors, 1);
});
