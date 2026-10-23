import Foundation
import Darwin
import Security
import ImageIO
import UIKit

/// Shared by host and extension. Credentials never enter timeline entries or JSON.
enum CharacterWidgetStore {
    static var group: String? { Bundle.main.object(forInfoDictionaryKey: "LumiverseWidgetAppGroup") as? String }
    static var directory: URL? {
        guard let group = group else { return nil }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("CharacterWidgets", isDirectory: true)
    }
    private static func locked<T>(_ body: (URL) throws -> T) rethrows -> T? {
        guard let directory = directory else { return nil }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let descriptor = open(directory.appendingPathComponent("store.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { return nil }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { return nil }
        defer { flock(descriptor, LOCK_UN) }
        return try body(directory)
    }
    private static func read<T: Decodable>(_ type: T.Type, _ file: String, in directory: URL) -> T? {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent(file)), data.count <= 128 * 1024 else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
    private static func write<T: Encodable>(_ value: T, _ file: String, in directory: URL) throws {
        try JSONEncoder().encode(value).write(to: directory.appendingPathComponent(file), options: [.atomic, .completeFileProtection])
    }
    static func current() -> CharacterWidgetEnrollment? {
        locked { read(CharacterWidgetEnrollment.self, "active.json", in: $0) } ?? nil
    }
    static func snapshot(for enrollment: CharacterWidgetEnrollment) -> CharacterWidgetSnapshot? {
        locked { directory in
            guard read(CharacterWidgetEnrollment.self, "active.json", in: directory)?.registrationId == enrollment.registrationId,
                  let snapshot = read(CharacterWidgetSnapshot.self, "snapshot.json", in: directory), snapshot.valid,
                  snapshot.accountId == enrollment.accountId, enrollment.expiresAt > Date().timeIntervalSince1970 * 1000 else { return nil }
            return snapshot
        } ?? nil
    }
    private static func keychain(_ id: String? = nil) -> [String: Any]? {
        guard let group = group else { return nil }
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "chat.lumiverse.widgets", kSecAttrAccessGroup as String: group]
        if let id = id { query[kSecAttrAccount as String] = id }
        return query
    }
    static func credential(for enrollment: CharacterWidgetEnrollment) -> String? {
        guard var query = keychain(enrollment.registrationId) else { return nil }
        query[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func activate(_ enrollment: CharacterWidgetEnrollment, credential: String) throws {
        guard var item = keychain(enrollment.registrationId), directory != nil else { throw Failure.unavailable }
        try locked { directory in
            let previous = read(CharacterWidgetEnrollment.self, "active.json", in: directory)
            SecItemDelete(item as CFDictionary)
            item[kSecValueData as String] = Data(credential.utf8)
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw Failure.unavailable }
            clearFiles(in: directory, preserveActive: false)
            try write(enrollment, "active.json", in: directory)
            if let previous = previous, previous.registrationId != enrollment.registrationId, let old = keychain(previous.registrationId) { SecItemDelete(old as CFDictionary) }
        }
    }
    static func updatePalette(_ palette: CharacterWidgetPalette, for enrollment: CharacterWidgetEnrollment) {
        try? locked { directory in
            guard var active = read(CharacterWidgetEnrollment.self, "active.json", in: directory), active.registrationId == enrollment.registrationId else { return }
            active.palette = palette
            try write(active, "active.json", in: directory)
        }
    }
    /// Changes this revision even if metadata fetches are already in flight.
    static func invalidate(expected: String? = nil, removeEnrollment: Bool = false) {
        locked { directory in
            let active = read(CharacterWidgetEnrollment.self, "active.json", in: directory)
            if let expected = expected, active?.registrationId != expected { return }
            clearFiles(in: directory, preserveActive: !removeEnrollment)
            // Also remove credentials orphaned by an interrupted metadata write.
            if removeEnrollment, let item = keychain() { SecItemDelete(item as CFDictionary) }
            try? Data(UUID().uuidString.utf8).write(to: directory.appendingPathComponent("revision"), options: [.atomic, .completeFileProtection])
        }
    }
    private static func clearFiles(in directory: URL, preserveActive: Bool) {
        for file in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [] {
            if file.lastPathComponent == "store.lock" || (preserveActive && file.lastPathComponent == "active.json") { continue }
            try? FileManager.default.removeItem(at: file)
        }
    }
    static func revision() -> Data? { locked { try? Data(contentsOf: $0.appendingPathComponent("revision")) } ?? nil }
    static func commit(_ snapshot: CharacterWidgetSnapshot, images: [String: Data], enrollment: CharacterWidgetEnrollment, revision: Data?) throws {
        try locked { directory in
            guard read(CharacterWidgetEnrollment.self, "active.json", in: directory)?.registrationId == enrollment.registrationId,
                  (try? Data(contentsOf: directory.appendingPathComponent("revision"))) == revision else { return }
            // Recent/Favorites timelines can refresh concurrently. An older
            // response must not replace a newer committed collection snapshot.
            if let saved = read(CharacterWidgetSnapshot.self, "snapshot.json", in: directory), saved.generatedAt > snapshot.generatedAt { return }
            for (key, data) in images {
                try data.write(to: directory.appendingPathComponent(key + ".jpg"), options: [.atomic, .completeFileProtection])
            }
            try write(snapshot, "snapshot.json", in: directory)
            let keys = Set((snapshot.recent + snapshot.favorites).compactMap { $0.imageKey }.map { $0 + ".jpg" })
            for file in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [] where file.pathExtension == "jpg" && !keys.contains(file.lastPathComponent) {
                try? FileManager.default.removeItem(at: file)
            }
        }
    }
    static func boundedJPEG(_ data: Data) -> Data? {
        guard data.count <= 256 * 1024, let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetType(source) as String? == "public.jpeg",
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int, let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 192, height <= 256 else { return nil }
        return data
    }
    static func image(_ key: String?) -> UIImage? {
        guard let key = key, UUID(uuidString: key) != nil, let directory = directory,
              let data = try? Data(contentsOf: directory.appendingPathComponent(key + ".jpg")), boundedJPEG(data) != nil else { return nil }
        return UIImage(data: data)
    }
    enum Failure: Error { case unavailable, invalid, network }
}
