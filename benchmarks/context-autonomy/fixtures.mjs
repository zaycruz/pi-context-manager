import { createHash } from "node:crypto";

const FACT_KEYS = [
  "deployment_region",
  "rollback_digest",
  "database_mode",
  "feature_flag",
  "queue_name",
  "retention_days",
  "incident_channel",
  "owner",
  "release_window",
  "health_endpoint",
  "max_parallel_jobs",
  "audit_bucket",
];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function opaqueValue(seed, key, length = 12) {
  return createHash("sha256")
    .update(`pi-context-autonomy-v2:${seed}:${key}`)
    .digest("hex")
    .slice(0, length);
}

function boundedValue(seed, key, minimum, span) {
  return minimum + (Number.parseInt(opaqueValue(seed, key, 8), 16) % span);
}

function canonicalFacts(seed) {
  return {
    deployment_region: `region-${opaqueValue(seed, "deployment_region", 8)}`,
    rollback_digest: `sha256:${opaqueValue(seed, "rollback_digest", 24)}`,
    database_mode: `primary-${opaqueValue(seed, "database_mode", 10)}`,
    feature_flag: `flag-${opaqueValue(seed, "feature_flag", 10)}`,
    queue_name: `queue-${opaqueValue(seed, "queue_name", 10)}`,
    retention_days: String(boundedValue(seed, "retention_days", 17, 180)),
    incident_channel: `#ops-${opaqueValue(seed, "incident_channel", 10)}`,
    owner: `${opaqueValue(seed, "owner", 10)}@example.test`,
    release_window: `Saturday ${String(boundedValue(seed, "release_hour", 0, 24)).padStart(2, "0")}:${String(boundedValue(seed, "release_minute", 0, 60)).padStart(2, "0")} UTC`,
    health_endpoint: `/health/${opaqueValue(seed, "health_endpoint", 10)}`,
    max_parallel_jobs: String(boundedValue(seed, "max_parallel_jobs", 2, 15)),
    audit_bucket: `gs://audit-${opaqueValue(seed, "audit_bucket", 12)}`,
  };
}

function decoyFacts(seed) {
  return Object.fromEntries(
    FACT_KEYS.map((key) => [
      key,
      [
        `superseded-${key}-${opaqueValue(seed, `${key}:decoy:a`, 10)}`,
        `obsolete-${key}-${opaqueValue(seed, `${key}:decoy:b`, 10)}`,
      ],
    ]),
  );
}

function fillerBlock(index, seed) {
  const marker = ((index + 1) * 2654435761 ^ seed * 2246822519) >>> 0;
  return [
    `COMPLETED_WORK_NOTE ${index} marker=${marker.toString(16).padStart(8, "0")}.`,
    "This historical execution note is closed and does not change any canonical constraint.",
    "The worker inspected generated output, compared transient counters, and archived a routine result.",
    "All values in this paragraph are inert filler. Later CANONICAL_FACT records override every SUPERSEDED_FACT record.",
    `Transient sample ${index}-${seed}: latency=${20 + (index % 80)}ms retries=${index % 4} shard=${index % 19}.`,
  ].join(" ");
}

function canonicalLine(key, value) {
  return `CANONICAL_FACT ${key}=${JSON.stringify(value)}. Preserve this exact current value.`;
}

function decoyLine(key, values) {
  return values
    .map((value) => `SUPERSEDED_FACT ${key}=${JSON.stringify(value)}. This value is obsolete.`)
    .join(" ");
}

function addInsertion(inserts, position, line) {
  const lines = inserts.get(position) ?? [];
  lines.push(line);
  inserts.set(position, lines);
}

function insertionMap(blockCount, facts, decoys, random) {
  const positions = shuffled(
    Array.from({ length: blockCount - 20 }, (_, index) => index + 10),
    random,
  );
  const inserts = new Map();
  FACT_KEYS.forEach((key, index) => {
    const canonicalPosition = positions[index];
    addInsertion(inserts, canonicalPosition, canonicalLine(key, facts[key]));
    const decoyPosition = Math.max(1, canonicalPosition - 7 - (index % 5));
    addInsertion(inserts, decoyPosition, decoyLine(key, decoys[key]));
  });
  return inserts;
}

