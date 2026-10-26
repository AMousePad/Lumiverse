import { resolve } from "node:path";
import { configureSharpNativeOverride } from "../src/sharp-preflight";

if (process.platform !== "android" || process.arch !== "arm64") {
  throw new Error("Run this smoke test using native Android ARM64 Bun.");
}
await configureSharpNativeOverride({ workspaceRoot: resolve(import.meta.dir, "..") });
const { default: sharp } = await import("sharp");
for (const format of ["png", "jpeg", "webp", "avif", "gif", "tiff", "jxl"] as const) {
  const encoded = await sharp({ create: { width: 16, height: 16, channels: 4, background: "purple" } })
    .resize(8, 8).toFormat(format).toBuffer();
  const decoded = await sharp(encoded).raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== 8 || decoded.info.height !== 8 || !decoded.data.length) {
    throw new Error(`Android Sharp ${format} round-trip failed`);
  }
  console.log(`${format}: encode, resize and decode passed`);
}
console.log(`Bun ${Bun.version} ${process.platform}-${process.arch}; Sharp ${sharp.versions.sharp}; libvips ${sharp.versions.vips}`);
