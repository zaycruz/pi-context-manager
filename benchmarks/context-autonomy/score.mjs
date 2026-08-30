function jsonCandidates(text) {
  const source = String(text ?? "").trim();
  const candidates = [source];
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(source.slice(start, end + 1));
  return [...new Set(candidates)];
}

export function extractJsonObject(text) {
  for (const candidate of jsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next bounded candidate.
    }
  }
  return undefined;
}

function decoyMatch(value, decoys) {
  if (typeof value !== "string") return false;
  return decoys.some((candidate) => value === candidate || value.includes(candidate));
}

function scoreField(key, parsed, expected, decoysByKey) {
  if (!parsed || !(key in parsed)) return { key, status: "missing" };
  const actual = String(parsed[key]);
  const expectedValue = String(expected[key]);
  if (actual === expectedValue) return { key, status: "correct" };
  return {
    key,
    status: "wrong",
    expected: expectedValue,
    actual,
    decoy: decoyMatch(actual, decoysByKey[key] ?? []),
  };
}

export function scoreAnswer(text, expected, decoysByKey = {}) {
  const parsed = extractJsonObject(text);
  const fields = Object.keys(expected).map((key) =>
    scoreField(key, parsed, expected, decoysByKey),
  );
  const correct = fields.filter((field) => field.status === "correct").length;
  const total = fields.length;
  const missing = fields.filter((field) => field.status === "missing").map((field) => field.key);
  const wrong = fields
    .filter((field) => field.status === "wrong")
    .map(({ key, expected: expectedValue, actual }) => ({
      key,
      expected: expectedValue,
      actual,
    }));
  const decoyErrors = fields
    .filter((field) => field.status === "wrong" && field.decoy)
    .map((field) => field.key);
  return {
    parsed: parsed ?? null,
    correct,
    total,
    accuracy: total === 0 ? 1 : correct / total,
    exact: correct === total,
    missing,
    wrong,
    decoyErrors,
  };
}

function sumUsage(target, usage) {
  if (!usage) return target;
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"]) {
    target[key] += Number(usage[key] ?? 0);
  }
  const cost = usage.cost ?? {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
    target.cost[key] += Number(cost[key] ?? 0);
  }
  return target;
}

export function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function combineUsage(usages) {
  return usages.reduce((total, usage) => sumUsage(total, usage), emptyUsage());
}

export function aggregateTrials(trials) {
  const valid = trials.filter((trial) => trial.valid);
  const fields = valid.reduce((sum, trial) => sum + trial.score.correct, 0);
  const totalFields = valid.reduce((sum, trial) => sum + trial.score.total, 0);
  const passed = valid.filter((trial) => trial.score.exact).length;
  const decoyErrors = valid.reduce((sum, trial) => sum + trial.score.decoyErrors.length, 0);
  return {
    trials: trials.length,
    validTrials: valid.length,
    invalidTrials: trials.length - valid.length,
    fieldAccuracy: totalFields === 0 ? 0 : fields / totalFields,
    fullTaskPassRate: valid.length === 0 ? 0 : passed / valid.length,
    decoyErrors,
    autonomyAttemptRate:
      valid.length === 0
        ? 0
        : valid.filter((trial) => trial.autonomyAttempted).length / valid.length,
    autonomySuccessRate:
      valid.length === 0
        ? 0
        : valid.filter((trial) => trial.autonomySuccess).length / valid.length,
    contextTokensSaved: valid.reduce(
      (sum, trial) => sum + Number(trial.contextTokensSaved ?? 0),
      0,
    ),
    providerErrors: valid.reduce((sum, trial) => sum + trial.providerErrors.length, 0),
    usage: combineUsage(valid.map((trial) => trial.measuredUsage)),
  };
}
