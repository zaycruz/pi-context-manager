import { createHash, randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  convertToLlm,
  estimateTokens,
  serializeConversation,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const STATE_CUSTOM_TYPE = "context-manager-state";

interface SummaryRule {
  id: string;
  fingerprints: string[];
  summary: string;
  model: string;
  createdAt: number;
}

interface State {
  hidden: string[];
  removed: string[];
  summaries: SummaryRule[];
}

function fingerprint(msg: AgentMessage): string {
  const content =
    typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? []);
  return createHash("sha256")
    .update(`${msg.role}|${msg.timestamp}|${content}`)
    .digest("hex")
    .slice(0, 16);
}

function normalizeState(data: unknown): State {
  const d = (data ?? {}) as Partial<State>;
  return {
    hidden: Array.isArray(d.hidden)
      ? d.hidden.filter((x): x is string => typeof x === "string")
      : [],
    removed: Array.isArray(d.removed)
      ? d.removed.filter((x): x is string => typeof x === "string")
      : [],
    summaries: Array.isArray(d.summaries)
      ? d.summaries.filter(
          (s): s is SummaryRule =>
            !!s &&
            typeof s === "object" &&
            Array.isArray(s.fingerprints) &&
            typeof s.summary === "string" &&
            typeof s.id === "string",
        )
      : [],
  };
}

function loadState(ctx: ExtensionContext): State {
  try {
    const entries = ctx.sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type === "custom" && e.customType === STATE_CUSTOM_TYPE && e.data) {
        return normalizeState(e.data);
      }
    }
  } catch {
    // session manager unavailable; treat as no state
  }
  return { hidden: [], removed: [], summaries: [] };
}

let lastSavedJson: string | undefined;
function saveState(pi: ExtensionAPI, state: State): void {
  const json = JSON.stringify(state);
  if (json === lastSavedJson) return;
  lastSavedJson = json;
  pi.appendEntry(STATE_CUSTOM_TYPE, state);
}

function sessionMessages(ctx: ExtensionContext): AgentMessage[] {
  return ctx.sessionManager
    .getEntries()
    .flatMap((entry) => {
      if (entry.type !== "message") return [];
      const message = entry.message;
      if (
        (message.role === "user" ||
          message.role === "assistant" ||
          message.role === "toolResult") &&
        message.content == null
      ) {
        return [{ ...message, content: [] }];
      }
      return [message];
    });
}

function resolveIndices(range: string | undefined, count: number): number[] {
  if (!range) return [];
  const out = new Set<number>();
  for (const part of range.split(",")) {
    const p = part.trim();
    if (!p) continue;
    if (p === "all") {
      for (let i = 0; i < count; i++) out.add(i);
      continue;
    }
    const m = p.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = parseInt(m[1], 10) - 1;
    const b = (m[2] ? parseInt(m[2], 10) : a + 1) - 1;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
  }
  return [...out].filter((i) => i >= 0 && i < count).sort((x, y) => x - y);
}

function collectToolCallIds(msg: AgentMessage): string[] {
  if (msg.role !== "assistant" || !Array.isArray(msg.content)) return [];
  return msg.content
    .filter((b): b is { type: "toolCall"; id: string } => b.type === "toolCall")
    .map((b) => b.id);
}

/**
 * Extend a 0-based selection so no toolResult is left without its toolCall and
 * no assistant toolCall message is left without its toolResults. A toolResult
 * without a preceding toolCall is rejected by providers (HTTP 400) on every
 * subsequent call, which would brick the session.
 */
