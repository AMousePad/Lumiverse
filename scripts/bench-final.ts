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
    use_probability: false, vectorized: false, vector_index_status: "not_enabled",
    vector_indexed_at: null, vector_index_error: null, extensions: {},
    created_at: 0, updated_at: 0,
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

function makeFiller(size: number, seed: number): string {
  const rng = mulberry32(seed);
  const words = ["lorem","ipsum","dolor","sit","amet","consectetur","adipiscing","elit",
    "sed","do","eiusmod","tempor","incididunt","labore","magna","aliqua"];
  const out: string[] = [];
  let len = 0;
  while (len < size) {
    const w = words[Math.floor(rng() * words.length)];
    out.push(w);
    len += w.length + 1;
  }
  return out.join(" ");
}

function loadCorpus(): string {
  try {
    const parts: string[] = [];
    for (const f of readdirSync(CORPUS_DIR).filter(f => f.endsWith(".txt"))) {
      parts.push(readFileSync(join(CORPUS_DIR, f), "utf8"));
    }
    return parts.join("\n\n");
  } catch { return ""; }
}

function timeIt<T>(label: string, fn: () => T, runs = 3): { label: string; meanMs: number; minMs: number; maxMs: number; result: T } {
  fn(); 
  const samples: number[] = [];
  let result: T = undefined as any;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    result = fn();
    samples.push(performance.now() - t0);
  }
  return {
    label, meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    minMs: Math.min(...samples), maxMs: Math.max(...samples), result: result as T,
  };
}

const entries = loadEntries();
console.log(`Loaded ${entries.length} entries, ${entries.reduce((s, e) => s + e.key.length + e.keysecondary.length, 0)} keys`);

const rng = mulberry32(42);
const eligible = entries.filter(e => !e.disabled && !e.constant && !e.use_regex && e.key.length > 0);
const picked = eligible.slice().sort(() => rng() - 0.5).slice(0, Math.floor(eligible.length * 0.1));
const triggerText = picked.map(e => e.key[Math.floor(rng() * e.key.length)]).filter(Boolean).join(" ");

const smallMsgs: Message[] = [
  { role: "user", content: "filler one" },
  { role: "assistant", content: "filler two" },
  { role: "user", content: "filler three" },
  { role: "user", content: triggerText },
] as Message[];

const perMsg = Math.floor(800_000 / 4);
const bigMsgs: Message[] = [
  { role: "user", content: makeFiller(perMsg, 1) },
  { role: "assistant", content: makeFiller(perMsg, 2) },
  { role: "user", content: makeFiller(perMsg, 3) },
  { role: "user", content: triggerText + " " + makeFiller(perMsg - triggerText.length - 1, 4) },
] as Message[];

const corpus = loadCorpus();
const multiMsgs: Message[] = corpus
  ? (() => {
      const tile = (corpus + "\n").repeat(Math.ceil(800_000 / Math.max(1, corpus.length)));
      const slice = tile.slice(0, 800_000);
      const q = Math.floor(slice.length / 4);
      return [
        { role: "user", content: slice.slice(0, q) + " " + triggerText },
        { role: "assistant", content: slice.slice(q, 2 * q) },
        { role: "user", content: slice.slice(2 * q, 3 * q) },
        { role: "user", content: slice.slice(3 * q) + " " + triggerText },
      ] as Message[];
    })()
  : [];

function runBench(label: string, messages: Message[]) {
  if (messages.length === 0) { console.log(`${label}: (skipped — no corpus)`); return; }
  const ctx = messages.reduce((s, m) => s + m.content.length, 0);
  const r = timeIt(label, () => activateWorldInfo({
    entries, messages, chatTurn: messages.length, wiState: {},
    settings: { globalScanDepth: 4, maxRecursionPasses: 4 },
  }), 3);
  console.log(`${label.padEnd(32)} ctx=${ctx.toLocaleString().padStart(9)} chars  mean=${r.meanMs.toFixed(1).padStart(7)}ms  min=${r.minMs.toFixed(1).padStart(7)}ms  activated=${(r.result as any).activatedEntries.length}`);
}

console.log();
runBench("1. small context (~1.3k)", smallMsgs);
runBench("2. 800k ASCII filler",     bigMsgs);
runBench("3. 800k multilingual",     multiMsgs);
