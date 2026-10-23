import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import sharp from "sharp";

/** Tauri's background colour can still leave an RGBA PNG (and fractional alpha). */
export async function flattenIOSAppIcons(iconset: string) {
  const catalog = JSON.parse(readFileSync(join(iconset, "Contents.json"), "utf8")) as {
    images: { idiom: string; filename?: string }[];
  };
  const marketing = catalog.images.filter(image => image.idiom === "ios-marketing");
  if (!marketing.length || marketing.some(image => !image.filename))
    throw new Error("Missing iOS marketing icon.");
  const filenames = new Set(catalog.images.map(image => image.filename).filter((name): name is string => !!name));
  for (const name of filenames) {
    if (basename(name) !== name || !name.endsWith(".png")) throw new Error(`Invalid iOS icon filename: ${name}`);
    const path = join(iconset, name);
    const png = await sharp(path).flatten({ background: "#231e30" }).removeAlpha()
      .toColourspace("srgb").png({ palette: false }).toBuffer();
    const metadata = await sharp(png).metadata();
    if (metadata.hasAlpha || metadata.channels !== 3) throw new Error(`iOS icon must be RGB without alpha: ${name}`);
    if (marketing.some(image => image.filename === name) && (metadata.width !== 1024 || metadata.height !== 1024))
      throw new Error(`iOS marketing icon must be 1024x1024: ${name}`);
    writeFileSync(path, png);
  }
}
