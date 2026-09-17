#!/usr/bin/env bun
/** Build Lumiverse Desktop and install it for the current user. */

import { join } from "node:path";
import { inspectDesktopToolchain } from "./desktop-toolchain";
import {
  currentInstallPlatform,
  installDesktopBundle,
  selectDesktopInstallArtifact,
} from "./desktop-installer";
import { rebuildDesktopShell } from "./runner/git-ops";
import { PROJECT_ROOT } from "./runner/lib/constants";

async function main(): Promise<void> {
  console.log("\nLumiverse Desktop — Build and install\n");

  if (process.env.LUMIVERSE_IS_TERMUX === "true" || process.env.LUMIVERSE_IS_PROOT === "true") {
    throw new Error("the Tauri desktop client cannot be installed on Android/Termux");
  }

  const report = await inspectDesktopToolchain();
  if (!report.ready) {
    console.error("Missing desktop build prerequisites:\n");
    for (const check of report.checks.filter((candidate) => candidate.status === "missing")) {
      console.error(`  ${check.label}: ${check.detail}`);
      for (const line of check.remedy) console.error(`    ${line}`);
    }
    console.error("\nRun 'bun run desktop:doctor' after installing the missing prerequisites.\n");
    process.exitCode = 1;
    return;
  }

  const target = currentInstallPlatform();
  console.log("Building the Tauri desktop app (the first build can take several minutes)...\n");
  await rebuildDesktopShell();

  const bundleRoot = join(PROJECT_ROOT, "desktop", "src-tauri", "target", "release", "bundle");
  const artifact = selectDesktopInstallArtifact(bundleRoot, target);
  if (!artifact) {
    throw new Error(`The Tauri build did not produce an installable ${target} artifact in ${bundleRoot}`);
  }

  console.log(`\nInstalling ${artifact}...`);
  const result = await installDesktopBundle(artifact, target);
  console.log(`\nLumiverse Desktop installed: ${result.installedPath}`);
  for (const shortcut of result.shortcuts) console.log(`  Shortcut: ${shortcut}`);
  console.log("\nYou can rerun this command to replace an older scripted install.\n");
}

main().catch((error) => {
  console.error(`\nDesktop installation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
