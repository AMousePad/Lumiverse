import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const scriptDir = import.meta.dir;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

// Use a tar-backed fake runtime/output plugin to exercise the real finalizer,
// including repacking and extraction, without downloading Linux ELF tools.
const runtimeSize = 4096;
const runtimeSource = `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  --appimage-offset) echo ${runtimeSize} ;;
  --appimage-extract)
    mkdir squashfs-root
    tail -c +${runtimeSize + 1} "$0" | tar -xpf - -C squashfs-root
    ;;
  *) exit 1 ;;
esac
exit 0
`;

function write(path: string, contents: string | Buffer, mode = 0o644): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, contents);
  chmodSync(path, mode);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lumiverse-packaging-test-"));
  roots.push(root);
  const bundle = join(root, "bundle with spaces");
  const appdir = join(bundle, "Lumiverse Desktop.AppDir");
  const appimage = join(bundle, "Lumiverse Desktop_0.3.1_amd64.AppImage");
  const toolDir = join(root, "tools");
  const outputPlugin = join(toolDir, "output-plugin");
  for (const entry of ["AppRun", "AppRun.wrapped", "usr/bin/lumiverse-tray",
    "usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"]) {
    write(join(appdir, entry), "#!/bin/sh\nexit 0\n", 0o755);
  }
  for (const name of ["app", "audioconvert", "audioparsers", "audioresample", "autodetect",
    "pulseaudio", "coreelements", "mpg123", "playback", "typefindfunctions", "volume"]) {
    write(join(appdir, "usr/lib/gstreamer-1.0", `libgst${name}.so`), "plugin fixture\n");
  }
  write(join(appdir, "apprun-hooks/linuxdeploy-plugin-gstreamer.sh"), [
    'GST_PLUGIN_SYSTEM_PATH_1_0="${APPDIR}/usr/lib/gstreamer-1.0"',
    'GST_PLUGIN_PATH_1_0="${APPDIR}/usr/lib/gstreamer-1.0"',
    'GST_PLUGIN_SCANNER_1_0="${APPDIR}/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"',
  ].join("\n"));
  write(join(toolDir, "gst-inspect-1.0"), "#!/bin/sh\nexit 0\n", 0o755);
  write(outputPlugin, `#!/usr/bin/env bash
set -euo pipefail
appdir="\${2#--appdir=}"
if [[ "\${BREAK_PACKAGED_PERMISSIONS:-}" == 1 ]]; then
  chmod 770 "$appdir/AppRun.wrapped"
fi
cat "$LDAI_RUNTIME_FILE" > "$LDAI_OUTPUT"
tar -cpf - -C "$appdir" . >> "$LDAI_OUTPUT"
`, 0o755);
  const runtime = Buffer.alloc(runtimeSize, " ");
  runtime.write(runtimeSource);
  write(appimage, runtime, 0o755);
  return { root, bundle, appdir, appimage, env: {
    ...process.env,
    PATH: `${toolDir}:${process.env.PATH}`,
    LUMIVERSE_APPIMAGE_PLUGIN: outputPlugin,
  } };
}

function run(script: string, argument: string, env = process.env) {
  const result = Bun.spawnSync(["bash", join(scriptDir, script), argument], {
    env, stdout: "pipe", stderr: "pipe",
  });
  return { code: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
}

function extract(appimage: string, root: string) {
  const directory = join(root, "inspection");
  mkdirSync(directory);
  const result = Bun.spawnSync([appimage, "--appimage-extract"], { cwd: directory, stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  return join(directory, "squashfs-root");
}

describe.skipIf(process.platform === "win32")("AppImage packaging permissions", () => {
  test("rejects a launcher that is executable only for its owner and group", () => {
    const f = fixture();
    chmodSync(join(f.appdir, "AppRun.wrapped"), 0o770);
    const result = run("verify-appimage-permissions.sh", f.appdir);
    expect(result.code).toBe(1);
    expect(result.output).toContain("AppRun.wrapped");
  });

  test("rejects a required launcher that has no execute bits", () => {
    const f = fixture();
    chmodSync(join(f.appdir, "AppRun.wrapped"), 0o644);
    const result = run("verify-appimage-permissions.sh", f.appdir);
    expect(result.code).toBe(1);
    expect(result.output).toContain("AppRun.wrapped");
  });

  test.each(["resource", "directory", "helper"])("rejects inaccessible %s outside the main launchers", (kind) => {
    const f = fixture();
    const entry = join(f.appdir, "usr", `private-${kind}`);
    if (kind === "directory") {
      mkdirSync(entry);
      chmodSync(entry, 0o750);
    } else {
      write(entry, "fixture", kind === "helper" ? 0o770 : 0o640);
    }
    const result = run("verify-appimage-permissions.sh", f.appdir);
    expect(result.code).toBe(1);
    expect(result.output).toContain(entry);
  });

  test.each([false, true])("repacks and repairs permissions with bundled Wayland=%s", (wayland) => {
    const f = fixture();
    chmodSync(join(f.appdir, "AppRun.wrapped"), 0o770);
    chmodSync(join(f.appdir, "usr"), 0o750);
    write(join(f.appdir, "usr/share/resource.txt"), "resource", 0o600);
    if (wayland) write(join(f.appdir, "usr/lib/libwayland-client.so.0"), "library");
    const result = run("finalize-appimage.sh", f.bundle, f.env);
    expect(result.output).toContain("Finalized Lumiverse Desktop_0.3.1_amd64.AppImage");
    expect(result.code).toBe(0);
    const packaged = extract(f.appimage, f.root);
    expect(statSync(join(packaged, "AppRun.wrapped")).mode & 0o777).toBe(0o775);
    expect(statSync(join(packaged, "usr/share/resource.txt")).mode & 0o777).toBe(0o644);
    expect(run("verify-appimage-permissions.sh", packaged).code).toBe(0);
    expect(() => statSync(join(packaged, "usr/lib/libwayland-client.so.0"))).toThrow();
  });

  test("rejects permissions reintroduced by the output tool and keeps the original image", () => {
    const f = fixture();
    const original = readFileSync(f.appimage);
    const result = run("finalize-appimage.sh", f.bundle, { ...f.env, BREAK_PACKAGED_PERMISSIONS: "1" });
    expect(result.code).toBe(1);
    expect(result.output).toContain("AppRun.wrapped");
    expect(readFileSync(f.appimage)).toEqual(original);
  });
});
