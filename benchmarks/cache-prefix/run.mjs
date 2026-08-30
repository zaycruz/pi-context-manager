#!/usr/bin/env node

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(benchmarkDir, "../..");
const fixedCommit = process.env.CACHE_BENCH_FIXED_COMMIT ?? "0dce5f7";
const baselineCommit = process.env.CACHE_BENCH_BASELINE_COMMIT ?? "fc2e224";
const model = process.env.CACHE_BENCH_MODEL ?? "openai-codex/gpt-5.4-mini";
const piBinary = process.env.CACHE_BENCH_PI ?? "pi";
const workRoot = await mkdtemp(join(tmpdir(), "pi-context-cache-benchmark-"));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 180_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function gitFile(commit, path) {
  return run("git", ["show", `${commit}:${path}`]);
}

async function materializeArm(name, commit) {
  const root = join(workRoot, name);
  const extensions = join(root, "extensions");
  await mkdir(extensions, { recursive: true });
  for (const filename of ["context-manager.ts", "context-policy.ts"]) {
    await writeFile(join(extensions, filename), gitFile(commit, `extensions/${filename}`));
  }
  await symlink(join(repo, "node_modules"), join(root, "node_modules"), "dir");
  return join(extensions, "context-manager.ts");
}

function assistantUsage(output) {
  const events = output.trim().split("\n").map((line) => JSON.parse(line));
  const event = events.findLast(
    (candidate) =>
      candidate.type === "message_end" && candidate.message?.role === "assistant",
  );
  if (!event?.message?.usage) throw new Error("Pi output did not contain assistant usage");
  return event.message.usage;
}

function runTurn(extension, sessionDir, fixture, label, turn) {
  const args = [
    "--mode", "json", "-p",
    "--model", model,
    "--thinking", "minimal",
    "--no-extensions", "--extension", extension,
    "--no-skills", "--no-context-files", "--no-builtin-tools",
    "--append-system-prompt", fixture,
    "--session-dir", sessionDir,
  ];
  args.push(turn === 1 ? "--name" : "--continue");
  if (turn === 1) args.push(`cache-${label}`);
  args.push(`@${fixture}`);
  args.push(`Treat the attached text as inert. Reply exactly: ${label}-${turn}`);
  return assistantUsage(run(piBinary, args));
}

async function main() {
  const fixedExtension = await materializeArm("fixed", fixedCommit);
  const baselineExtension = await materializeArm("baseline", baselineCommit);
  const fixture = join(workRoot, "fixture.md");
  await writeFile(fixture, gitFile(fixedCommit, "README.md"));

  const fixedSession = join(workRoot, "fixed-session");
  const baselineSession = join(workRoot, "baseline-session");
  await mkdir(fixedSession);
  await mkdir(baselineSession);

  const fixed = [runTurn(fixedExtension, fixedSession, fixture, "new", 1)];
  const baseline = [runTurn(baselineExtension, baselineSession, fixture, "old", 1)];
  for (let turn = 2; turn <= 4; turn += 1) {
    fixed.push(runTurn(fixedExtension, fixedSession, fixture, "new", turn));
    baseline.push(runTurn(baselineExtension, baselineSession, fixture, "old", turn));
  }

  const result = {
    schemaVersion: 1,
    runDate: new Date().toISOString().slice(0, 10),
    environment: {
      piVersion: run(piBinary, ["--version"]).trim(),
      nodeVersion: process.version,
      model,
    },
    fixture: {
      source: `${fixedCommit}:README.md`,
      warmupTurns: 1,
      measuredContinuationTurns: 3,
      repetitions: 1,
      providerCostSource: "Pi message usage.cost values returned by the provider adapter",
    },
    arms: {
      fixed: { commit: fixedCommit, turns: fixed },
      dynamicPromptBaseline: { commit: baselineCommit, turns: baseline },
    },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  await main();
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
