export const CONTEXT_REVIEW_PERCENT = 30;
export const CONTEXT_ACTION_PERCENT = 35;

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
  };
}

export function statesEqual(left: ContextState, right: ContextState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function contextIndicatorLine(
  percent: number | undefined,
  usageText: string,
  savedText: string,
): string {
  const prefix = `[Context usage: ${usageText}${savedText}.`;
  if (percent !== undefined && percent >= CONTEXT_ACTION_PERCENT) {
    return `${prefix} Usage is at or above 35% — you MUST call manage_context action=stats now, then action=list, then hide, remove, or summarize old completed messages before OMP's runtime-owned idle compaction at roughly 40%.]`;
  }
  if (percent !== undefined && percent >= CONTEXT_REVIEW_PERCENT) {
    return `${prefix} Usage is at or above 30% — call manage_context action=stats, then action=list, and review old completed messages before runtime compaction; hide, remove, or summarize them when safe.]`;
  }
  return `${prefix} When usage reaches 30%, call manage_context action=stats, then action=list, and review old completed messages.]`;
}
