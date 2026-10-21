import Foundation
import ImageIO
import UIKit

// Shared with the widget. Only bounded JPEGs live here; bearer credentials stay
// in the host's Keychain. No network access is required by the Live Activity.
enum GenerationActivityAvatar {
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
