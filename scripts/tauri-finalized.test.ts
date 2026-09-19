import { describe, expect, test } from "bun:test";
import { appImageBundleDirectory, requestedAppImage } from "./tauri-finalized";

describe("finalized Tauri build routing", () => {
  test("finalizes default and explicit AppImage builds", () => {
    expect(requestedAppImage(["build"])).toBe(true);
    expect(requestedAppImage(["build", "--bundles", "appimage,deb"])).toBe(true);
    expect(requestedAppImage(["build", "--bundles=all"])).toBe(true);
  });

  test("leaves builds without an AppImage alone", () => {
    expect(requestedAppImage(["build", "--bundles", "deb,rpm"])).toBe(false);
    expect(requestedAppImage(["build", "--bundles=dmg"])).toBe(false);
  });

  test("routes target-specific bundles to Tauri's target directory", () => {
    expect(appImageBundleDirectory(["build", "--target", "aarch64-unknown-linux-gnu"]))
      .toEndWith("desktop/src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/appimage");
    expect(appImageBundleDirectory(["build", "--target=x86_64-unknown-linux-gnu"]))
      .toEndWith("desktop/src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage");
  });
});
