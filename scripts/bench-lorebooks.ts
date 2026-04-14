import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { activateWorldInfo } from "../src/services/world-info-activation.service";
import type { WorldBookEntry } from "../src/types/world-book";
import type { Message } from "../src/types/message";

const DIR = "lorebooks";

function stToLumiverse(bookName: string, st: any, idx: string): WorldBookEntry {
  return {
    id: `${bookName}:${idx}`,
    world_book_id: bookName,
    uid: `${bookName}:${idx}`,
    key: Array.isArray(st.key) ? st.key.filter((k: any) => typeof k === "string") : [],
    keysecondary: Array.isArray(st.keysecondary) ? st.keysecondary.filter((k: any) => typeof k === "string") : [],
    content: String(st.content ?? ""),
    comment: String(st.comment ?? ""),
    position: st.position ?? 0,
    depth: st.depth ?? 4,
    role: st.role ?? null,
    order_value: st.order ?? 100,
    selective: Boolean(st.selective),
    constant: Boolean(st.constant),
    disabled: Boolean(st.disable ?? st.disabled),
    group_name: String(st.group ?? ""),
    group_override: Boolean(st.groupOverride),
    group_weight: st.groupWeight ?? 100,
    probability: st.probability ?? 100,
    scan_depth: st.scanDepth ?? null,
    case_sensitive: Boolean(st.caseSensitive),
    match_whole_words: Boolean(st.matchWholeWords),
    automation_id: st.automation_id ?? null,
    use_regex: Boolean(st.useRegex ?? st.use_regex),
    prevent_recursion: Boolean(st.preventRecursion),
    exclude_recursion: Boolean(st.excludeRecursion),
    delay_until_recursion: Boolean(st.delayUntilRecursion),
    priority: st.priority ?? 0,
    sticky: st.sticky ?? 0,
    cooldown: st.cooldown ?? 0,
    delay: st.delay ?? 0,
    selective_logic: st.selectiveLogic ?? 0,
    use_probability: Boolean(st.useProbability),
    vectorized: false,
    vector_index_status: "not_enabled",
    vector_indexed_at: null,
    vector_index_error: null,
    extensions: {},
    created_at: 0,
    updated_at: 0,
  };
}

function loadAllEntries(): WorldBookEntry[] {
  const files = readdirSync(DIR).filter(f => f.endsWith(".json"));
  const entries: WorldBookEntry[] = [];
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    const bookName = f.replace(/\.json$/, "");
    const src = j.entries ?? {};
    for (const [idx, st] of Object.entries(src)) {
      entries.push(stToLumiverse(bookName, st, idx));
    }
  }
  return entries;
}

function buildTriggerMessage(entries: WorldBookEntry[], fraction: number, seed: number): { text: string; targetedUids: Set<string> } {
  const rng = mulberry32(seed);
  const eligible = entries.filter(e => !e.disabled && !e.constant && !e.use_regex && e.key.length > 0);
  const count = Math.max(1, Math.floor(eligible.length * fraction));
  const shuffled = eligible.slice().sort(() => rng() - 0.5);
  const picked = shuffled.slice(0, count);
  const pieces: string[] = [];
  const targetedUids = new Set<string>();
  for (const e of picked) {
    const k = e.key[Math.floor(rng() * e.key.length)];
    if (k) {
      pieces.push(k);
      targetedUids.add(e.uid);
    }
  }
  return { text: pieces.join(" "), targetedUids };
}

