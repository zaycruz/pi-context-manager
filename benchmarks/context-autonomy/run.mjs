#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PREPARATION_PROMPT,
  createFixture,
  fixtureChunks,
  loadPrompt,
  queryPrompt,
} from "./fixtures.mjs";
import { PiRpcClient } from "./rpc-client.mjs";
import { aggregateTrials, combineUsage, scoreAnswer } from "./score.mjs";

const ALL_ARMS = ["full-context", "runtime-compaction", "agent-managed"];
const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(benchmarkDir, "../..");
const extension = join(repo, "extensions/context-manager.ts");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}

function numberOption(name, fallback) {
  const value = Number(option(name, fallback));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be positive`);
  return value;
}

function listOption(name, fallback) {
  return option(name, fallback).split(",").map((value) => value.trim()).filter(Boolean);
}

function benchmarkConfig() {
  const arms = listOption("arms", process.env.AUTONOMY_BENCH_ARMS ?? ALL_ARMS.join(","));
  const invalidArm = arms.find((arm) => !ALL_ARMS.includes(arm));
  if (invalidArm) throw new Error(`Unknown arm '${invalidArm}'`);
  return {
    model: option("model", process.env.AUTONOMY_BENCH_MODEL ?? "openai-codex/gpt-5.4-mini"),
    seeds: listOption("seeds", process.env.AUTONOMY_BENCH_SEEDS ?? "1,2,3").map(Number),
    arms,
    targetChars: numberOption("target-chars", process.env.AUTONOMY_BENCH_TARGET_CHARS ?? 440_000),
    timeoutMs: numberOption("timeout-ms", process.env.AUTONOMY_BENCH_TIMEOUT_MS ?? 300_000),
    piBinary: option("pi", process.env.AUTONOMY_BENCH_PI ?? "pi"),
    output: option("output", process.env.AUTONOMY_BENCH_OUTPUT),
  };
}

function piArgs(config, arm, sessionDir, seed) {
  const args = [
    "--mode", "rpc",
    "--model", config.model,
    "--thinking", "minimal",
    "--no-context-files",
    "--no-skills",
    "--no-builtin-tools",
    "--no-extensions",
    "--session-dir", sessionDir,
    "--name", `context-autonomy-${arm}-${seed}`,
  ];
  if (arm === "agent-managed") args.push("--extension", extension);
  return args;
}

function assistantMessages(events) {
  return events
    .filter((event) => event.type === "message_end" && event.message?.role === "assistant")
    .map((event) => event.message);
}

function messageText(message) {
  return (message?.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function finalAnswer(events) {
  return messageText(assistantMessages(events).at(-1));
}

function eventUsage(events) {
  return assistantMessages(events).map((message) => message.usage).filter(Boolean);
}

function toolResultText(result) {
  return (result?.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function recordedContextAction(event, end) {
  const details = end?.result?.details;
  const ok = typeof details?.ok === "boolean" ? details.ok : !end?.isError;
  const savedTokens = Number.isFinite(details?.saved) ? Number(details.saved) : null;
  return {
    toolCallId: event.toolCallId,
    action: event.args?.action,
    args: event.args,
    ok,
    savedTokens,
    result: toolResultText(end?.result),
  };
}

function contextActions(events) {
  const ends = new Map(
    events
      .filter((event) => event.type === "tool_execution_end" && event.toolName === "manage_context")
      .map((event) => [event.toolCallId, event]),
  );
  return events
    .filter((event) => event.type === "tool_execution_start" && event.toolName === "manage_context")
    .map((event) => recordedContextAction(event, ends.get(event.toolCallId)));
}

function lastSavedTokens(actions) {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    if (actions[index].ok && actions[index].savedTokens !== null) {
      return actions[index].savedTokens;
    }
  }
  return 0;
}

function summaryUsage(events) {
  return events
    .filter((event) => event.type === "tool_execution_end" && event.toolName === "manage_context")
    .map((event) => event.result?.details?.completionUsage)
    .filter(Boolean);
}

function providerErrors(events) {
  return assistantMessages(events)
    .filter((message) => message.stopReason === "error" || message.errorMessage)
    .map((message) => message.errorMessage ?? "provider error");
}

async function sessionEntries(path) {
  if (!path) return [];
  const content = await readFile(path, "utf8");
  return content.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function noticeLevels(entries) {
  return entries
    .filter((entry) => entry.type === "custom_message" && entry.customType === "context-manager-threshold")
    .map((entry) => entry.details?.level)
    .filter((level) => level === 30 || level === 35);
}

function finalManagedState(entries) {
  const entry = [...entries].reverse().find(
    (candidate) =>
      candidate.type === "custom" &&
      candidate.customType === "pi-context-manager-state",
  );
  const data = entry?.data ?? {};
  return {
    hidden: Array.isArray(data.hidden) ? data.hidden.length : 0,
    removed: Array.isArray(data.removed) ? data.removed.length : 0,
    summaries: Array.isArray(data.summaries) ? data.summaries.length : 0,
  };
}

function managedRuleCount(state) {
  return state.hidden + state.removed + state.summaries;
}

function combinedScore(queryScores) {
  const correct = queryScores.reduce((sum, score) => sum + score.correct, 0);
  const total = queryScores.reduce((sum, score) => sum + score.total, 0);
  return {
    correct,
    total,
    accuracy: total === 0 ? 0 : correct / total,
    exact: queryScores.every((score) => score.exact),
    decoyErrors: queryScores.flatMap((score) => score.decoyErrors),
    missing: queryScores.flatMap((score) => score.missing),
    wrong: queryScores.flatMap((score) => score.wrong),
  };
}

function lastContextUsage(events, contextWindow) {
  const usage = assistantMessages(events).at(-1)?.usage;
  const tokens = Number(usage?.input ?? 0) + Number(usage?.cacheRead ?? 0);
  return { tokens, contextWindow, percent: contextWindow ? (tokens / contextWindow) * 100 : null };
}

function measuredUsage(events, compactUsage) {
  const main = combineUsage(eventUsage(events));
  const summary = combineUsage(summaryUsage(events));
  const compaction = combineUsage(compactUsage ? [compactUsage] : []);
  return {
    main,
    summary,
    compaction,
    total: combineUsage([main, summary, compaction]),
  };
}

async function executeStages(client, arm, fixture) {
  await client.disableAutoCompaction();
  const state = await client.state();
  const chunks = fixtureChunks(fixture.fixture);
  const stages = { load: [], queries: [] };
  for (let index = 0; index < chunks.length; index += 1) {
    stages.load.push(await client.prompt(loadPrompt(chunks[index], index + 1, chunks.length)));
  }
  stages.preparation = await client.prompt(PREPARATION_PROMPT);
  let compactUsage;
  if (arm === "runtime-compaction") {
    const compacted = await client.compact();
    compactUsage = compacted.response.data?.usage;
    stages.compaction = compacted.events;
  }
  for (const keys of fixture.queryGroups) {
    stages.queries.push(await client.prompt(queryPrompt(keys)));
  }
  return { state, stages, compactUsage };
}

function scoreQueries(answers, fixture) {
  return answers.map((answer, index) => {
    const keys = fixture.queryGroups[index];
    const expected = Object.fromEntries(keys.map((key) => [key, fixture.facts[key]]));
    return scoreAnswer(answer, expected, fixture.decoys);
  });
}

function thresholdStatus(arm, pressure, levels, acted) {
  if (arm !== "agent-managed") return { valid: true, reason: null };
  const escalationObserved = levels.includes(35) || acted;
  const valid = pressure.percent >= 35 && levels.includes(30) && escalationObserved;
  return {
    valid,
    reason: valid
      ? null
      : `Managed trial requires >=35% load pressure, a 30% notice, and either a 35% notice or successful autonomous action; observed ${pressure.percent?.toFixed(1)}%, notices ${levels.join(",")}, action ${acted}`,
  };
}

async function buildTrialResult(client, arm, fixture, execution) {
  const entries = await sessionEntries((await client.state()).sessionFile);
  const allEvents = client.events;
  const answers = execution.stages.queries.map(finalAnswer);
  const queryScores = scoreQueries(answers, fixture);
  const actions = contextActions(allEvents);
  const levels = noticeLevels(entries);
  const managedState = finalManagedState(entries);
  const pressure = lastContextUsage(
    execution.stages.load.at(-1),
    execution.state.model?.contextWindow,
  );
  const destructive = actions.filter((action) =>
    ["hide", "remove", "summarize"].includes(action.action),
  );
  const acted = destructive.some((action) => action.ok);
  const status = thresholdStatus(arm, pressure, levels, acted);
  const usage = measuredUsage(allEvents, execution.compactUsage);
  const score = combinedScore(queryScores);
  const errors = providerErrors(allEvents);
  const contextTokensSaved = lastSavedTokens(actions);
  const minimumMeaningfulSavedTokens = Math.ceil((pressure.contextWindow ?? 0) * 0.01);
  return {
    arm,
    seed: fixture.seed,
    valid: status.valid,
    invalidReason: status.reason,
    fixture: { targetChars: fixture.targetChars, actualChars: fixture.actualChars },
    contextPressureAfterLoad: pressure,
    noticeLevels: levels,
    answers,
    queryScores,
    score,
    autonomyAttempted: arm === "agent-managed" && destructive.length > 0,
    autonomySuccess:
      arm === "agent-managed" &&
      score.exact &&
      errors.length === 0 &&
      contextTokensSaved >= minimumMeaningfulSavedTokens,
    contextTokensSaved,
    minimumMeaningfulSavedTokens,
    finalManagedState: managedState,
    contextActions: actions,
    humanContextInterventions: arm === "runtime-compaction" ? 1 : 0,
    providerErrors: errors,
    usage,
    measuredUsage: usage.total,
    stderr: client.stderr.trim(),
  };
}

async function runTrial(config, arm, fixture, workRoot) {
  const client = new PiRpcClient({
    binary: config.piBinary,
    args: piArgs(config, arm, join(workRoot, `${arm}-${fixture.seed}`), fixture.seed),
    cwd: repo,
    timeoutMs: config.timeoutMs,
  }).start();
  try {
    const execution = await executeStages(client, arm, fixture);
    return await buildTrialResult(client, arm, fixture, execution);
  } finally {
    await client.close();
  }
}

function groupByArm(trials) {
  return Object.fromEntries(
    ALL_ARMS.filter((arm) => trials.some((trial) => trial.arm === arm))
      .map((arm) => [arm, aggregateTrials(trials.filter((trial) => trial.arm === arm))]),
  );
}

function sourceState() {
  const run = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  return { commit: run(["rev-parse", "HEAD"]), dirty: Boolean(run(["status", "--porcelain"])) };
}

async function writeOutput(path, serialized) {
  const outputPath = resolve(path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized);
}

async function main() {
  const config = benchmarkConfig();
  const workRoot = await mkdtemp(join(tmpdir(), "pi-context-autonomy-"));
  const trials = [];
  try {
    for (const seed of config.seeds) {
      const fixture = createFixture(seed, config.targetChars);
      for (const arm of config.arms) {
        process.stderr.write(`context-autonomy: seed=${seed} arm=${arm}\n`);
        trials.push(await runTrial(config, arm, fixture, workRoot));
      }
    }
    const result = {
      schemaVersion: 1,
      runAt: new Date().toISOString(),
      source: sourceState(),
      environment: {
        piVersion: execFileSync(config.piBinary, ["--version"], { encoding: "utf8" }).trim(),
        nodeVersion: process.version,
        model: config.model,
      },
      config: {
        seeds: config.seeds,
        arms: config.arms,
        targetChars: config.targetChars,
        timeoutMs: config.timeoutMs,
        identicalPromptsBySeed: true,
      },
      trials,
      aggregate: groupByArm(trials),
      limitations: [
        "Provider and model behavior are nondeterministic.",
        "Nested summary usage is counted only when the provider returns it through the extension.",
        "A small number of seeds is preliminary evidence, not a provider-wide performance claim.",
      ],
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (config.output) await writeOutput(config.output, serialized);
    process.stdout.write(serialized);
    if (trials.some((trial) => !trial.valid)) process.exitCode = 2;
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

await main();