function closeSelection(messages: AgentMessage[], indices: number[]): number[] {
  const selected = new Set(indices);
  let changed = true;
  while (changed) {
    changed = false;
    const callIds = new Set<string>();
    const resultIds = new Set<string>();
    for (const i of selected) {
      const msg = messages[i];
      if (msg.role === "assistant") {
        for (const id of collectToolCallIds(msg)) callIds.add(id);
      } else if (msg.role === "toolResult" && typeof msg.toolCallId === "string") {
        resultIds.add(msg.toolCallId);
      }
    }
    for (let i = 0; i < messages.length; i++) {
      if (selected.has(i)) continue;
      const msg = messages[i];
      if (
        msg.role === "toolResult" &&
        typeof msg.toolCallId === "string" &&
        callIds.has(msg.toolCallId)
      ) {
        selected.add(i);
        changed = true;
      } else if (
        msg.role === "assistant" &&
        collectToolCallIds(msg).some((id) => resultIds.has(id))
      ) {
        selected.add(i);
        changed = true;
      }
    }
  }
  return [...selected].sort((x, y) => x - y);
}

function preview(msg: AgentMessage, maxLen = 120): string {
  let text = "";
  if (typeof msg.content === "string") {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    text = msg.content
      .map((b) => {
        if (b.type === "text") return b.text;
        if (b.type === "toolCall")
          return `toolCall: ${b.name}(${JSON.stringify(b.arguments ?? {})})`;
        if (b.type === "toolResult") return `toolResult: ${b.toolCallId}`;
        if (b.type === "thinking") return "[thinking]";
        if (b.type === "image") return "[image]";
        return `[${b.type}]`;
      })
      .join("\n");
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

function summaryText(rule: SummaryRule): string {
  return `[Context managed: ${rule.fingerprints.length} earlier message(s) summarized by ${rule.model}]\n\n<summary>\n${rule.summary}\n</summary>`;
}

function renderList(state: State, messages: AgentMessage[], limit: number): string {
  const hidden = new Set(state.hidden);
  const removed = new Set(state.removed);
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  const lines: string[] = [];
  lines.push(
    `Context: ${messages.length} message(s), ~${totalTokens.toLocaleString()} tokens (est.)`,
  );
  lines.push(
    `Rules: ${state.hidden.length} hidden, ${state.removed.length} removed, ${state.summaries.length} summar${state.summaries.length === 1 ? "y" : "ies"}`,
  );
  lines.push("");
  const start = Math.max(0, messages.length - limit);
  for (let i = start; i < messages.length; i++) {
    const msg = messages[i];
    const fp = fingerprint(msg);
    const tags: string[] = [];
    if (removed.has(fp)) tags.push("REMOVED");
    else if (hidden.has(fp)) tags.push("HIDDEN");
    const rule = state.summaries.find((s) => s.fingerprints.includes(fp));
    if (rule) tags.push(`SUMMARIZED → id:${rule.id}`);
    const tag = tags.length ? `  [${tags.join(", ")}]` : "";
    lines.push(`[${i + 1}] ${msg.role}: "${preview(msg)}"${tag}`);
  }
  if (messages.length > limit) {
    lines.push(`… ${messages.length - limit} earlier message(s) omitted (use limit to see more)`);
  }
  lines.push("");
  lines.push(
    'Use manage_context with action=hide|unhide|remove|summarize and range like "3-10" or "3,5,7" or "all". Use action=restore with a summary id to bring messages back.',
  );
  return lines.join("\n");
}

function findOverlappingSummary(state: State, fps: string[]): SummaryRule | undefined {
  return state.summaries.find((s) => fps.some((f) => s.fingerprints.includes(f)));
}

function contextStats(
  ctx: ExtensionContext,
  messages: AgentMessage[],
  state: State,
): { tokens: number; cap: number | undefined; pct: number | undefined; saved: number } {
  const usage = ctx.getContextUsage();
  const tokens = usage && usage.tokens > 0 ? usage.tokens : estimateTokens(messages);
  const cap = ctx.model?.contextWindow;
  const pct = cap ? Math.round((tokens / cap) * 100) : undefined;
  const hidden = new Set(state.hidden);
  const removed = new Set(state.removed);
  const summarized = new Set(state.summaries.flatMap((s) => s.fingerprints));
  let saved = 0;
  for (const m of messages) {
    const fp = fingerprint(m);
    if (hidden.has(fp) || removed.has(fp) || summarized.has(fp)) saved += estimateTokens(m);
  }
  return { tokens, cap, pct, saved };
}

function applyHide(state: State, messages: AgentMessage[], range: string | undefined) {
  const idx = closeSelection(messages, resolveIndices(range, messages.length));
  if (idx.length === 0) return { error: `No valid indices in range '${range ?? ""}'` };
  const fps = idx.map((i) => fingerprint(messages[i]));
  const overlap = findOverlappingSummary(state, fps);
  if (overlap)
    return {
      error: `Range overlaps a summary (id:${overlap.id}). Restore it first with action=restore range=${overlap.id}.`,
    };
  const hidden = new Set(state.hidden);
  for (const f of fps) hidden.add(f);
  state.hidden = [...hidden];
  return { ok: true, count: fps.length, closed: idx.length };
}

function applyUnhide(state: State, messages: AgentMessage[], range: string | undefined) {
  const idx = resolveIndices(range, messages.length);
  if (idx.length === 0) return { error: `No valid indices in range '${range ?? ""}'` };
  const fps = idx.map((i) => fingerprint(messages[i]));
  const set = new Set(fps);
  const before = state.hidden.length;
  state.hidden = state.hidden.filter((f) => !set.has(f));
  return { ok: true, count: before - state.hidden.length };
}

function applyRemove(state: State, messages: AgentMessage[], range: string | undefined) {
  const idx = closeSelection(messages, resolveIndices(range, messages.length));
  if (idx.length === 0) return { error: `No valid indices in range '${range ?? ""}'` };
  const fps = idx.map((i) => fingerprint(messages[i]));
  const overlap = findOverlappingSummary(state, fps);
  if (overlap)
    return {
      error: `Range overlaps a summary (id:${overlap.id}). Restore it first with action=restore range=${overlap.id}.`,
    };
  const set = new Set(fps);
  state.removed = [...new Set([...state.removed, ...fps])];
  state.hidden = state.hidden.filter((f) => !set.has(f));
  return { ok: true, count: fps.length, closed: idx.length };
}

function applyRestore(state: State, range: string | undefined) {
  const id = range?.trim();
  if (!id) return { error: "restore requires a summary id as range" };
  const before = state.summaries.length;
  state.summaries = state.summaries.filter((s) => s.id !== id);
  if (state.summaries.length === before) return { error: `No summary with id '${id}'` };
  return { ok: true };
}

async function applySummarize(
  ctx: ExtensionContext,
  state: State,
  messages: AgentMessage[],
  range: string | undefined,
  modelId: string | undefined,
  signal: AbortSignal | undefined,
) {
  const idx = closeSelection(messages, resolveIndices(range, messages.length));
  if (idx.length === 0) return { error: `No valid indices in range '${range ?? ""}'` };
  const selected = idx.map((i) => messages[i]);
  const fps = selected.map(fingerprint);
  const overlap = findOverlappingSummary(state, fps);
  if (overlap)
    return {
      error: `Range overlaps a summary (id:${overlap.id}). Restore it first with action=restore range=${overlap.id}.`,
    };

  let model = ctx.model;
  if (modelId) {
    const slash = modelId.indexOf("/");
    if (slash > 0) {
      const provider = modelId.slice(0, slash);
      const id = modelId.slice(slash + 1);
      model = ctx.modelRegistry.find(provider, id) ?? model;
    }
  }
  if (!model) return { error: "No model available for summarization" };

  const text = serializeConversation(convertToLlm(selected));
  const prompt = `Summarize the following conversation excerpt. Capture: goals, key decisions, important technical details, current state, open questions, and next steps. Be thorough but concise. The summary will replace these messages in the agent's context.

<conversation>
${text}
</conversation>`;

  const response = await ctx.modelRegistry.complete(
    model,
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
          timestamp: Date.now(),
        },
      ],
    },
    { signal, cacheRetention: "none", sessionId: randomUUID() },
  );
  const summary = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
  if (!summary) return { error: "Summarization returned an empty result" };

  const rule: SummaryRule = {
    id: randomUUID().slice(0, 8),
    fingerprints: fps,
    summary,
    model: `${model.provider}/${model.id}`,
    createdAt: Date.now(),
  };
  state.summaries.push(rule);
  const set = new Set(fps);
  state.hidden = state.hidden.filter((f) => !set.has(f));
  state.removed = state.removed.filter((f) => !set.has(f));
  return { ok: true, count: selected.length, summaryId: rule.id, model: rule.model };
}

