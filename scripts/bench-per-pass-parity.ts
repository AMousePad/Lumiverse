import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { activateWorldInfo } from "../src/services/world-info-activation.service";
import type { WorldBookEntry } from "../src/types/world-book";
import type { Message } from "../src/types/message";

const DIR = "lorebooks";

function stToLumiverse(bookName: string, st: any, idx: string): WorldBookEntry {
  return {
    id: `${bookName}:${idx}`, world_book_id: bookName, uid: `${bookName}:${idx}`,
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
    use_probability: Boolean(st.useProbability), vectorized: false,
    vector_index_status: "not_enabled", vector_indexed_at: null, vector_index_error: null,
    extensions: {}, created_at: 0, updated_at: 0,
  };
}

function loadAll(): WorldBookEntry[] {
  const files = readdirSync(DIR).filter(f => f.endsWith(".json"));
  const out: WorldBookEntry[] = [];
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(DIR, f), "utf8"));
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

const entries = loadAll();
const rng = mulberry32(42);
const eligible = entries.filter(e => !e.disabled && !e.constant && !e.use_regex && e.key.length > 0);
const picked = eligible.slice().sort(() => rng() - 0.5).slice(0, Math.floor(eligible.length * 0.1));
const triggerText = picked.map(e => e.key[Math.floor(rng() * e.key.length)]).filter(Boolean).join(" ");

const messages: Message[] = [
  { role: "user", content: "filler one" },
  { role: "assistant", content: "filler two" },
  { role: "user", content: "filler three" },
  { role: "user", content: triggerText },
] as Message[];

console.log(`Entries: ${entries.length}, trigger text: ${triggerText.length} chars\n`);

const deterministic = entries.map(e => ({ ...e, use_probability: false }));

for (let maxPasses = 0; maxPasses <= 6; maxPasses++) {
  const base = { entries: deterministic, messages, chatTurn: messages.length, wiState: {} as any,
    settings: { globalScanDepth: 4, maxRecursionPasses: maxPasses } };
  const legacy = activateWorldInfo({ ...base, useAhoCorasick: false });
  const ac     = activateWorldInfo({ ...base, useAhoCorasick: true });

  const L = new Set(legacy.activatedEntries.map(e => e.uid));
  const A = new Set(ac.activatedEntries.map(e => e.uid));
  const onlyL = [...L].filter(u => !A.has(u));
  const onlyA = [...A].filter(u => !L.has(u));

  const orderL = legacy.activatedEntries.map(e => e.uid);
  const orderA = ac.activatedEntries.map(e => e.uid);
  const sameOrder = orderL.length === orderA.length && orderL.every((u, i) => u === orderA[i]);

  console.log(`maxPasses=${maxPasses}: legacy=${L.size}, ac=${A.size}, onlyL=${onlyL.length}, onlyA=${onlyA.length}, sameFinalOrder=${sameOrder}, passesUsed L=${legacy.stats.recursionPassesUsed} A=${ac.stats.recursionPassesUsed}`);

  if (onlyL.length || onlyA.length) {
    console.log(`   onlyLegacy:`, onlyL.slice(0, 3));
    console.log(`   onlyAC:    `, onlyA.slice(0, 3));
  }
}
