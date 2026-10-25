import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANDROID_SHARP_BUNDLE, configureSharpNativeOverride, installAndroidSharp } from "./sharp-preflight";

const directories: string[] = [];
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function root(): string {
  const directory = mkdtempSync(join(tmpdir(), "lumiverse-android-sharp-"));
  directories.push(directory);
  return directory;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

async function fixture(overrides: Record<string, string> = {}) {
  const files = { "lib/libsharp.so": "binding", "lib/libvips_42.so": "vips", "lib/libvips-heif.so": "heif", "lib/libvips-jxl.so": "jxl", ...overrides };
  const manifest = JSON.stringify({ format: 1, version: "0.34.5", libvips: "8.18.7-1", api: 29,
    files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(value)])) });
  const archive = await new Bun.Archive({ ...files, "manifest.json": manifest }, { compress: "gzip" }).bytes();
  const bundle = { ...ANDROID_SHARP_BUNDLE, sha256: hash(archive), manifestSha256: hash(manifest) };
  let downloads = 0;
  const fetchBundle = async () => { downloads++; return new Response(archive); };
  return { bundle, archive, fetchBundle, downloads: () => downloads };
}

test("a verified engine survives node_modules replacement and repairs a damaged library", async () => {
  const directory = root(), input = await fixture();
  const engine = await installAndroidSharp(directory, input.bundle, input.fetchBundle);
  expect(readFileSync(join(engine, "lib/libsharp.so"), "utf8")).toBe("binding");
  await installAndroidSharp(directory, input.bundle, input.fetchBundle);
  expect(input.downloads()).toBe(1);
  writeFileSync(join(engine, "lib/libsharp.so"), "damaged");
  await installAndroidSharp(directory, input.bundle, input.fetchBundle);
  expect(input.downloads()).toBe(2);
  expect(readFileSync(join(engine, "lib/libsharp.so"), "utf8")).toBe("binding");
});

test("corrupt downloads and missing archive members never replace the installed engine", async () => {
  const directory = root(), input = await fixture();
  const engine = await installAndroidSharp(directory, input.bundle, input.fetchBundle);
  writeFileSync(join(engine, "lib/libvips_42.so"), "damaged");
  const corruptFetch = async () => new Response("corrupt");
  await expect(installAndroidSharp(directory, input.bundle, corruptFetch)).rejects.toThrow("archive checksum mismatch");
  expect(readFileSync(join(engine, "lib/libsharp.so"), "utf8")).toBe("binding");
  const incompleteArchive = await new Bun.Archive({ "manifest.json": readFileSync(join(engine, "manifest.json")) }).bytes();
  await expect(installAndroidSharp(directory, { ...input.bundle, sha256: hash(incompleteArchive) },
    async () => new Response(incompleteArchive))).rejects.toThrow("missing lib/");
  expect(readFileSync(join(engine, "lib/libsharp.so"), "utf8")).toBe("binding");
});

test("manifest paths cannot escape the engine directory", async () => {
  const directory = root(), input = await fixture({ "../escaped": "bad" });
  await expect(installAndroidSharp(directory, input.bundle, input.fetchBundle)).rejects.toThrow("Invalid Android Sharp manifest entry");
  expect(existsSync(join(directory, "vendor/escaped"))).toBe(false);
});

test("an unavailable engine download fails before an installation is marked complete", async () => {
  const directory = root(), input = await fixture();
  await expect(installAndroidSharp(directory, input.bundle, async () => new Response("not found", { status: 404 })))
    .rejects.toThrow("HTTP 404");
  expect(existsSync(join(directory, "vendor/sharp-android", input.bundle.id))).toBe(false);
});

test("native Android installs the Sharp loader and codecs again after node_modules is replaced", async () => {
  const directory = root(), input = await fixture();
  const sharp = join(directory, "node_modules/sharp");
  mkdirSync(sharp, { recursive: true });
  writeFileSync(join(sharp, "package.json"), JSON.stringify({ version: "0.34.5" }));
  const env: NodeJS.ProcessEnv = {};
  const options = { workspaceRoot: directory, platform: "android", arch: "arm64", env, ...input };
  await configureSharpNativeOverride(options);
  const wrapper = join(directory, "node_modules/@img/sharp-android-arm64");
  expect(JSON.parse(readFileSync(join(wrapper, "package.json"), "utf8")).exports["./sharp.node"]).toBe("./index.cjs");
  expect(readFileSync(join(wrapper, "index.cjs"), "utf8")).toContain("libc.symbols.setenv");
  expect(readFileSync(join(env.VIPSHOME!, "lib/vips-modules-8.18/vips-heif.so"), "utf8")).toBe("heif");
  rmSync(wrapper, { recursive: true });
  await configureSharpNativeOverride(options);
  expect(existsSync(join(wrapper, "index.cjs"))).toBe(true);
  expect(input.downloads()).toBe(1);
  writeFileSync(join(sharp, "package.json"), JSON.stringify({ version: "0.35.0" }));
  await expect(configureSharpNativeOverride(options)).rejects.toThrow("installed 0.35.0");
});

test("Linux/proot, other architectures and the APK's installed engine bypass the standalone installer", async () => {
  const directory = root();
  for (const options of [
    { platform: "linux", arch: "arm64", env: { LUMIVERSE_IS_TERMUX: "true" } },
    { platform: "android", arch: "x64", env: {} },
    { platform: "android", arch: "arm64", env: { LUMIVERSE_NATIVE_DIR: "/installed/apk/lib" } },
  ]) await configureSharpNativeOverride({ ...options, workspaceRoot: directory });
  expect(existsSync(join(directory, "vendor"))).toBe(false);
});
