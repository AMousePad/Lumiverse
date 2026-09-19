import { describe, expect, test } from "bun:test";
import {
  appImageBundleDirectory,
  requestedAppImage,
  tauriBuildEnvironment,
} from "./tauri-finalized";

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

  test("uses FUSE-free, RELR-compatible linuxdeploy settings for Linux AppImages", () => {
    expect(tauriBuildEnvironment(["build"], "linux", { KEEP: "yes" })).toEqual({
      KEEP: "yes",
      APPIMAGE_EXTRACT_AND_RUN: "1",
      NO_STRIP: "1",
    });
  });

  test("does not alter other platforms or non-AppImage builds", () => {
    const env = { KEEP: "yes" };
    expect(tauriBuildEnvironment(["build"], "darwin", env)).toBe(env);
    expect(tauriBuildEnvironment(["build", "--bundles", "deb,rpm"], "linux", env)).toBe(env);
  });
});
