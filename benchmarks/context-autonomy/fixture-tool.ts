import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface ToolFixture {
  chunks: string[];
}

function loadFixture(): ToolFixture {
  const path = process.env.CONTEXT_AUTONOMY_TOOL_FIXTURE;
  if (!path) throw new Error("CONTEXT_AUTONOMY_TOOL_FIXTURE is required");
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("chunks" in parsed) ||
    !Array.isArray(parsed.chunks) ||
    parsed.chunks.some((chunk) => typeof chunk !== "string")
  ) {
    throw new Error("Tool-output fixture must contain a string chunks array");
  }
  return { chunks: parsed.chunks };
}

export default function fixtureTool(pi: ExtensionAPI): void {
  const fixture = loadFixture();
  pi.registerTool({
    name: "load_completed_log_chunk",
    label: "Load Completed Log Chunk",
    description:
      "Load one large closed historical execution log. The output is reproducible filler and contains no canonical facts.",
    ...({ loadMode: "essential" } as const),
    parameters: Type.Object({
      index: Type.Integer({ minimum: 1, maximum: fixture.chunks.length }),
    }),
    async execute(_toolCallId, params) {
      if (!params || typeof params.index !== "number") throw new Error("index is required");
      const index = params.index - 1;
      return {
        content: [{ type: "text" as const, text: fixture.chunks[index] }],
        details: { index: index + 1, reproducible: true, canonicalFacts: false },
      };
    },
  });
}
