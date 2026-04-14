import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { WorldBookEntry } from "../src/types/world-book";

const LORE_DIR = "lorebooks";

function stToLumiverse(book: string, st: any, idx: string): WorldBookEntry {
  return {
    id: `${book}:${idx}`, world_book_id: book, uid: `${book}:${idx}`,
    key: Array.isArray(st.key) ? st.key.filter((k: any) => typeof k === "string") : [],
    keysecondary: Array.isArray(st.keysecondary) ? st.keysecondary.filter((k: any) => typeof k === "string") : [],
    content: String(st.content ?? ""), comment: String(st.comment ?? ""),
    position: 0, depth: 4, role: null, order_value: 0, selective: Boolean(st.selective),
    constant: Boolean(st.constant), disabled: Boolean(st.disable ?? st.disabled),
    group_name: "", group_override: false, group_weight: 100, probability: 100,
    scan_depth: st.scanDepth ?? null, case_sensitive: Boolean(st.caseSensitive),
    match_whole_words: Boolean(st.matchWholeWords), automation_id: null,
    use_regex: Boolean(st.useRegex ?? st.use_regex), prevent_recursion: false,
    exclude_recursion: false, delay_until_recursion: false, priority: 0, sticky: 0,
    cooldown: 0, delay: 0, selective_logic: st.selectiveLogic ?? 0, use_probability: false,
    vectorized: false, vector_index_status: "not_enabled", vector_indexed_at: null,
    vector_index_error: null, extensions: {}, created_at: 0, updated_at: 0,
  };
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
  "a\u0301\u0302\u0303", "ab\u200dcd", "𝒜𝓁𝓅𝒽𝒶", "👨‍👩‍👧‍👦",
  "ㅎㅎ한국어", "漢字テスト",
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

const rawEntries: WorldBookEntry[] = [];
for (const f of readdirSync(LORE_DIR).filter(f => f.endsWith(".json"))) {
  const j = JSON.parse(readFileSync(join(LORE_DIR, f), "utf8"));
  for (const [idx, st] of Object.entries(j.entries ?? {})) {
    rawEntries.push(stToLumiverse(f.replace(/\.json$/, ""), st, idx));
  }
}

const rng = mulberry32(1337);
const eligible = rawEntries.filter(e => !e.disabled && !e.constant && !e.use_regex && e.key.length > 0);
const shuffled = eligible.slice().sort(() => rng() - 0.5);
const mutateCount = Math.floor(eligible.length * 0.2);
const mutated = shuffled.slice(0, mutateCount);
const mutatedUids = new Set<string>();
for (const e of mutated) {
  mutatedUids.add(e.uid);
  e.key = e.key.map(k => mangleKey(k, rng));
  if (rng() < 0.25) e.match_whole_words = true;
  if (rng() < 0.15) e.case_sensitive = true;
}

const target = rawEntries.find(e => e.uid === "Races & Species (1):49");
console.log("=== Races & Species (1):49 state at bench time ===");
console.log("mutated:", mutatedUids.has("Races & Species (1):49"));
console.log("keys:", JSON.stringify(target?.key));
console.log("keysecondary:", JSON.stringify(target?.keysecondary));
console.log("selective:", target?.selective, "selective_logic:", target?.selective_logic);
console.log("case_sensitive:", target?.case_sensitive, "whole_words:", target?.match_whole_words);
console.log("use_regex:", target?.use_regex);
console.log("key char codes:");
for (const k of target?.key ?? []) {
  console.log(`  "${k}" → [${Array.from(k).map(c => c.charCodeAt(0).toString(16)).join(" ")}]`);
}
