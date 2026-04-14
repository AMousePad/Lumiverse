import { describe, test, expect } from "bun:test";
import type { WorldBookEntry } from "../types/world-book";
import type { Message } from "../types/message";
import { activateWorldInfo, type WiState } from "./world-info-activation.service";

let __uid = 0;
function entry(overrides: Partial<WorldBookEntry> = {}): WorldBookEntry {
  __uid++;
  return {
    id: `id-${__uid}`,
    world_book_id: "b",
    uid: `u-${__uid}`,
    key: [],
    keysecondary: [],
    content: `content-${__uid}`,
    comment: "",
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
    prevent_recursion: false,
    exclude_recursion: false,
    delay_until_recursion: false,
    priority: 10,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    selective_logic: 0,
    use_probability: false,
    vectorized: false,
    vector_index_status: "not_enabled",
    vector_indexed_at: null,
    vector_index_error: null,
    extensions: {},
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function msg(content: string): Message {
  return { role: "user", content } as unknown as Message;
}

function activate(entries: WorldBookEntry[], messages: Message[]): string[] {
  const r = activateWorldInfo({
    entries: entries.map(e => ({ ...e })),
    messages, chatTurn: messages.length, wiState: {} as WiState,
    settings: { maxRecursionPasses: 3 },
  });
  return r.activatedEntries.map(e => e.uid).sort();
}

describe("WorldInfoMatcher activation behavior", () => {
  test("basic primary keyword match", () => {
    const entries = [entry({ key: ["dragon"] }), entry({ key: ["spaceship"] })];
    expect(activate(entries, [msg("The dragon breathes fire.")]).length).toBe(1);
  });

  test("case-sensitive vs case-insensitive entries together", () => {
    const e1 = entry({ key: ["Dragon"], case_sensitive: true });
    const e2 = entry({ key: ["dragon"], case_sensitive: false });
    expect(activate([e1, e2], [msg("a Dragon appears")]).length).toBe(2);
    expect(activate([e1, e2], [msg("a dragon appears")]).length).toBe(1);
  });

  test("match_whole_words respects boundaries", () => {
    const e1 = entry({ key: ["cat"], match_whole_words: true });
    expect(activate([e1], [msg("the category is large")]).length).toBe(0);
    expect(activate([e1], [msg("the cat sleeps")]).length).toBe(1);
  });

  test("selective logic AND/OR/NOT/NOT_ALL", () => {
    const mk = (logic: number) => entry({
      key: ["hero"], keysecondary: ["sword", "shield"],
      selective: true, selective_logic: logic,
    });
    const cases: [number, string, boolean][] = [
      [0, "hero with sword and shield", true],
      [0, "hero with sword only", false],
      [2, "hero with sword only", true],
      [2, "hero alone", false],
      [1, "hero alone", true],
      [1, "hero with sword", false],
      [3, "hero with sword only", true],
      [3, "hero with sword and shield", false],
    ];
    for (const [logic, text, expected] of cases) {
      expect(activate([mk(logic)], [msg(text)]).length === 1).toBe(expected);
    }
  });

  test("recursion: activated entry triggers another via its content", () => {
    const e1 = entry({ key: ["alpha"], content: "this mentions beta directly" });
    const e2 = entry({ key: ["beta"], content: "beta content" });
    expect(activate([e1, e2], [msg("alpha appears")]).length).toBe(2);
  });

  test("prevent_recursion: entry cannot activate via recursion", () => {
    const e1 = entry({ key: ["alpha"], content: "beta appears here" });
    const e2 = entry({ key: ["beta"], content: "x", prevent_recursion: true });
    expect(activate([e1, e2], [msg("alpha only")]).length).toBe(1);
  });

  test("exclude_recursion: entry's content does not feed recursion", () => {
    const e1 = entry({ key: ["alpha"], content: "beta", exclude_recursion: true });
    const e2 = entry({ key: ["beta"], content: "x" });
    expect(activate([e1, e2], [msg("alpha")]).length).toBe(1);
  });

  test("use_regex entries", () => {
    const e1 = entry({ key: ["cats?"], use_regex: true });
    expect(activate([e1], [msg("a cat and a dog")]).length).toBe(1);
    expect(activate([e1], [msg("nothing here")]).length).toBe(0);
  });

  test("mixed regex and literal entries coexist", () => {
    const e1 = entry({ key: ["cats?"], use_regex: true });
    const e2 = entry({ key: ["dog"] });
    expect(activate([e1, e2], [msg("a cat and a dog")]).length).toBe(2);
  });

  test("constants always activate and feed recursion scan", () => {
    const c = entry({ constant: true, content: "mentions beta here" });
    const e2 = entry({ key: ["beta"] });
    expect(activate([c, e2], [msg("unrelated")]).length).toBe(2);
  });

  test("empty-key entries never match via keyword", () => {
    expect(activate([entry({ key: [] })], [msg("anything")]).length).toBe(0);
  });

  test("entries with different scan_depth see different message slices", () => {
    const shallow = entry({ key: ["alpha"], scan_depth: 1 });
    const deep = entry({ key: ["alpha"], scan_depth: 3 });
    const result = activate([shallow, deep], [
      msg("alpha here in old message"),
      msg("middle"),
      msg("recent, no key"),
    ]);
    expect(result).toContain(deep.uid);
    expect(result).not.toContain(shallow.uid);
  });

  test("duplicate secondary key strings under AND logic", () => {
    const e = entry({
      key: ["hero"], keysecondary: ["sword", "sword"],
      selective: true, selective_logic: 0,
    });
    expect(activate([e], [msg("hero with a sword")]).length).toBe(1);
  });

  test("non-ASCII key with whole_words", () => {
    const e = entry({ key: ["straße"], match_whole_words: true });
    expect(activate([e], [msg("die große Straße führt dort")]).length).toBe(1);
  });

  test("emoji key with whole_words rejects (emoji is non-word, no boundary transition)", () => {
    const e = entry({ key: ["🐉"], match_whole_words: true });
    expect(activate([e], [msg("I saw a 🐉 today")]).length).toBe(0);
  });

  test("disabled entries are skipped", () => {
    const e1 = entry({ key: ["alpha"], disabled: true });
    const e2 = entry({ key: ["alpha"] });
    const result = activate([e1, e2], [msg("alpha")]);
    expect(result).not.toContain(e1.uid);
    expect(result).toContain(e2.uid);
  });
});