function mulberry32(a: number) {
  return function() {
    a |= 0; a = a + 0x6d2b79f5 | 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function timeIt<T>(label: string, runs: number, fn: () => T): { label: string; meanMs: number; minMs: number; maxMs: number; result: T } {
  let result: T = undefined as any;
  const samples: number[] = [];

  result = fn(); result = fn();
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    result = fn();
    samples.push(performance.now() - t0);
  }
  const meanMs = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { label, meanMs, minMs: Math.min(...samples), maxMs: Math.max(...samples), result };
}

const entries = loadAllEntries();
console.log(`Loaded ${entries.length} total entries from ${readdirSync(DIR).filter(f => f.endsWith(".json")).length} lorebooks`);
const totalKeys = entries.reduce((s, e) => s + e.key.length + e.keysecondary.length, 0);
const totalContent = entries.reduce((s, e) => s + e.content.length, 0);
console.log(`  ${totalKeys} total keys, ${(totalContent / 1024).toFixed(1)} KiB total content`);

const { text: triggerText, targetedUids } = buildTriggerMessage(entries, 0.1, 42);
console.log(`Trigger text length: ${triggerText.length} chars, targeting ${targetedUids.size} entries (~10%)`);

const TARGET_FILLER = 800_000;
function makeFiller(size: number, seed: number): string {
  const rng = mulberry32(seed);
  const words = ["the", "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit",
    "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "magna", "aliqua", "velit",
    "esse", "cillum", "fugiat", "nulla", "pariatur", "excepteur", "sint", "occaecat"];
  const out: string[] = [];
  let len = 0;
  while (len < size) {
    const w = words[Math.floor(rng() * words.length)];
    out.push(w);
    len += w.length + 1;
  }
  return out.join(" ");
}
const perMsg = Math.floor(TARGET_FILLER / 4);
const messages: Message[] = [
  { role: "user", content: makeFiller(perMsg, 1) },
  { role: "assistant", content: makeFiller(perMsg, 2) },
  { role: "user", content: makeFiller(perMsg, 3) },
  { role: "user", content: triggerText + " " + makeFiller(perMsg - triggerText.length - 1, 4) },
] as Message[];
const ctxChars = messages.reduce((s, m) => s + m.content.length, 0);
console.log(`Context: ${ctxChars.toLocaleString()} chars across 4 messages`);

const runs = 3;

const legacy = timeIt("legacy scanner", runs, () =>
  activateWorldInfo({
    entries, messages, chatTurn: messages.length, wiState: {},
    settings: { globalScanDepth: 4, maxRecursionPasses: 3 },
    useAhoCorasick: false,
  })
);

const ac = timeIt("aho-corasick", runs, () =>
  activateWorldInfo({
    entries, messages, chatTurn: messages.length, wiState: {},
    settings: { globalScanDepth: 4, maxRecursionPasses: 3 },
    useAhoCorasick: true,
  })
);

function fmt(n: number) { return n.toFixed(2).padStart(7); }
console.log("\n=== RESULTS ===");
console.log(`${"path".padEnd(16)} ${"mean".padStart(8)} ${"min".padStart(8)} ${"max".padStart(8)}   activated   recursion`);
for (const r of [legacy, ac]) {
  const res = r.result as any;
  console.log(`${r.label.padEnd(16)} ${fmt(r.meanMs)}ms ${fmt(r.minMs)}ms ${fmt(r.maxMs)}ms   ${String(res.activatedEntries.length).padStart(9)}   ${String(res.stats.recursionPassesUsed).padStart(9)}`);
}
const speedup = legacy.meanMs / ac.meanMs;
console.log(`\nSpeedup: ${speedup.toFixed(2)}× (legacy/ac)`);

const legacyUids = new Set((legacy.result as any).activatedEntries.map((e: any) => e.uid));
const acUids = new Set((ac.result as any).activatedEntries.map((e: any) => e.uid));
const onlyLegacy = [...legacyUids].filter(u => !acUids.has(u));
const onlyAc = [...acUids].filter(u => !legacyUids.has(u));
console.log(`\nParity: legacy=${legacyUids.size}, ac=${acUids.size}, diff onlyLegacy=${onlyLegacy.length}, onlyAc=${onlyAc.length}`);
if (onlyLegacy.length || onlyAc.length) {
  console.log("  onlyLegacy:", onlyLegacy.slice(0, 5));
  console.log("  onlyAc:   ", onlyAc.slice(0, 5));
}
