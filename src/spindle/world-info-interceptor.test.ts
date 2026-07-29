import { describe, expect, test } from "bun:test";
import type { WorldBookEntry } from "../types/world-book";
import { WorldInfoInterceptorChain } from "./world-info-interceptor";

function makeEntry(id: string): WorldBookEntry {
  return {
    id,
    world_book_id: "book",
    uid: id,
    outlet_name: null,
    wi_marker: null,
    wi_marker_side: null,
    key: [id],
    keysecondary: [],
    content: `content-${id}`,
    comment: id,
    position: 0,
    depth: 4,
    role: null,
    order_value: 100,
    selective: false,
    constant: false,
    disabled: false,
    group_name: "",
    group_override: false,
    group_weight: 100,
    probability: 100,
    scan_depth: null,
    case_sensitive: false,
    match_whole_words: false,
    automation_id: null,
    use_regex: false,
    prevent_recursion: true,
    exclude_recursion: false,
    delay_until_recursion: false,
    priority: 10,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    selective_logic: 0,
    use_probability: true,
    vectorized: false,
    vector_index_status: "not_enabled",
    vector_indexed_at: null,
    vector_index_error: null,
    extensions: {},
    created_at: 0,
    updated_at: 0,
  };
}

const context = {
  chatId: "chat",
  characterId: "character",
  messages: [],
  chatTurn: 1,
  chatMetadata: {},
};

describe("WorldInfoInterceptorChain activation capture", () => {
  test("collects raw capture requests per extension without changing vote behavior", async () => {
    const chain = new WorldInfoInterceptorChain();
    chain.register({
      extensionId: "one",
      priority: 0,
      handler: async () => ({
        captured: ["a", "missing"],
        disabled: ["a"],
      }),
    });
    chain.register({
      extensionId: "two",
      priority: 1,
      handler: async () => ({
        captured: ["a", "b"],
      }),
    });

    const result = await chain.run(
      [makeEntry("a"), makeEntry("b")],
      context,
    );

    expect(result.entries.map(({ id, disabled }) => ({ id, disabled }))).toEqual([
      { id: "a", disabled: true },
      { id: "b", disabled: false },
    ]);
    expect([...result.captureRequests.get("one")!]).toEqual(["a"]);
    expect([...result.captureRequests.get("two")!]).toEqual(["a", "b"]);
  });

  test("retains an explicit empty request", async () => {
    const chain = new WorldInfoInterceptorChain();
    chain.register({
      extensionId: "empty",
      priority: 0,
      handler: async () => ({ captured: [] }),
    });

    const result = await chain.run([makeEntry("a")], context);

    expect(result.captureRequests.has("empty")).toBe(true);
    expect([...result.captureRequests.get("empty")!]).toEqual([]);
    expect(result.entries[0].disabled).toBe(false);
  });
});
