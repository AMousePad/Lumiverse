import { writeFileSync } from "node:fs";

const LANGS = ["ja", "zh", "ar", "ko", "ru", "he", "de", "el", "th", "hi", "fa", "vi", "bn", "ta"];
const BATCHES = 10;
const CHARS_PER_PAGE = 8000;

interface Page { extract?: string }
interface WikiResp { query?: { pages?: Record<string, Page> } }

async function fetchBatch(lang: string): Promise<string> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext=1&exchars=${CHARS_PER_PAGE}&generator=random&grnnamespace=0&grnlimit=20`;
  const r = await fetch(url, { headers: { "User-Agent": "lumiverse-bench/0.1 (research)" } });
  if (!r.ok) return "";
  const j = (await r.json()) as WikiResp;
  const pages = j.query?.pages ?? {};
  return Object.values(pages).map(p => p.extract ?? "").filter(Boolean).join("\n\n");
}

async function main() {
  for (const lang of LANGS) {
    const chunks: string[] = [];
    for (let i = 0; i < BATCHES; i++) {
      try {
        const txt = await fetchBatch(lang);
        if (txt) chunks.push(txt);
      } catch (e) {
        console.error(`${lang} batch ${i} failed:`, (e as Error).message);
      }
    }
    const combined = chunks.join("\n\n");
    writeFileSync(`scripts/bench-data/${lang}.txt`, combined);
    console.log(`${lang}: ${combined.length.toLocaleString()} chars, ${Buffer.byteLength(combined, "utf8").toLocaleString()} bytes`);
  }
}

main();
