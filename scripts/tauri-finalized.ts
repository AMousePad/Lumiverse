#!/usr/bin/env bun

import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..");
const DESKTOP_DIR = join(PROJECT_ROOT, "desktop");

export function requestedAppImage(args: string[]): boolean {
  const equalsForm = args.find((arg) => arg.startsWith("--bundles="));
  const flagIndex = args.indexOf("--bundles");
  const value = equalsForm?.slice("--bundles=".length)
    ?? (flagIndex >= 0 ? args[flagIndex + 1] : undefined);
  if (!value) return true;
  return value.split(",").some((bundle) => bundle === "appimage" || bundle === "all");
}

export function appImageBundleDirectory(args: string[]): string {
  const equalsForm = args.find((arg) => arg.startsWith("--target="));
  const flagIndex = args.indexOf("--target");
  const target = equalsForm?.slice("--target=".length)
    ?? (flagIndex >= 0 ? args[flagIndex + 1] : undefined);
  const targetRoot = target
    ? join(DESKTOP_DIR, "src-tauri", "target", target)
    : join(DESKTOP_DIR, "src-tauri", "target");
  return join(targetRoot, "release", "bundle", "appimage");
}

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn({
    cmd: command,
    cwd,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${command[0]} exited with code ${exitCode}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  await run([process.execPath, "run", "tauri", ...args], DESKTOP_DIR);

  if (process.platform !== "linux" || args[0] !== "build" || !requestedAppImage(args)) {
    return;
  }

  await run(
    ["bash", join(PROJECT_ROOT, "scripts", "finalize-appimage.sh"), appImageBundleDirectory(args)],
    PROJECT_ROOT,
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`Desktop bundle finalization failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
