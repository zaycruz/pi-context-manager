export const CONTEXT_REVIEW_PERCENT = 30;
export const CONTEXT_ACTION_PERCENT = 35;

export type ContextNotificationLevel = 0 | 30 | 35;

export interface SummaryRule {
  id: string;
  fingerprints: string[];
  summary: string;
  model: string;
  createdAt: number;
  tokensBefore?: number;
}

export interface ContextState {
  hidden: string[];
  removed: string[];
  summaries: SummaryRule[];
  notificationLevel: ContextNotificationLevel;
}


export function reconcileState(
  state: ContextState,
  activeFingerprints: Iterable<string>,
): ContextState {
  const active = new Set(activeFingerprints);
  return {
    hidden: state.hidden.filter((fingerprint) => active.has(fingerprint)),
    removed: state.removed.filter((fingerprint) => active.has(fingerprint)),
    summaries: state.summaries.filter(
      (rule) =>
        rule.fingerprints.length > 0 &&
        rule.fingerprints.every((fingerprint) => active.has(fingerprint)),
    ),
    notificationLevel: state.notificationLevel,
  };
}

export function statesEqual(left: ContextState, right: ContextState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function nextNotificationLevel(
  percent: number | undefined,
  current: ContextNotificationLevel,
): ContextNotificationLevel | undefined {
  if (percent === undefined) return undefined;
  if (percent < CONTEXT_REVIEW_PERCENT) return current === 0 ? undefined : 0;
  if (current < CONTEXT_REVIEW_PERCENT) return 30;
  if (percent >= CONTEXT_ACTION_PERCENT && current < CONTEXT_ACTION_PERCENT) return 35;
  return undefined;
}

export function contextNotificationText(
  level: Exclude<ContextNotificationLevel, 0>,
  usageText: string,
  savedText: string,
): string {
  const prefix = `[Context usage: ${usageText}${savedText}.`;
  if (level === CONTEXT_ACTION_PERCENT) {
    return `${prefix} Usage reached 35%. Call manage_context action=stats now, then action=list, and manage completed context before runtime-owned compaction. Summarize the largest completed ranges that contain facts, constraints, user content, tool exchanges, or other durable context. Hide/remove are lossy cleanup actions limited to plain assistant text up to 128 tokens per message and 512 tokens total. Call stats again; if active rules save less than 1% of the context window, summarize a more useful completed range.]`;
  }
  return `${prefix} Usage reached 30%. Call manage_context action=stats, then action=list, and review old completed messages. Manage them only when safe.]`;
}
