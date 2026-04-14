import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { activateWorldInfo } from "../src/services/world-info-activation.service";
import type { WorldBookEntry } from "../src/types/world-book";
import type { Message } from "../src/types/message";

const LORE_DIR = "lorebooks";
const CORPUS_DIR = "scripts/bench-data";

function stToLumiverse(book: string, st: any, idx: string): WorldBookEntry {
  return {
    id: `${book}:${idx}`, world_book_id: book, uid: `${book}:${idx}`,
    key: Array.isArray(st.key) ? st.key.filter((k: any) => typeof k === "string") : [],
    keysecondary: Array.isArray(st.keysecondary) ? st.keysecondary.filter((k: any) => typeof k === "string") : [],
    content: String(st.content ?? ""), comment: String(st.comment ?? ""),
    position: st.position ?? 0, depth: st.depth ?? 4, role: st.role ?? null,
    order_value: st.order ?? 100, selective: Boolean(st.selective),
    constant: Boolean(st.constant), disabled: Boolean(st.disable ?? st.disabled),
    group_name: String(st.group ?? ""), group_override: Boolean(st.groupOverride),
    group_weight: st.groupWeight ?? 100, probability: st.probability ?? 100,
    scan_depth: st.scanDepth ?? null, case_sensitive: Boolean(st.caseSensitive),
    match_whole_words: Boolean(st.matchWholeWords), automation_id: st.automation_id ?? null,
    use_regex: Boolean(st.useRegex ?? st.use_regex), prevent_recursion: Boolean(st.preventRecursion),
    exclude_recursion: Boolean(st.excludeRecursion), delay_until_recursion: Boolean(st.delayUntilRecursion),
    priority: st.priority ?? 0, sticky: st.sticky ?? 0, cooldown: st.cooldown ?? 0,
    delay: st.delay ?? 0, selective_logic: st.selectiveLogic ?? 0,
    use_probability: false, 
    vectorized: false, vector_index_status: "not_enabled", vector_indexed_at: null,
    vector_index_error: null, extensions: {}, created_at: 0, updated_at: 0,
  };
}

function loadEntries(): WorldBookEntry[] {
  const out: WorldBookEntry[] = [];
  for (const f of readdirSync(LORE_DIR).filter(f => f.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(join(LORE_DIR, f), "utf8"));
    for (const [idx, st] of Object.entries(j.entries ?? {})) {
      out.push(stToLumiverse(f.replace(/\.json$/, ""), st, idx));
    }
  }
  return out;
}