export default function (pi: ExtensionAPI) {
  pi.on("context", (event, ctx) => {
    const state = loadState(ctx);
    if (
      state.hidden.length === 0 &&
      state.removed.length === 0 &&
      state.summaries.length === 0
    ) {
      return;
    }
    const hidden = new Set(state.hidden);
    const removed = new Set(state.removed);
    const messages = event.messages;
    // Pass 1: find affected indices, then close the set so tool calls stay
    // paired with their results (an orphaned toolResult 400s the provider).
    const affected = new Set<number>();
    for (let i = 0; i < messages.length; i++) {
      const fp = fingerprint(messages[i]);
      if (hidden.has(fp) || removed.has(fp)) affected.add(i);
      else if (state.summaries.some((s) => s.fingerprints.includes(fp))) affected.add(i);
    }
    const closed = new Set(closeSelection(messages, [...affected]));
    const emitted = new Set<string>();
    const out: AgentMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (closed.has(i)) {
        const fp = fingerprint(messages[i]);
        const rule = state.summaries.find(
          (s) => !emitted.has(s.id) && s.fingerprints.includes(fp),
        );
        if (rule) {
          emitted.add(rule.id);
          out.push({
            role: "user",
            content: [{ type: "text", text: summaryText(rule) }],
            timestamp: Date.now(),
          });
        }
        continue;
      }
      out.push(messages[i]);
    }
    return { messages: out };
  });

  pi.on("before_agent_start", (event, ctx) => {
    const state = loadState(ctx);
    const messages = sessionMessages(ctx);
    const s = contextStats(ctx, messages, state);
    const usageText = s.cap
      ? `${s.pct}% of ${(s.cap / 1000).toFixed(0)}k (${s.tokens.toLocaleString()} tokens)`
      : `${s.tokens.toLocaleString()} tokens`;
    const savedText = s.saved ? `, ${s.saved.toLocaleString()} saved by context rules` : "";
    const line = `[Context usage: ${usageText}${savedText}. If usage is high, call manage_context action=stats for details, then hide, remove, or summarize old messages.]`;
    return { systemPrompt: `${event.systemPrompt}\n${line}` };
  });

  pi.registerTool({
    name: "manage_context",
    label: "Manage Context",
    description:
      "Hide, remove, or summarize portions of the conversation context without compacting the whole session. Use action=stats to see context usage against the model's context window, action=list to see the current context with indices, then hide/remove/summarize by index range.",
    promptSnippet: "Manage conversation context: hide, remove, or summarize old messages",
    promptGuidelines: [
      "Use manage_context when the conversation context is getting large and you want to hide, remove, or summarize old messages instead of compacting the whole session.",
      "Call manage_context with action=stats to see context usage against the model's context window. When usage is high (roughly 80% or more), hide, remove, or summarize old messages to stay under the cap.",
      "Call manage_context with action=list first to see the current context and message indices.",
      "Tool calls and their results are paired automatically: hiding, removing, or summarizing one side also affects the other to keep the context valid.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("stats"),
        Type.Literal("hide"),
        Type.Literal("unhide"),
        Type.Literal("remove"),
        Type.Literal("summarize"),
        Type.Literal("restore"),
        Type.Literal("reset"),
      ]),
      range: Type.Optional(
        Type.String({
          description:
            "Message range: '3', '3-10', '3,5,7', or 'all'. For restore: the summary id shown by list.",
        }),
      ),
      limit: Type.Optional(
        Type.Integer({
          description: "For list: how many trailing messages to show (default 25).",
        }),
      ),
      model: Type.Optional(
        Type.String({
          description:
            "For summarize: model id like 'google/gemini-2.5-flash' (default: active model).",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, toolCtx) {
      const state = loadState(toolCtx);
      const messages = sessionMessages(toolCtx);
      const err = (text: string) => ({
        content: [{ type: "text" as const, text }],
        details: { action: params.action, ok: false },
      });
      const ok = (text: string, details: Record<string, unknown> = {}) => ({
        content: [{ type: "text" as const, text }],
        details: { action: params.action, ok: true, ...details },
      });
      try {
        switch (params.action) {
          case "list": {
            const limit = params.limit ?? 25;
            return ok(renderList(state, messages, limit), {
              messageCount: messages.length,
              hidden: state.hidden.length,
              removed: state.removed.length,
              summaries: state.summaries.length,
            });
          }
          case "stats": {
            const s = contextStats(toolCtx, messages, state);
            const usageText = s.cap
              ? `${s.pct}% of ${(s.cap / 1000).toFixed(0)}k (${s.tokens.toLocaleString()} tokens)`
              : `${s.tokens.toLocaleString()} tokens`;
            return ok(
              [
                `Context usage: ${usageText}`,
                `Rules: ${state.hidden.length} hidden, ${state.removed.length} removed, ${state.summaries.length} summar${state.summaries.length === 1 ? "y" : "ies"}`,
                `Saved by rules: ~${s.saved.toLocaleString()} tokens`,
                `Messages in session: ${messages.length}`,
              ].join("\n"),
              {
                tokens: s.tokens,
                cap: s.cap,
                pct: s.pct,
                saved: s.saved,
                hidden: state.hidden.length,
                removed: state.removed.length,
                summaries: state.summaries.length,
              },
            );
          }
          case "hide": {
            const r = applyHide(state, messages, params.range);
            if (r.error) return err(r.error);
            saveState(pi, state);
            const extra = r.closed > r.count ? ` (selection auto-extended to ${r.closed} to keep tool calls paired with their results)` : "";
            return ok(
              `Hidden ${r.count} message(s). They are excluded from context until unhidden.${extra}`,
              { count: r.count, closed: r.closed },
            );
          }
          case "unhide": {
            const r = applyUnhide(state, messages, params.range);
            if (r.error) return err(r.error);
            saveState(pi, state);
            return ok(
              r.count === 0
                ? "No hidden messages in that range."
                : `Unhidden ${r.count} message(s).`,
              { count: r.count },
            );
          }
          case "remove": {
            const r = applyRemove(state, messages, params.range);
            if (r.error) return err(r.error);
            saveState(pi, state);
            const extra = r.closed > r.count ? ` (selection auto-extended to ${r.closed} to keep tool calls paired with their results)` : "";
            return ok(
              `Removed ${r.count} message(s) from context permanently (for this session).${extra}`,
              { count: r.count, closed: r.closed },
            );
          }
          case "summarize": {
            const r = await applySummarize(
              toolCtx,
              state,
              messages,
              params.range,
              params.model,
              signal,
            );
            if (r.error) return err(r.error);
            saveState(pi, state);
            const extra = r.closed > r.count ? ` (selection auto-extended to ${r.closed} to keep tool calls paired with their results)` : "";
            return ok(
              `Summarized ${r.count} message(s) into a single context block (id:${r.summaryId}, model: ${r.model}). Use action=restore range=${r.summaryId} to bring them back.${extra}`,
              { count: r.count, closed: r.closed, summaryId: r.summaryId, model: r.model },
            );
          }
          case "restore": {
            const r = applyRestore(state, params.range);
            if (r.error) return err(r.error);
            saveState(pi, state);
            return ok(`Restored the summarized messages. They are back in context.`);
          }
          case "reset": {
            saveState(pi, { hidden: [], removed: [], summaries: [] });
            return ok(`Reset all context rules. All messages are back in context.`);
          }
        }
      } catch (e) {
        return err(`manage_context failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  });
}
