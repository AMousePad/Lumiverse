import Foundation
import ImageIO
import UIKit

// Shared with the widget. Only bounded JPEGs live here; bearer credentials stay
// in the host's Keychain. No network access is required by the Live Activity.
enum GenerationActivityAvatar {
    private static let accents = NSCache<NSString, UIColor>()
    static let fallbackAccent = UIColor(red: 0.74, green: 0.65, blue: 1, alpha: 1)

    /// Prefer a populated, colorful hue over white backgrounds or dark outlines.
    /// Sample the shared thumbnail once; no network or full-size image decoding.
    static func accent(_ key: String?) -> UIColor {
        guard let key = key else { return fallbackAccent }
        if let cached = accents.object(forKey: key as NSString) { return cached }
        guard let image = image(key, size: 24)?.cgImage else { return fallbackAccent }
        var pixels = [UInt8](repeating: 0, count: 24 * 24 * 4)
        let drawn = pixels.withUnsafeMutableBytes { bytes -> Bool in
            guard let context = CGContext(data: bytes.baseAddress, width: 24, height: 24, bitsPerComponent: 8,
                bytesPerRow: 24 * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: 24, height: 24))
            return true
        }
        guard drawn else { return fallbackAccent }
        var weights = [CGFloat](repeating: 0, count: 24)
        var reds = weights, greens = weights, blues = weights
        for i in stride(from: 0, to: pixels.count, by: 4) {
            let r = CGFloat(pixels[i]) / 255, g = CGFloat(pixels[i + 1]) / 255, b = CGFloat(pixels[i + 2]) / 255
            var h: CGFloat = 0, s: CGFloat = 0, v: CGFloat = 0, a: CGFloat = 0
            UIColor(red: r, green: g, blue: b, alpha: 1).getHue(&h, saturation: &s, brightness: &v, alpha: &a)
            guard s > 0.18, v > 0.30, v < 0.98 || s > 0.35 else { continue }
            let bucket = min(23, Int(h * 24)), weight = s * s * v * v
            weights[bucket] += weight
            reds[bucket] += r * weight; greens[bucket] += g * weight; blues[bucket] += b * weight
        }
        guard let best = weights.indices.max(by: { weights[$0] < weights[$1] }), weights[best] > 0 else {
            accents.setObject(fallbackAccent, forKey: key as NSString)
            return fallbackAccent
        }
        let seed = UIColor(red: reds[best] / weights[best], green: greens[best] / weights[best], blue: blues[best] / weights[best], alpha: 1)
        var h: CGFloat = 0, s: CGFloat = 0, v: CGFloat = 0, a: CGFloat = 0
        seed.getHue(&h, saturation: &s, brightness: &v, alpha: &a)
        // Pastel accents remain readable on both the black Island and dark card.
        var color = UIColor(hue: h, saturation: min(0.62, max(0.30, s)), brightness: 1, alpha: 1)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        func linear(_ c: CGFloat) -> CGFloat { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        while (0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b) + 0.05) / 0.07 < 4.5 {
            r += (1 - r) * 0.08; g += (1 - g) * 0.08; b += (1 - b) * 0.08
        }
        color = UIColor(red: r, green: g, blue: b, alpha: 1)
        accents.setObject(color, forKey: key as NSString)
        return color
    }
    static var directory: URL? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "LumiverseActivityAppGroup") as? String else { return nil }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("ActivityAvatars", isDirectory: true)
    }
    static func file(_ key: String?) -> URL? {
        guard let key = key, UUID(uuidString: key) != nil else { return nil }
        return directory?.appendingPathComponent(key + ".jpg")
    }
    static func image(_ key: String?, size: CGFloat) -> UIImage? {
        guard let url = file(key), let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: Int(size * 3),
              ] as CFDictionary) else { return nil }
        // Give ActivityKit an image sized for this exact presentation, including
        // compact/minimal Island layouts, rather than a full-resolution bitmap.
        return UIImage(cgImage: image, scale: 3, orientation: .up)
    }
    static func store(_ data: Data) throws -> String? {
        guard data.count <= 256 * 1024, let directory = directory,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetType(source) as String? == "public.jpeg",
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 128, height <= 128 else { return nil }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let key = UUID().uuidString
        try data.write(to: directory.appendingPathComponent(key + ".jpg"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return key
    }
    static func remove(_ key: String?) { if let url = file(key) { try? FileManager.default.removeItem(at: url) } }
    static func prune() {
        guard let directory = directory,
              let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        for file in files {
            if let date = try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
               date < Date().addingTimeInterval(-12 * 3600) { try? FileManager.default.removeItem(at: file) }
        }
    }
}