function mulberry32(a: number) {
  return () => { a |= 0; a = a + 0x6d2b79f5 | 0; let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const NON_ASCII_SEEDS = [
  "龍ドラゴン", "魔法師", "왕국기사", "العاصمة", "Москва", "Αθήνα",
  "ℵ∞∑∫", "🐉🔥⚔️", "café🗡️", "naïve", "résumé™", "façade",
  "ß→ss", "İstanbul", "straße", "מלאך", "天使", "น้ำ",
  "a\u0301\u0302\u0303",
  "ab\u200dcd",
  "𝒜𝓁𝓅𝒽𝒶",
  "👨‍👩‍👧‍👦",
  "ㅎㅎ한국어",
  "漢字テスト",
];

function mangleKey(original: string, rng: () => number): string {
  const seed = NON_ASCII_SEEDS[Math.floor(rng() * NON_ASCII_SEEDS.length)];
  const trimmed = original.trim().slice(0, 8).toLowerCase();
  const mode = Math.floor(rng() * 4);
  if (mode === 0) return `${seed}_${trimmed}`;
  if (mode === 1) return `${trimmed}${seed}`;
  if (mode === 2) return `${seed}${trimmed}${seed}`;
  return `${trimmed[0] ?? "x"}${seed}${trimmed.slice(1)}`;
}

function loadCorpus(): string {
  const parts: string[] = [];
  for (const f of readdirSync(CORPUS_DIR).filter(f => f.endsWith(".txt"))) {
    parts.push(readFileSync(join(CORPUS_DIR, f), "utf8"));
  }
  return parts.join("\n\n---\n\n");
}

function buildNoisyContext(corpus: string, target: number, keys: string[], sprinkleRate: number, seed: number): { text: string; sprinkleCount: number } {
  const rng = mulberry32(seed);
  const lines = corpus.split("\n").filter(l => l.trim().length > 0);
  const out: string[] = [];
  let len = 0;
  let sprinkleCount = 0;
  while (len < target) {
    const line = lines[Math.floor(rng() * lines.length)];
    out.push(line);
    len += line.length + 1;
    if (rng() < sprinkleRate && keys.length > 0) {
      const k = keys[Math.floor(rng() * keys.length)];
      out.push(k);
      len += k.length + 1;
      sprinkleCount++;
    }
  }
  return { text: out.join(" "), sprinkleCount };
}

const rawEntries = loadEntries();
const rng = mulberry32(1337);

const eligible = rawEntries.filter(e => !e.disabled && !e.constant && !e.use_regex && e.key.length > 0);
const mutateCount = Math.floor(eligible.length * 0.2);
const shuffled = eligible.slice().sort(() => rng() - 0.5);
const mutated = shuffled.slice(0, mutateCount);
const mutatedUids = new Set<string>();
const mutatedKeys: string[] = [];
for (const e of mutated) {
  mutatedUids.add(e.uid);
  e.key = e.key.map(k => mangleKey(k, rng));
  mutatedKeys.push(...e.key);
  if (rng() < 0.25) e.match_whole_words = true;
  if (rng() < 0.15) e.case_sensitive = true;
}

console.log(`Entries: ${rawEntries.length} (${eligible.length} eligible)`);
console.log(`Mutated ${mutateCount} entries with non-ASCII keys`);
console.log(`Total non-ASCII key fragments: ${mutatedKeys.length}`);

const corpus = loadCorpus();
console.log(`Corpus: ${corpus.length.toLocaleString()} chars multi-lingual`);

const allEligibleKeys: string[] = [];
for (const e of eligible) {
  if (rng() < 0.1) {
    const k = e.key[Math.floor(rng() * e.key.length)];
    if (k) allEligibleKeys.push(k);
  }
}

const TARGET = 800_000;
const perMsg = Math.floor(TARGET / 4);
const messages: Message[] = [];
let totalSprinkled = 0;
for (let i = 0; i < 4; i++) {
  const { text, sprinkleCount } = buildNoisyContext(corpus, perMsg, allEligibleKeys, 0.03, 42 + i);
  totalSprinkled += sprinkleCount;
  messages.push({ role: i % 2 === 0 ? "user" : "assistant", content: text } as Message);
}
const ctxLen = messages.reduce((s, m) => s + m.content.length, 0);
console.log(`Context: ${ctxLen.toLocaleString()} chars across 4 messages, ${totalSprinkled} sprinkled keys`);
console.log(`Sprinkle keys: ${allEligibleKeys.length} unique (mix of ASCII + non-ASCII)\n`);

function timeIt<T>(fn: () => T, runs = 3): { meanMs: number; minMs: number; maxMs: number; result: T } {
  let result: T = undefined as any;
  fn(); 
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    result = fn();
    samples.push(performance.now() - t0);
  }
  return {
    meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    minMs: Math.min(...samples), maxMs: Math.max(...samples), result: result as T,
  };
}

console.log("=== Per-pass parity ===");
for (let maxPasses = 0; maxPasses <= 4; maxPasses++) {
  const base = { entries: rawEntries, messages, chatTurn: messages.length,
    wiState: {} as any, settings: { globalScanDepth: 4, maxRecursionPasses: maxPasses } };
  const legacy = activateWorldInfo({ ...base, useAhoCorasick: false });
  const ac     = activateWorldInfo({ ...base, useAhoCorasick: true });

  const L = legacy.activatedEntries.map(e => e.uid);
  const A = ac.activatedEntries.map(e => e.uid);
  const LS = new Set(L), AS = new Set(A);
  const onlyL = L.filter(u => !AS.has(u));
  const onlyA = A.filter(u => !LS.has(u));
  const sameOrder = L.length === A.length && L.every((u, i) => u === A[i]);

  console.log(`  passes=${maxPasses}: legacy=${L.length}, ac=${A.length}, onlyL=${onlyL.length}, onlyA=${onlyA.length}, sameOrder=${sameOrder}`);
  if (onlyL.length || onlyA.length) {
    console.log("   diff onlyL:", onlyL.slice(0, 5));
    console.log("   diff onlyA:", onlyA.slice(0, 5));
  }
}

console.log("\n=== Speed (maxPasses=4) ===");
const base = { entries: rawEntries, messages, chatTurn: messages.length,
  wiState: {} as any, settings: { globalScanDepth: 4, maxRecursionPasses: 4 } };
const legacy = timeIt(() => activateWorldInfo({ ...base, useAhoCorasick: false }), 3);
const ac     = timeIt(() => activateWorldInfo({ ...base, useAhoCorasick: true }), 3);
const fmt = (n: number) => n.toFixed(2).padStart(8);
console.log(`  legacy:       ${fmt(legacy.meanMs)}ms (min ${fmt(legacy.minMs)}, max ${fmt(legacy.maxMs)}) → ${legacy.result.activatedEntries.length} activated`);
console.log(`  aho-corasick: ${fmt(ac.meanMs)}ms (min ${fmt(ac.minMs)}, max ${fmt(ac.maxMs)}) → ${ac.result.activatedEntries.length} activated`);
console.log(`  speedup: ${(legacy.meanMs / ac.meanMs).toFixed(2)}×`);
