import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { flattenIOSAppIcons } from "./ios-icons";

test("iOS icons composite transparency and remove even a fully opaque alpha channel", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lumiverse-ios-icons-"));
  try {
    writeFileSync(join(directory, "Contents.json"), JSON.stringify({ images: [
      { idiom: "ios-marketing", filename: "marketing.png" },
      { idiom: "iphone", filename: "small.png" },
    ] }));
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#BA87FF" } })
      .png().toFile(join(directory, "marketing.png"));
    await sharp(Buffer.from([255, 0, 0, 0, 186, 135, 255, 255, 0, 0, 0, 254, 35, 30, 48, 255]),
      { raw: { width: 2, height: 2, channels: 4 } }).png().toFile(join(directory, "small.png"));
    expect((await sharp(join(directory, "marketing.png")).metadata()).hasAlpha).toBe(true);
    await flattenIOSAppIcons(directory);
    for (const name of ["marketing.png", "small.png"]) {
      const metadata = await sharp(join(directory, name)).metadata();
      expect(metadata.hasAlpha).toBe(false);
      expect(metadata.channels).toBe(3);
      expect((await sharp(join(directory, name)).stats()).isOpaque).toBe(true);
    }
    const pixels = await sharp(join(directory, "small.png")).raw().toBuffer();
    expect([...pixels.subarray(0, 3)]).toEqual([35, 30, 48]);
    expect([...pixels.subarray(3, 6)]).toEqual([186, 135, 255]);
    expect((await sharp(join(directory, "marketing.png")).metadata()).width).toBe(1024);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
