import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// Package the same relocatable Android libraries used by the bundled APK.
// Usage: bun scripts/package-android-sharp.ts <native-output> <app-commit> <output.tar.gz>
const [directory, revision, output] = process.argv.slice(2);
if (!directory || !output || !revision || !/^[a-f0-9]{40}$/.test(revision)) {
  throw new Error("Provide the Android native output directory, Android app commit, and output .tar.gz path.");
}
const root = resolve(directory);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const metadata = JSON.parse(readFileSync(join(root, "sharp.json"), "utf8"));
if (metadata.version !== "0.34.5" || metadata.target !== "aarch64-linux-android" || metadata.api !== 29) {
  throw new Error("Update the Android Sharp package pin before packaging a different native build.");
}
const files: Record<string, Uint8Array> = {};
for (const library of metadata.libraries as Array<{ name: string; sha256: string }>) {
  if (!/^lib[\w+.-]+\.so$/.test(library.name)) throw new Error("Invalid native library filename");
  const bytes = readFileSync(join(root, "sharp-libs", library.name));
  if (sha256(bytes) !== library.sha256) throw new Error(`Native checksum mismatch: ${library.name}`);
  files[`lib/${library.name}`] = bytes;
}
if (!files["lib/libsharp.so"] || sha256(readFileSync(join(root, "libsharp.so"))) !== metadata.sha256) {
  throw new Error("The Sharp binding is missing or does not match its native manifest.");
}
for (const name of ["sharp.json", "Sharp.LICENSE"]) files[name] = readFileSync(join(root, name));
function addNotices(directory: string, prefix: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) addNotices(join(directory, entry.name), `${prefix}${entry.name}/`);
    else if (entry.isFile()) files[prefix + entry.name] = readFileSync(join(directory, entry.name));
  }
}
addNotices(join(root, "notices"), "notices/");
const manifest = JSON.stringify({
  format: 1, version: metadata.version, libvips: metadata.libvips, api: metadata.api,
  source: { repository: "prolix-oc/Lumiverse-AndroidApp", revision },
  files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, sha256(bytes)])),
}, null, 2) + "\n";
files["manifest.json"] = new TextEncoder().encode(manifest);
const archive = await new Bun.Archive(files, { compress: "gzip" }).bytes();
await Bun.write(output, archive);
console.log(JSON.stringify({ version: metadata.version, libvips: metadata.libvips, bytes: archive.length,
  sha256: sha256(archive), manifestSha256: sha256(files["manifest.json"]), output: resolve(output) }, null, 2));
