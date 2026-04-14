import { readFileSync } from "node:fs";
import { join } from "node:path";

const suspects = [
  { book: "central control (1)", idx: "1" },
  { book: "Authorities & Divine Protections (1)", idx: "72" },
];

for (const s of suspects) {
  const j = JSON.parse(readFileSync(join("lorebooks", s.book + ".json"), "utf8"));
  const e = j.entries[s.idx];
  console.log(`\n=== ${s.book}:${s.idx} ===`);
  console.log("comment:", e.comment);
  console.log("key:", JSON.stringify(e.key));
  console.log("keysecondary:", JSON.stringify(e.keysecondary));
  console.log("selective:", e.selective, "selective_logic:", e.selectiveLogic);
  console.log("case_sensitive:", e.caseSensitive, "whole_words:", e.matchWholeWords, "use_regex:", e.useRegex);
  console.log("constant:", e.constant, "disabled:", e.disable ?? e.disabled);
  console.log("scan_depth:", e.scanDepth);
  console.log("prevent_recursion:", e.preventRecursion, "exclude_recursion:", e.excludeRecursion);
}