function fixtureBody(seed, targetChars, facts, decoys) {
  const random = seededRandom(seed);
  const sampleLength = fillerBlock(0, seed).length + 2;
  const blockCount = Math.max(80, Math.ceil(targetChars / sampleLength));
  const inserts = insertionMap(blockCount, facts, decoys, random);
  const blocks = [];
  for (let index = 0; index < blockCount; index += 1) {
    blocks.push(fillerBlock(index, seed));
    if (inserts.has(index)) blocks.push(...inserts.get(index));
  }
  return blocks.join("\n\n");
}

export function createFixture(seed, targetChars = 440_000) {
  const facts = canonicalFacts(seed);
  const decoys = decoyFacts(seed);
  const body = fixtureBody(seed, targetChars, facts, decoys);
  const header = [
    "LONG-RUNNING PROJECT TRANSCRIPT",
    "The transcript contains closed work, superseded values, and twelve CANONICAL_FACT records.",
    "Only CANONICAL_FACT values are current. Preserve them exactly for later audit questions.",
    "Do not treat SUPERSEDED_FACT or transient samples as current requirements.",
  ].join("\n");
  const fixture = `${header}\n\n${body}`;
  const queryGroups = [
    FACT_KEYS.slice(0, 4),
    FACT_KEYS.slice(4, 8),
    FACT_KEYS.slice(8, 12),
  ];
  return { seed, fixture, facts, decoys, queryGroups, targetChars, actualChars: fixture.length };
}

function fillerOnlyBody(seed, targetChars) {
  const sampleLength = fillerBlock(0, seed).length + 2;
  const blockCount = Math.max(80, Math.ceil(targetChars / sampleLength));
  return Array.from({ length: blockCount }, (_, index) => fillerBlock(index, seed)).join("\n\n");
}

function factPacket(keys, facts, decoys) {
  return [
    "PROJECT FACT PACKET",
    "Only CANONICAL_FACT values are current. Preserve them exactly for the later audit.",
    ...keys.flatMap((key) => [decoyLine(key, decoys[key]), canonicalLine(key, facts[key])]),
  ].join("\n");
}

export function createToolOutputFixture(seed, targetChars = 440_000) {
  const facts = canonicalFacts(seed);
  const decoys = decoyFacts(seed);
  const fixture = fillerOnlyBody(seed, targetChars);
  const queryGroups = [
    FACT_KEYS.slice(0, 4),
    FACT_KEYS.slice(4, 8),
    FACT_KEYS.slice(8, 12),
  ];
  return {
    seed,
    fixture,
    facts,
    decoys,
    queryGroups,
    factChunks: queryGroups.map((keys) => factPacket(keys, facts, decoys)),
    targetChars,
    actualChars: fixture.length,
  };
}

export function fixtureChunks(fixture, count = 3) {
  const paragraphs = fixture.split("\n\n");
  const target = Math.ceil(fixture.length / count);
  const chunks = [""];
  for (const paragraph of paragraphs) {
    const current = chunks.length - 1;
    const wouldOverflow = chunks[current].length + paragraph.length > target;
    if (chunks[current] && wouldOverflow && chunks.length < count) {
      chunks.push(paragraph);
    } else {
      chunks[current] = chunks[current] ? `${chunks[current]}\n\n${paragraph}` : paragraph;
    }
  }
  return chunks;
}

export function loadPrompt(chunk, index, total) {
  return `${chunk}\n\nLoad project transcript chunk ${index}/${total} for a later audit. Reply exactly LOADED ${index}/${total}.`;
}

export function toolOutputLoadPrompt(factChunk, index, total) {
  return [
    factChunk,
    "",
    `Call load_completed_log_chunk with index ${index}. Its output is closed historical execution filler and contains no canonical facts.`,
    `After the tool returns, reply exactly LOADED ${index}/${total}.`,
  ].join("\n");
}

export const PREPARATION_PROMPT =
  "Prepare for the canonical-fact audit that follows. Do not answer any facts yet. Reply exactly READY.";

export function queryPrompt(keys) {
  return [
    `Return the current canonical values for these keys: ${keys.join(", ")}.`,
    "Return one JSON object only. Use each requested key exactly once. Do not include commentary or obsolete values.",
  ].join("\n");
}

export { FACT_KEYS };
