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
  policyVersion: 0 | 1;
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
    policyVersion: state.policyVersion,
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
  canSummarize = true,
): string {
  const prefix = `[Context usage: ${usageText}${savedText}.`;
  if (level === CONTEXT_ACTION_PERCENT && !canSummarize) {
    return `${prefix} Usage reached 35%. This runtime cannot summarize through manage_context. Call stats and list. Decide which completed tool exchanges are no longer needed, then reversibly hide those exchanges; calls and matching results move together. Do not hide durable or unique evidence as a substitute for summarization. Leave durable content to runtime-owned compaction. Remove accepts only plain assistant text up to 128 tokens per message and 512 tokens total.]`;
  }
  if (level === CONTEXT_ACTION_PERCENT) {
    return `${prefix} Usage reached 35%. Call manage_context action=stats now, then action=list, and manage completed context before runtime-owned compaction. Decide which completed context is no longer needed. Reversibly hide completed tool exchanges whose raw output is no longer useful; calls and matching results move together. Summarize facts, constraints, user content, or unique evidence. Remove accepts only plain assistant text up to 128 tokens per message and 512 tokens total. Call stats again to verify meaningful reduction.]`;
  }
  return `${prefix} Usage reached 30%. Call manage_context action=stats, then action=list, and review old completed messages. Manage them only when safe.]`;
}
