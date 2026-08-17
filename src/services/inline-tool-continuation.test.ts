import { describe, expect, test } from "bun:test";
import { buildInlineToolContinuation } from "./inline-tool-continuation";

describe("inline tool continuation", () => {
  test("marks structured failed tool calls as errors", () => {
    const messages = buildInlineToolContinuation({
      structured: true,
      legacyAssistantOutput: "",
      roundContent: "",
      roundReasoning: "",
      toolCalls: [{ call_id: "search-1", name: "web_search", args: { query: "test" } }],
      results: [{
        callId: "search-1",
        qualifiedName: "web_search",
        toolName: "web_search",
        toolDisplayName: "Web Search",
        result: "Web search can be called only once per generation.",
        isError: true,
      }],
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "search-1",
        content: "Web search can be called only once per generation.",
        is_error: true,
      }],
    });
  });
});
